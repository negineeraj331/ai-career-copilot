import type { RequestHandler } from 'express';
import type { CreateResumeInput, UpdateResumeInput } from '@cc/shared';
import { sendNoContent, sendSuccess } from '../../core/http/envelope.js';
import { requireActor } from '../../middleware/authenticate.js';
import * as resumes from './resume.service.js';

/**
 * HTTP in, service call, HTTP out. No business logic and no database access —
 * the ESLint config fails the build on either.
 */

export const list: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      const query = req.query as unknown as { limit: number; cursor?: string };
      sendSuccess(res, await resumes.listResumes(actor.id, query));
    } catch (error) {
      next(error);
    }
  })();
};

export const create: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      const resume = await resumes.createResume(actor.id, req.body as CreateResumeInput);
      sendSuccess(res, { resume }, 201);
    } catch (error) {
      next(error);
    }
  })();
};

export const detail: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      sendSuccess(res, { resume: await resumes.getResume(req.params.id as string, actor.id) });
    } catch (error) {
      next(error);
    }
  })();
};

export const update: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      const resume = await resumes.updateResume(
        req.params.id as string,
        actor.id,
        req.body as UpdateResumeInput,
      );
      sendSuccess(res, { resume });
    } catch (error) {
      next(error);
    }
  })();
};

export const remove: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      await resumes.deleteResume(req.params.id as string, actor.id);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  })();
};

export const duplicate: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      const resume = await resumes.duplicateResume(req.params.id as string, actor.id);
      sendSuccess(res, { resume }, 201);
    } catch (error) {
      next(error);
    }
  })();
};

export const versions: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      sendSuccess(res, { versions: await resumes.listVersions(req.params.id as string, actor.id) });
    } catch (error) {
      next(error);
    }
  })();
};

export const version: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      sendSuccess(res, {
        version: await resumes.getVersion(
          req.params.id as string,
          req.params.versionId as string,
          actor.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  })();
};

export const restore: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      const resume = await resumes.restoreVersion(
        req.params.id as string,
        req.params.versionId as string,
        actor.id,
      );
      sendSuccess(res, { resume }, 201);
    } catch (error) {
      next(error);
    }
  })();
};
