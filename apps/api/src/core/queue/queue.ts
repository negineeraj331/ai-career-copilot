import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../../config/env.js';
import { loggerFor } from '../logger/logger.js';

/**
 * BullMQ queues (docs/03 §3.3).
 *
 * A separate Redis connection from the rate limiter and cache, because BullMQ
 * needs `maxRetriesPerRequest: null` for its blocking reads — the setting that
 * makes a worker wait on a job rather than time out. Sharing the app's
 * connection would force that setting on the rate limiter too, where a hung
 * command is exactly what we do not want.
 */

const log = loggerFor('queue');

export const QUEUE_NAMES = {
  export: 'export',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

let connection: IORedis | undefined;
const queues = new Map<QueueName, Queue>();

export function queueConnection(): IORedis {
  connection ??= new IORedis(env().REDIS_URL, {
    // Required by BullMQ: its blocking commands must not be aborted by the
    // client's own retry ceiling.
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  });
  return connection;
}

export function queue(name: QueueName): Queue {
  let existing = queues.get(name);
  if (!existing) {
    existing = new Queue(name, {
      connection: queueConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queues.set(name, existing);
  }
  return existing;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  // Keep a short tail of finished jobs for debugging, then let Redis reclaim
  // the memory. An unbounded completed set is a slow memory leak that only
  // shows up in production, weeks in.
  removeOnComplete: { age: 3600, count: 100 },
  removeOnFail: { age: 24 * 3600, count: 500 },
};

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    await connection.quit();
    connection = undefined;
  }
}

export async function pingQueue(): Promise<boolean> {
  try {
    await queueConnection().ping();
    return true;
  } catch (error) {
    log.error({ err: error }, 'queue connection unavailable');
    return false;
  }
}
