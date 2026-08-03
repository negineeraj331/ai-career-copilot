import { env } from '../../config/env.js';
import { pingDatabase } from '../../core/db/prisma.js';
import { pingRedis } from '../../core/redis/client.js';

/**
 * Health checks (NFR-16).
 *
 * No express import here — the service reports state, the controller decides
 * the status code. That separation is what lets this be unit-tested without
 * constructing a request.
 */

export type CheckStatus = 'ok' | 'degraded' | 'down';

export interface DependencyCheck {
  status: CheckStatus;
  latencyMs?: number;
  message?: string;
}

export interface ReadinessReport {
  status: CheckStatus;
  version: string;
  commit: string;
  uptime: number;
  checks: Record<string, DependencyCheck>;
}

const VERSION = process.env.npm_package_version ?? '0.1.0';
const COMMIT = process.env.GIT_COMMIT ?? 'dev';

/** Results are cached briefly so an aggressive probe cannot itself become the
 *  load that makes the service unhealthy. */
const CACHE_TTL_MS = 5_000;
let cached: { at: number; report: ReadinessReport } | undefined;

async function timed(check: () => Promise<boolean>): Promise<DependencyCheck> {
  const start = performance.now();
  try {
    const ok = await check();
    const latencyMs = Math.round(performance.now() - start);
    return ok ? { status: 'ok', latencyMs } : { status: 'down', latencyMs };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - start),
      message: error instanceof Error ? error.message : 'check failed',
    };
  }
}

export async function readiness(): Promise<ReadinessReport> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.report;

  const [database, redisCheck] = await Promise.all([timed(pingDatabase), timed(pingRedis)]);

  // The AI provider is reported but never probed on the health path: a network
  // call to a third party on every readiness check would make our uptime a
  // function of theirs. Real status comes from the circuit breaker once the AI
  // layer lands.
  const ai: DependencyCheck =
    env().AI_PROVIDER === 'mock'
      ? { status: 'ok', message: 'mock provider' }
      : { status: 'ok', message: 'not probed on the health path' };

  const checks = { database, redis: redisCheck, ai };

  // Only the database and Redis gate readiness. A degraded AI provider must NOT
  // fail this check: the core product works without it, and pulling healthy
  // replicas out of the load balancer over an AI outage escalates a partial
  // degradation into a full one. See docs/06 §6.
  const critical = [database.status, redisCheck.status];
  const status: CheckStatus = critical.includes('down')
    ? 'down'
    : critical.includes('degraded')
      ? 'degraded'
      : 'ok';

  const report: ReadinessReport = {
    status,
    version: VERSION,
    commit: COMMIT,
    uptime: Math.round(process.uptime()),
    checks,
  };

  cached = { at: now, report };
  return report;
}

export function resetReadinessCache(): void {
  cached = undefined;
}

export function liveness(): { status: 'ok'; uptime: number } {
  return { status: 'ok', uptime: Math.round(process.uptime()) };
}
