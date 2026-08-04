import { Router } from 'express';
import { z } from 'zod';
import { createAnalysisSchema, uuidSchema } from '@cc/shared';
import { sendSuccess } from '../../core/http/envelope.js';
import { validate } from '../../core/http/validate.js';
import { authenticate, requireActor } from '../../middleware/authenticate.js';
import * as analyses from './analysis.service.js';

const idParam = z.object({ id: uuidSchema });
const listQuery = z.object({ resumeId: uuidSchema.optional() });

export function analysisRoutes(): Router {
  const router = Router();
  router.use(authenticate);

  router.post('/', validate({ body: createAnalysisSchema }), (req, res, next) => {
    void (async () => {
      try {
        const actor = requireActor(req);
        const body = req.body as { resumeId: string; jobDescriptionId?: string };
        sendSuccess(
          res,
          {
            analysis: await analyses.createAnalysis({
              userId: actor.id,
              resumeId: body.resumeId,
              jobDescriptionId: body.jobDescriptionId,
            }),
          },
          201,
        );
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get('/', validate({ query: listQuery }), (req, res, next) => {
    void (async () => {
      try {
        const actor = requireActor(req);
        const { resumeId } = req.query as unknown as { resumeId?: string };
        sendSuccess(res, { analyses: await analyses.listAnalyses(actor.id, resumeId) });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get('/:id', validate({ params: idParam }), (req, res, next) => {
    void (async () => {
      try {
        const actor = requireActor(req);
        sendSuccess(res, {
          analysis: await analyses.getAnalysis(req.params.id as string, actor.id),
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
