import { FORMAT_META } from '@cc/exporters';
import { resumeDocumentSchema, type ExportFormat } from '@cc/shared';
import { prisma } from '../../core/db/prisma.js';
import { loggerFor } from '../../core/logger/logger.js';
import { putObject } from '../../core/storage/storage.js';
import { objectKeyFor } from './export.service.js';
import { render } from './render.js';

/**
 * The job body: load the pinned version, render it, store it, record the result.
 *
 * Every failure path has to leave the row in a state the client can act on. A
 * job that throws without updating the row shows the user "queued" forever,
 * which is worse than an error — they wait instead of retrying.
 */

const log = loggerFor('export-worker');

const APP_VERSION = process.env.APP_VERSION ?? '0.1.0';

export async function processExportJob(jobId: string, attempt: number): Promise<void> {
  const job = await prisma().exportJob.findUnique({
    where: { id: jobId },
    include: { resume: { select: { title: true } } },
  });
  if (!job) {
    // The resume was deleted between enqueue and pickup. Nothing to do, and
    // nothing to report — cascading the delete already removed the row.
    log.warn({ jobId }, 'export job no longer exists; skipping');
    return;
  }

  await prisma().exportJob.update({
    where: { id: jobId },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: attempt },
  });

  try {
    const version = await prisma().resumeVersion.findUnique({ where: { id: job.versionId } });
    if (!version) throw new Error('The pinned resume version no longer exists.');

    // Re-parsed rather than cast: the document has been through jsonb, and a
    // renderer that trusts its shape fails somewhere deep in string building
    // where the message names a template rather than the data.
    const doc = resumeDocumentSchema.parse(version.content);

    const { body, contentType, extension } = await render(
      doc,
      job.format as ExportFormat,
      job.templateId,
      { exportedAt: new Date().toISOString(), appVersion: APP_VERSION },
    );

    const key = objectKeyFor({
      id: job.id,
      userId: job.userId,
      format: job.format as ExportFormat,
    });
    await putObject({
      key,
      body,
      contentType,
      filename: `${slugify(job.resume.title)}.${extension}`,
    });

    await prisma().exportJob.update({
      where: { id: jobId },
      data: {
        status: 'READY',
        objectKey: key,
        bytes: body.byteLength,
        completedAt: new Date(),
        error: null,
      },
    });
  } catch (error) {
    // The message stored on the row is written for a user; the real cause goes
    // to the logs against the job id. A stack trace in a UI helps nobody and
    // tells an attacker about the inside of the service.
    log.error({ jobId, err: error, format: job.format }, 'export render failed');

    await prisma().exportJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error: userFacingError(job.format as ExportFormat, error),
      },
    });

    // Rethrown so BullMQ counts the attempt and retries with backoff. The row
    // is updated first, so a client polling between attempts sees FAILED rather
    // than a stall — and a later attempt flips it back to RUNNING.
    throw error;
  }
}

function userFacingError(format: ExportFormat, error: unknown): string {
  if (
    FORMAT_META[format].needsBrowser &&
    error instanceof Error &&
    /Chromium/i.test(error.message)
  ) {
    return 'PDF export is temporarily unavailable on this server. Try DOCX or Markdown, or retry shortly.';
  }
  return 'Could not generate this export. Please try again.';
}

/** A filename a browser and an operating system will both accept. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'resume';
}
