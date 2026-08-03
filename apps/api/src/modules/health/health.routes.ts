import { Router } from 'express';
import { sendSuccess } from '../../core/http/envelope.js';
import { liveness, readiness } from './health.service.js';

export function healthRoutes(): Router {
  const router = Router();

  /**
   * Liveness. Deliberately touches no dependency — the orchestrator polls this
   * constantly, and a check that queries the database turns a slow database
   * into a restart loop.
   */
  router.get('/health', (_req, res) => {
    sendSuccess(res, liveness());
  });

  /**
   * Readiness. 503 when a critical dependency is down, so the load balancer
   * removes this replica. Returns the full report either way — a probe that
   * only says "unhealthy" sends the on-call engineer hunting.
   */
  router.get('/health/ready', async (_req, res) => {
    const report = await readiness();
    sendSuccess(res, report, report.status === 'down' ? 503 : 200);
  });

  return router;
}
