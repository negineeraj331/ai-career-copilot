import { Router } from 'express';
import { z } from 'zod';
import { resumeDocumentSchema, uuidSchema } from '@cc/shared';
import { validate } from '../../core/http/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import * as controller from './ats.controller.js';

/**
 * Exactly one of `resumeId` or `content`. Enforced in the schema rather than the
 * controller so the service can trust its input, and so the client gets a 400
 * naming the problem instead of a 500 from an undefined document.
 */
const scoreBodySchema = z
  .object({
    resumeId: uuidSchema.optional(),
    content: resumeDocumentSchema.optional(),
    targetRole: z.string().trim().max(120).optional(),
  })
  .refine((v) => Boolean(v.resumeId) !== Boolean(v.content), {
    message: 'Provide either resumeId or content, but not both.',
  });

export function atsRoutes(): Router {
  const router = Router();
  router.use(authenticate);
  router.post('/score', validate({ body: scoreBodySchema }), controller.score);
  return router;
}
