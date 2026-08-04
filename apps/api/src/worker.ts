export {};

/**
 * The worker entrypoint (docs/03 §3.3).
 *
 * Same image as the API, different command — so a deploy cannot ship a worker
 * built from different code than the API that enqueues for it. Workers scale
 * independently because export is CPU- and memory-bound while the API is I/O-
 * bound; running them in one process means a PDF render stalls sign-ins.
 */

if (process.env.NODE_ENV !== 'production') {
  try {
    const { config: loadDotenv } = await import('dotenv');
    loadDotenv({ path: ['../../.env', '.env'], quiet: true });
  } catch {
    /* config already in the environment */
  }
}

const { Worker } = await import('bullmq');
const { loadEnv } = await import('./config/env.js');
const { loggerFor } = await import('./core/logger/logger.js');
const { QUEUE_NAMES, queueConnection, closeQueues } = await import('./core/queue/queue.js');
const { processExportJob } = await import('./modules/export/export.worker.js');
const { closeDatabase } = await import('./core/db/prisma.js');
const { closeRedis } = await import('./core/redis/client.js');

loadEnv(process.env);
const log = loggerFor('worker');

const worker = new Worker(
  QUEUE_NAMES.export,
  async (job) => {
    const { jobId } = job.data as { jobId: string };
    await processExportJob(jobId, job.attemptsMade + 1);
  },
  {
    connection: queueConnection(),
    // One at a time. Chromium is the memory-hungry part of this service, and
    // two concurrent renders on a small container is how a worker gets
    // OOM-killed mid-job — which looks to the user like an export that silently
    // never finished.
    concurrency: Number(process.env.EXPORT_CONCURRENCY ?? 1),
    // A render that has not finished in two minutes is stuck, not slow.
    lockDuration: 120_000,
  },
);

worker.on('completed', (job) => {
  log.info({ jobId: job.id }, 'export completed');
});

worker.on('failed', (job, error) => {
  log.error({ jobId: job?.id, attempts: job?.attemptsMade, err: error }, 'export failed');
});

log.info({ queue: QUEUE_NAMES.export }, 'worker started');

/**
 * Graceful shutdown.
 *
 * `worker.close()` waits for the in-flight job to finish before returning, so a
 * deploy does not abandon a half-rendered export and leave the row stuck in
 * RUNNING forever.
 */
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutting the worker down');
  await worker.close();
  await Promise.all([closeQueues(), closeDatabase(), closeRedis()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
