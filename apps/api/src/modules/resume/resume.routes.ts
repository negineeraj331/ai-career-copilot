import { Router } from 'express';
import { z } from 'zod';
import {
  createResumeSchema,
  paginationQuerySchema,
  updateResumeSchema,
  uuidSchema,
} from '@cc/shared';
import { validate } from '../../core/http/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resumeExportRoutes } from '../export/export.routes.js';
import * as controller from './resume.controller.js';

const idParam = z.object({ id: uuidSchema });
const versionParams = z.object({ id: uuidSchema, versionId: uuidSchema });

export function resumeRoutes(): Router {
  const router = Router();

  // Every route here is owner-scoped. `authenticate` is applied once at the
  // router rather than per route, so a new endpoint cannot be added
  // accidentally unauthenticated — the failure mode of per-route auth is that
  // the one line someone forgets is invisible in review.
  router.use(authenticate);

  router.get('/', validate({ query: paginationQuerySchema }), controller.list);
  router.post('/', validate({ body: createResumeSchema }), controller.create);

  router.get('/:id', validate({ params: idParam }), controller.detail);
  router.patch('/:id', validate({ params: idParam, body: updateResumeSchema }), controller.update);
  router.delete('/:id', validate({ params: idParam }), controller.remove);
  router.post('/:id/duplicate', validate({ params: idParam }), controller.duplicate);

  // Nested rather than a flat path, so ownership and the :id param are
  // validated once for both the resume and its exports.
  router.use('/:id/export', validate({ params: idParam }), resumeExportRoutes());

  router.get('/:id/versions', validate({ params: idParam }), controller.versions);
  router.get('/:id/versions/:versionId', validate({ params: versionParams }), controller.version);
  router.post(
    '/:id/versions/:versionId/restore',
    validate({ params: versionParams }),
    controller.restore,
  );

  return router;
}
