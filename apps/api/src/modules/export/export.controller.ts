import type { RequestHandler } from 'express';
import type { ExportFormat } from '@cc/shared';
import { sendSuccess } from '../../core/http/envelope.js';
import { requireActor } from '../../middleware/authenticate.js';
import * as exports from './export.service.js';

export const create: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      const body = req.body as { format: ExportFormat; templateId?: string };
      const job = await exports.enqueueExport({
        resumeId: req.params.id as string,
        userId: actor.id,
        format: body.format,
        ...(body.templateId ? { templateId: body.templateId } : {}),
      });

      // 202, not 200: the work has been accepted, not done. `statusUrl` saves
      // the client from constructing it and getting the version prefix wrong.
      sendSuccess(res, { jobId: job.id, statusUrl: `/api/v1/exports/${job.id}`, job }, 202);
    } catch (error) {
      next(error);
    }
  })();
};

export const status: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      sendSuccess(res, {
        job: await exports.getExportJob(req.params.jobId as string, actor.id),
      });
    } catch (error) {
      next(error);
    }
  })();
};

export const list: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      sendSuccess(res, {
        jobs: await exports.listExportJobs(req.params.id as string, actor.id),
      });
    } catch (error) {
      next(error);
    }
  })();
};
