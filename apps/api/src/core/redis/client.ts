import { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { loggerFor } from '../logger/logger.js';

const log = loggerFor('redis');

let client: Redis | undefined;

/**
 * Redis connection (sessions, rate limits, cache, queue).
 *
 * `commandTimeout` is the important setting: a command that hangs holds an
 * Express request open, and a slow dependency that never errors is worse than
 * one that fails fast. The rate limiter treats a failure as a decision rather
 * than something to wait out.
 *
 * The offline queue stays ON, deliberately. With it off, every command issued
 * before the socket is ready — at startup, and during any reconnect or
 * failover — is rejected outright. That would mean a brief Redis blip returns
 * 503 from every fail-closed route (login, register, password reset), turning
 * a one-second reconnect into a visible auth outage. Buffering instead, with
 * `commandTimeout` as the ceiling, gives the best of both: short interruptions
 * are invisible, and a genuinely dead Redis still errors within a second
 * rather than queueing forever.
 */
export function redis(): Redis {
  if (client) return client;

  client = new Redis(env().REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    connectTimeout: 2_000,
    commandTimeout: 1_000,
    lazyConnect: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
  });

  // ioredis emits 'error' on every reconnect attempt. Without a listener Node
  // treats it as an unhandled error event and kills the process — a Redis blip
  // must not take the API down.
  client.on('error', (error: Error) => {
    log.warn({ err: error.message }, 'redis connection error');
  });
  client.on('ready', () => log.info('redis ready'));

  return client;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const result = await redis().ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  await client.quit().catch(() => client?.disconnect());
  client = undefined;
}
