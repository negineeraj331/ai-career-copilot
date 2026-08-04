import { Router } from 'express';
import { z } from 'zod';
import { exportRequestSchema, uuidSchema } from '@cc/shared';
import { validate } from '../../core/http/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import * as controller from './export.controller.js';

const jobParam = z.object({ jobId: uuidSchema });

/** Mounted under /exports — the status endpoint is not resume-scoped. */
export function exportRoutes(): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/:jobId', validate({ params: jobParam }), controller.status);
  return router;
}

/** Mounted under /resumes/:id — enqueueing and history are. */
export function resumeExportRoutes(): Router {
  const router = Router({ mergeParams: true });
  router.post('/', validate({ body: exportRequestSchema }), controller.create);
  router.get('/', controller.list);
  return router;
}

export { exportRequestSchema };
