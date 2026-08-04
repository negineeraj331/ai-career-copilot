import { Router } from 'express';
import { z } from 'zod';
import { createJobDescriptionSchema, uuidSchema } from '@cc/shared';
import { sendNoContent, sendSuccess } from '../../core/http/envelope.js';
import { validate } from '../../core/http/validate.js';
import { authenticate, requireActor } from '../../middleware/authenticate.js';
import { limiters } from '../../core/security/rate-limit.js';
import * as jobs from './job.service.js';

const idParam = z.object({ id: uuidSchema });

export function jobRoutes(): Router {
  const router = Router();
  router.use(authenticate);

  router.post(
    '/',
    // Creating a JD triggers an AI extraction, so it carries the AI limiter
    // rather than the general one — quota alone would let a burst spend a
    // month's allowance in a second.
    limiters.ai(),
    validate({ body: createJobDescriptionSchema }),
    (req, res, next) => {
      void (async () => {
        try {
          const actor = requireActor(req);
          const body = req.body as {
            title: string;
            company?: string;
            rawText: string;
            sourceUrl?: string;
          };
          const result = await jobs.createJobDescription({
            userId: actor.id,
            title: body.title,
            company: body.company,
            rawText: body.rawText,
            sourceUrl: body.sourceUrl,
          });
          sendSuccess(res, result, 201);
        } catch (error) {
          next(error);
        }
      })();
    },
  );

  router.get('/', (req, res, next) => {
    void (async () => {
      try {
        const actor = requireActor(req);
        sendSuccess(res, { jobs: await jobs.listJobDescriptions(actor.id) });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get('/:id', validate({ params: idParam }), (req, res, next) => {
    void (async () => {
      try {
        const actor = requireActor(req);
        const jd = await jobs.getJobDescription(req.params.id as string, actor.id);
        sendSuccess(res, { job: { ...jd, parsed: jobs.parsedOf(jd) } });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.delete('/:id', validate({ params: idParam }), (req, res, next) => {
    void (async () => {
      try {
        const actor = requireActor(req);
        await jobs.deleteJobDescription(req.params.id as string, actor.id);
        sendNoContent(res);
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
