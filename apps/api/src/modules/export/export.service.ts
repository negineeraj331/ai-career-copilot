import { FORMAT_META } from '@cc/exporters';
import type { ExportFormat } from '@cc/shared';
import { prisma } from '../../core/db/prisma.js';
import { NotFoundError, UnprocessableError } from '../../core/errors/app-error.js';
import { QUEUE_NAMES, queue } from '../../core/queue/queue.js';
import { signedDownloadUrl } from '../../core/storage/storage.js';

/**
 * Export jobs.
 *
 * The endpoint enqueues and returns; the worker renders. That split is what
 * FR-26 asks for and what a PDF render needs — seconds of CPU and a few hundred
 * megabytes of Chromium is not work to do on a web process while a browser
 * holds the connection open.
 */

export interface ExportJobView {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED';
  format: ExportFormat;
  templateId: string;
  bytes: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Present only when the job is READY. Short-lived and pre-signed. */
  downloadUrl?: string;
}

export async function enqueueExport(params: {
  resumeId: string;
  userId: string;
  format: ExportFormat;
  templateId?: string;
}): Promise<ExportJobView> {
  const resume = await prisma().resume.findFirst({
    where: { id: params.resumeId, userId: params.userId, deletedAt: null },
    include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  });
  if (!resume) throw new NotFoundError('That resume does not exist.');

  const current = resume.versions[0];
  if (!current) throw new UnprocessableError('This resume has no content to export.');

  const job = await prisma().exportJob.create({
    data: {
      userId: params.userId,
      resumeId: params.resumeId,
      // Pinned now, not read later. Without this, editing a resume while an
      // export is queued produces a file matching neither what the user saw nor
      // what they asked for.
      versionId: current.id,
      format: params.format,
      templateId: params.templateId ?? resume.templateId,
    },
  });

  await queue(QUEUE_NAMES.export).add(
    'render',
    { jobId: job.id },
    // The database row is the record; the queue entry is just a wake-up. Using
    // the job id as the BullMQ id makes a duplicate enqueue idempotent.
    { jobId: job.id },
  );

  return toView(job);
}

export async function getExportJob(jobId: string, userId: string): Promise<ExportJobView> {
  const job = await prisma().exportJob.findFirst({ where: { id: jobId, userId } });
  if (!job) throw new NotFoundError('That export does not exist.');

  const view = toView(job);
  if (job.status === 'READY' && job.objectKey) {
    view.downloadUrl = await signedDownloadUrl(job.objectKey);
  }
  return view;
}

export async function listExportJobs(resumeId: string, userId: string): Promise<ExportJobView[]> {
  const resume = await prisma().resume.findFirst({
    where: { id: resumeId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!resume) throw new NotFoundError('That resume does not exist.');

  const jobs = await prisma().exportJob.findMany({
    where: { resumeId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return jobs.map(toView);
}

/** The object key for a finished export. Namespaced by user so a bucket listing
 *  cannot be walked from one account into another. */
export function objectKeyFor(job: { id: string; userId: string; format: ExportFormat }): string {
  return `${job.userId}/${job.id}.${FORMAT_META[job.format].extension}`;
}

function toView(job: {
  id: string;
  status: string;
  format: string;
  templateId: string;
  bytes: number | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): ExportJobView {
  return {
    id: job.id,
    status: job.status as ExportJobView['status'],
    format: job.format as ExportFormat,
    templateId: job.templateId,
    bytes: job.bytes,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}
