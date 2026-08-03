import type { Response } from 'express';
import type { ErrorCode } from '@cc/shared';
import type { FieldError } from '../errors/app-error.js';
import { getRequestId } from '../logger/request-context.js';

/**
 * The single response shape (docs/06 §1.2). Handlers call these rather than
 * `res.json` directly, so every response carries the envelope and correlation
 * metadata without each route remembering to add it.
 */

function meta(): { requestId: string; timestamp: string } {
  return {
    requestId: getRequestId() ?? 'unknown',
    timestamp: new Date().toISOString(),
  };
}

export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data, meta: meta() });
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: FieldError[],
): void {
  res.status(status).json({
    success: false,
    error: { code, message, ...(details?.length ? { details } : {}) },
    meta: meta(),
  });
}

export function sendNoContent(res: Response): void {
  res.status(204).end();
}
