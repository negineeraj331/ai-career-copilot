import type { RequestHandler } from 'express';
import type { ResumeDocument } from '@cc/shared';
import { sendSuccess } from '../../core/http/envelope.js';
import { requireActor } from '../../middleware/authenticate.js';
import * as ats from './ats.service.js';

export const score: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      const body = req.body as { resumeId?: string; content?: ResumeDocument; targetRole?: string };

      // Either score a stored resume by id, or score a document the client is
      // still editing. The second form is what lets the editor show a live
      // score without saving first — the whole point of the engine being pure.
      const result = body.resumeId
        ? await ats.scoreStoredResume(body.resumeId, actor.id)
        : ats.scoreDocument(body.content as ResumeDocument, body.targetRole);

      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  })();
};
