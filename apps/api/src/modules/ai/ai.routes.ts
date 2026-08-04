import { Router } from 'express';
import { z } from 'zod';
import { bulletOptimizeSchema } from '@cc/shared';
import { sendSuccess } from '../../core/http/envelope.js';
import { validate } from '../../core/http/validate.js';
import { limiters } from '../../core/security/rate-limit.js';
import { authenticate, requireActor } from '../../middleware/authenticate.js';
import * as writing from './writing.service.js';

const generateSchema = z.object({
  rawInput: z.string().trim().min(10).max(2000),
  role: z.string().trim().max(120).optional(),
});

const suggestSchema = z.object({
  resumeText: z.string().trim().min(20).max(20_000),
});

/**
 * The write-capable AI endpoints.
 *
 * Every one is behind `limiters.ai()` as well as the monthly quota: quota bounds
 * the month, the limiter bounds the minute, and without the second a loop could
 * spend the first in a second.
 */
export function aiRoutes(): Router {
  const router = Router();
  router.use(authenticate);

  router.post(
    '/bullet/optimize',
    limiters.ai(),
    validate({ body: bulletOptimizeSchema }),
    (req, res, next) => {
      void (async () => {
        try {
          const actor = requireActor(req);
          const body = req.body as {
            bullets: { id: string; text: string }[];
            context?: { role?: string };
          };
          sendSuccess(
            res,
            await writing.optimiseBullets({
              userId: actor.id,
              bullets: body.bullets,
              role: body.context?.role,
            }),
          );
        } catch (error) {
          next(error);
        }
      })();
    },
  );

  router.post(
    '/bullet/generate',
    limiters.ai(),
    validate({ body: generateSchema }),
    (req, res, next) => {
      void (async () => {
        try {
          const actor = requireActor(req);
          const body = req.body as { rawInput: string; role?: string };
          sendSuccess(
            res,
            await writing.generateBullet({
              userId: actor.id,
              rawInput: body.rawInput,
              role: body.role,
            }),
          );
        } catch (error) {
          next(error);
        }
      })();
    },
  );

  router.post(
    '/skills/suggest',
    limiters.ai(),
    validate({ body: suggestSchema }),
    (req, res, next) => {
      void (async () => {
        try {
          const actor = requireActor(req);
          const body = req.body as { resumeText: string };
          sendSuccess(
            res,
            await writing.suggestSkills({ userId: actor.id, resumeText: body.resumeText }),
          );
        } catch (error) {
          next(error);
        }
      })();
    },
  );

  // No AI limiter: reading your own quota costs nothing and must keep working
  // precisely when you have run out.
  router.get('/usage', (req, res, next) => {
    void (async () => {
      try {
        const actor = requireActor(req);
        sendSuccess(res, await writing.quotaFor(actor.id));
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
