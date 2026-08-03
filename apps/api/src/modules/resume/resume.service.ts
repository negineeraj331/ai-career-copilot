import {
  emptyResumeDocument,
  resumeDocumentSchema,
  type CreateResumeInput,
  type ResumeDetail,
  type ResumeDocument,
  type ResumeSummary,
  type ResumeVersion as ResumeVersionDto,
  type UpdateResumeInput,
} from '@cc/shared';
import { scoreResume } from '@cc/ats';
import type { Prisma, Resume, ResumeVersion } from '../../generated/prisma/index.js';
import { prisma } from '../../core/db/prisma.js';
import {
  NotFoundError,
  UnprocessableError,
  VersionConflictError,
} from '../../core/errors/app-error.js';
import { hashContent } from './content-hash.js';

/**
 * Resume reads and writes.
 *
 * Two invariants hold everywhere in this file:
 *
 *  1. **Versions are immutable.** Nothing here updates a ResumeVersion row.
 *     Every change — including restoring an old version — appends. That is what
 *     makes history worth showing: a timeline that can be rewritten is not a
 *     history, it is a rumour.
 *
 *  2. **Ownership is enforced in the query, not after it.** Every lookup filters
 *     on `userId` in the WHERE clause rather than fetching and then comparing.
 *     A check written after the read is one early `return` away from being
 *     skipped, and the failure mode is handing one user another user's resume.
 */

const MAX_VERSIONS_PAGE = 100;

/** What a caller may see. Excludes soft-deleted rows by default. */
function ownedWhere(resumeId: string, userId: string): Prisma.ResumeWhereInput {
  return { id: resumeId, userId, deletedAt: null };
}

function toSummary(row: Resume & { versions?: { versionNumber: number }[] }): ResumeSummary {
  return {
    id: row.id,
    title: row.title,
    templateId: row.templateId,
    targetRole: row.targetRole,
    status: row.status,
    atsScore: row.atsScore,
    currentVersion: row.versions?.[0]?.versionNumber ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Content read back out of jsonb is `unknown` as far as the type system is
 * concerned, so it is re-parsed rather than cast. A cast would let a document
 * written under an older schema flow into the renderer and fail somewhere far
 * from the cause; parsing fails here, naming the field.
 */
function parseStoredContent(raw: Prisma.JsonValue): ResumeDocument {
  const parsed = resumeDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new UnprocessableError(
      'This resume was saved in a format this version cannot read. Please contact support.',
      parsed.error.issues.slice(0, 5).map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

/**
 * The denormalised list-view score.
 *
 * Only the composite integer is stored on Resume; the full breakdown is
 * recomputed on demand because the engine is pure and cheap (no I/O, no AI, sub
 * -millisecond), and caching a derived value that the rubric version can
 * invalidate would mean a rubric change silently leaves stale scores behind.
 */
function atsScoreFor(document: ResumeDocument, targetRole?: string | undefined): number {
  return scoreResume(document, { targetRole }).score;
}

export interface ListResumesOptions {
  limit: number;
  cursor?: string | undefined;
}

export async function listResumes(
  userId: string,
  { limit, cursor }: ListResumesOptions,
): Promise<{
  items: ResumeSummary[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}> {
  // Fetch one more than asked for: the extra row answers "is there a next page"
  // without a second COUNT query over the same index.
  const rows = await prisma().resume.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      versions: { orderBy: { versionNumber: 'desc' }, take: 1, select: { versionNumber: true } },
    },
  });

  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;

  return {
    items: page.map(toSummary),
    pageInfo: { hasNextPage, endCursor: page.at(-1)?.id ?? null },
  };
}

export async function getResume(resumeId: string, userId: string): Promise<ResumeDetail> {
  const row = await prisma().resume.findFirst({
    where: ownedWhere(resumeId, userId),
    include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  });
  if (!row) throw new NotFoundError('That resume does not exist.');

  const current = row.versions[0];
  if (!current) {
    // Unreachable: creation writes the first version in the same transaction.
    // Asserted rather than assumed, because the alternative is returning a
    // resume with no content and letting the editor crash on it.
    throw new UnprocessableError('This resume has no content.');
  }

  return {
    ...toSummary(row),
    content: parseStoredContent(current.content),
  };
}

export async function createResume(
  userId: string,
  input: CreateResumeInput,
): Promise<ResumeDetail> {
  // Only needed when starting from scratch, so it is looked up lazily rather
  // than threaded through the access token. Putting a name and email into the
  // JWT would mean a rename does not take effect until the token expires.
  let content = input.content;
  if (!content) {
    const author = await prisma().user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true },
    });
    content = emptyResumeDocument(author.name ?? 'Your Name', author.email);
  }

  const row = await prisma().$transaction(async (tx) => {
    const resume = await tx.resume.create({
      data: {
        userId,
        title: input.title,
        templateId: input.templateId,
        targetRole: input.targetRole ?? null,
      },
    });

    const version = await tx.resumeVersion.create({
      data: {
        resumeId: resume.id,
        versionNumber: 1,
        content,
        contentHash: hashContent(content),
        schemaVersion: content.schemaVersion,
        changeSummary: 'Created',
        createdById: userId,
      },
    });

    return tx.resume.update({
      where: { id: resume.id },
      data: { currentVersionId: version.id, atsScore: atsScoreFor(content, input.targetRole) },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
  });

  return { ...toSummary(row), content };
}

/**
 * Update metadata, content, or both.
 *
 * Content changes append a version. Two guards sit in front of that:
 *
 *  - `expectedVersion` (optimistic concurrency). Two tabs open on the same
 *    resume must not silently overwrite each other; the loser gets a 409
 *    carrying the server's current version so the client can offer a reload.
 *  - the content hash. A save that changed nothing coalesces onto the current
 *    version rather than appending a duplicate.
 */
export async function updateResume(
  resumeId: string,
  userId: string,
  input: UpdateResumeInput,
): Promise<ResumeDetail> {
  const result = await prisma().$transaction(async (tx) => {
    const resume = await tx.resume.findFirst({
      where: ownedWhere(resumeId, userId),
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    if (!resume) throw new NotFoundError('That resume does not exist.');

    const current = resume.versions[0];
    if (!current) throw new UnprocessableError('This resume has no content.');

    if (input.expectedVersion !== undefined && input.expectedVersion !== current.versionNumber) {
      throw new VersionConflictError(current.versionNumber, input.expectedVersion);
    }

    const metadata: Prisma.ResumeUpdateInput = {};
    if (input.title !== undefined) metadata.title = input.title;
    if (input.templateId !== undefined) metadata.templateId = input.templateId;
    if (input.targetRole !== undefined) metadata.targetRole = input.targetRole;

    let content = parseStoredContent(current.content);

    if (input.content) {
      const nextHash = hashContent(input.content);

      if (nextHash === current.contentHash) {
        // Identical content. Metadata may still have changed, so the update
        // below still runs — but history does not grow.
        content = input.content;
      } else {
        const version = await tx.resumeVersion.create({
          data: {
            resumeId,
            versionNumber: current.versionNumber + 1,
            content: input.content,
            contentHash: nextHash,
            schemaVersion: input.content.schemaVersion,
            createdById: userId,
          },
        });
        content = input.content;
        metadata.currentVersionId = version.id;
        metadata.atsScore = atsScoreFor(input.content, resume.targetRole ?? undefined);
      }
    }

    // Always touch the row, even for a coalesced save: `updatedAt` drives the
    // list ordering, and a user who edited and reverted still expects their
    // resume at the top of the list.
    const updated = await tx.resume.update({
      where: { id: resumeId },
      data: Object.keys(metadata).length > 0 ? metadata : { updatedAt: new Date() },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });

    return { updated, content };
  });

  return { ...toSummary(result.updated), content: result.content };
}

/**
 * Soft delete. The row stays so that analytics, shares, and application history
 * that reference it do not develop holes; NFR-51's purge sweeps it later.
 */
export async function deleteResume(resumeId: string, userId: string): Promise<void> {
  const { count } = await prisma().resume.updateMany({
    where: ownedWhere(resumeId, userId),
    data: { deletedAt: new Date() },
  });
  // updateMany reports 0 for both "not yours" and "already deleted", and both
  // should look identical from outside — otherwise the endpoint tells a
  // stranger whether an id exists.
  if (count === 0) throw new NotFoundError('That resume does not exist.');
}

export async function duplicateResume(resumeId: string, userId: string): Promise<ResumeDetail> {
  const source = await getResume(resumeId, userId);

  return createResume(userId, {
    title: `${source.title} (copy)`.slice(0, 200),
    templateId: source.templateId,
    ...(source.targetRole !== null ? { targetRole: source.targetRole } : {}),
    content: source.content,
  });
}

export async function listVersions(
  resumeId: string,
  userId: string,
  limit = MAX_VERSIONS_PAGE,
): Promise<ResumeVersionDto[]> {
  const resume = await prisma().resume.findFirst({
    where: ownedWhere(resumeId, userId),
    select: { id: true },
  });
  if (!resume) throw new NotFoundError('That resume does not exist.');

  const versions = await prisma().resumeVersion.findMany({
    where: { resumeId },
    orderBy: { versionNumber: 'desc' },
    take: Math.min(limit, MAX_VERSIONS_PAGE),
  });

  return versions.map(toVersionDto);
}

function toVersionDto(v: ResumeVersion): ResumeVersionDto {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    changeSummary: v.changeSummary,
    // Per-version ATS scores arrive with the scoring engine in slice 1.2.
    atsScore: null,
    createdAt: v.createdAt.toISOString(),
  };
}

export async function getVersion(
  resumeId: string,
  versionId: string,
  userId: string,
): Promise<ResumeVersionDto & { content: ResumeDocument }> {
  const version = await prisma().resumeVersion.findFirst({
    // The ownership filter reaches through the relation, so a version id from
    // someone else's resume is a 404 rather than a leak.
    where: { id: versionId, resume: ownedWhere(resumeId, userId) },
  });
  if (!version) throw new NotFoundError('That version does not exist.');

  return { ...toVersionDto(version), content: parseStoredContent(version.content) };
}

/**
 * Restore an old version by appending it as a new one.
 *
 * Deliberately not a rollback. Moving a pointer backwards would erase whatever
 * came after, which is precisely the work a user is most afraid of losing when
 * they press restore.
 */
export async function restoreVersion(
  resumeId: string,
  versionId: string,
  userId: string,
): Promise<ResumeDetail> {
  const result = await prisma().$transaction(async (tx) => {
    const target = await tx.resumeVersion.findFirst({
      where: { id: versionId, resume: ownedWhere(resumeId, userId) },
    });
    if (!target) throw new NotFoundError('That version does not exist.');

    const latest = await tx.resumeVersion.findFirst({
      where: { resumeId },
      orderBy: { versionNumber: 'desc' },
    });
    if (!latest) throw new UnprocessableError('This resume has no content.');

    if (latest.contentHash === target.contentHash) {
      // Restoring what is already live. Nothing to append.
      const unchanged = await tx.resume.findFirstOrThrow({
        where: { id: resumeId },
        include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      });
      return { row: unchanged, content: target.content };
    }

    const created = await tx.resumeVersion.create({
      data: {
        resumeId,
        versionNumber: latest.versionNumber + 1,
        content: target.content as Prisma.InputJsonValue,
        contentHash: target.contentHash,
        schemaVersion: target.schemaVersion,
        changeSummary: `Restored from version ${String(target.versionNumber)}`,
        createdById: userId,
      },
    });

    const row = await tx.resume.update({
      where: { id: resumeId },
      data: {
        currentVersionId: created.id,
        atsScore: atsScoreFor(parseStoredContent(target.content), undefined),
      },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });

    return { row, content: target.content };
  });

  return {
    ...toSummary(result.row),
    content: parseStoredContent(result.content),
  };
}
