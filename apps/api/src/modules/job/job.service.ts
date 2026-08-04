import { createHash } from 'node:crypto';
import { parsedJobDescriptionSchema, type ParsedJobDescription } from '@cc/shared';
import { Prisma } from '../../generated/prisma/index.js';
import { prisma } from '../../core/db/prisma.js';
import { NotFoundError } from '../../core/errors/app-error.js';
import { run } from '../ai/ai.service.js';
import type { Tier } from '../ai/quota.service.js';
import { JD_EXTRACT_JSON_SCHEMA } from './jd.schema.js';

/**
 * Job descriptions: store, then extract requirements with the AI layer.
 *
 * The content hash is the point of the whole design. The same posting pasted by
 * two users — or by one user twice — is extracted once, ever. Extraction is the
 * highest-volume AI call in the product, and docs/11's cost model only lands on
 * budget because of this.
 */

export function hashText(text: string): string {
  // Normalised first: a posting differing only in trailing whitespace or line
  // endings is the same posting, and treating it as new would pay twice.
  const normalised = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
  return createHash('sha256').update(normalised).digest('hex');
}

export async function createJobDescription(params: {
  userId: string;
  title: string;
  company?: string | undefined;
  rawText: string;
  sourceUrl?: string | undefined;
}): Promise<{ id: string; parsed: ParsedJobDescription | null }> {
  const contentHash = hashText(params.rawText);

  // Reuse a previous parse of the identical text, from any user. The parse is a
  // pure function of the posting; whose account it was pasted into is not part
  // of the answer.
  const previous = await prisma().jobDescription.findFirst({
    // Prisma models a JSON column's null as a sentinel rather than SQL NULL,
    // so `not: null` does not typecheck. Comparing against `Prisma.DbNull` is
    // the documented way to ask "has this been parsed yet".
    where: { contentHash, NOT: { parsed: { equals: Prisma.DbNull } } },
    select: { parsed: true },
  });

  const created = await prisma().jobDescription.create({
    data: {
      userId: params.userId,
      title: params.title,
      company: params.company ?? null,
      rawText: params.rawText,
      sourceUrl: params.sourceUrl ?? null,
      contentHash,
      ...(previous?.parsed ? { parsed: previous.parsed, parsedAt: new Date() } : {}),
    },
  });

  if (previous?.parsed) {
    const reused = parsedJobDescriptionSchema.safeParse(previous.parsed);
    return { id: created.id, parsed: reused.success ? reused.data : null };
  }

  // The tier is read from the database, not from the access token.
  //
  // Putting it in the JWT would mean an upgrade to Pro does not take effect
  // until the token refreshes — up to fifteen minutes of a user who has just
  // paid still being told they are out of quota. One indexed lookup is worth
  // more than that.
  const { tier } = await prisma().user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { tier: true },
  });

  const result = await run({
    feature: 'jd.extract',
    userId: params.userId,
    tier: tier as Tier,
    input: params.rawText,
    schema: parsedJobDescriptionSchema,
    jsonSchema: JD_EXTRACT_JSON_SCHEMA,
    schemaName: 'job_requirements',
    schemaDescription: 'Structured requirements extracted from a job description.',
  });

  await prisma().jobDescription.update({
    where: { id: created.id },
    data: { parsed: result.value, parsedAt: new Date() },
  });

  return { id: created.id, parsed: result.value };
}

export async function getJobDescription(id: string, userId: string) {
  const jd = await prisma().jobDescription.findFirst({ where: { id, userId } });
  if (!jd) throw new NotFoundError('That job description does not exist.');
  return jd;
}

export async function listJobDescriptions(userId: string) {
  return prisma().jobDescription.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      company: true,
      sourceUrl: true,
      parsedAt: true,
      createdAt: true,
    },
  });
}

export async function deleteJobDescription(id: string, userId: string): Promise<void> {
  const { count } = await prisma().jobDescription.deleteMany({ where: { id, userId } });
  if (count === 0) throw new NotFoundError('That job description does not exist.');
}

export function parsedOf(jd: { parsed: unknown }): ParsedJobDescription | null {
  const parsed = parsedJobDescriptionSchema.safeParse(jd.parsed);
  return parsed.success ? parsed.data : null;
}
