import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { sendError } from '../http/envelope.js';
import { loggerFor } from '../logger/logger.js';
import { getRequestId } from '../logger/request-context.js';
import {
  AccountLockedError,
  AppError,
  InternalError,
  NotFoundError,
  RateLimitedError,
  ServiceUnavailableError,
  ValidationError,
  VersionConflictError,
  isAppError,
} from './app-error.js';

const log = loggerFor('error-handler');

/** Anything that reaches here without a route matched is a 404, not a crash. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('That endpoint does not exist.'));
};

function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  // A Zod error that escapes the validation middleware means we parsed
  // something internally and it failed — surface it as a validation error
  // rather than a 500, but it still indicates a contract mismatch.
  if (error instanceof ZodError) {
    return new ValidationError(
      error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }

  // express.json() rejects malformed bodies with a SyntaxError carrying a
  // `body` property. Without this branch it would surface as a 500, which
  // blames us for the client's broken JSON.
  if (
    error instanceof SyntaxError &&
    'body' in error &&
    'status' in error &&
    (error as { status?: number }).status === 400
  ) {
    return new ValidationError([{ field: '(body)', message: 'Malformed JSON.' }]);
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: string }).type === 'entity.too.large'
  ) {
    return new AppError('PAYLOAD_TOO_LARGE', 413, 'That request is too large.');
  }

  return new InternalError(error);
}

/**
 * Terminal error handler (TR-02). Must be registered last, and must keep all
 * four parameters — Express identifies error middleware by arity, so dropping
 * the unused `next` silently turns this into a normal handler that never runs.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const appError = toAppError(error);

  if (appError.expected) {
    log.info(
      { code: appError.code, status: appError.status },
      'request failed with an expected error',
    );
  } else {
    // Unexpected: log everything we have, against the same request ID the
    // client is holding, so a support report maps to one log line.
    log.error(
      {
        code: appError.code,
        status: appError.status,
        err: appError.cause ?? appError,
        stack: appError.stack,
      },
      'unhandled error',
    );
  }

  if (appError instanceof RateLimitedError || appError instanceof AccountLockedError) {
    res.setHeader('Retry-After', String(appError.retryAfterSeconds));
  }
  if (appError instanceof ServiceUnavailableError && appError.retryAfterSeconds) {
    res.setHeader('Retry-After', String(appError.retryAfterSeconds));
  }
  if (appError instanceof VersionConflictError) {
    res.setHeader('X-Current-Version', String(appError.currentVersion));
  }

  // If the response already started streaming we cannot rewrite the status;
  // destroying the socket is the only honest signal that it is incomplete.
  if (res.headersSent) {
    log.error({ requestId: getRequestId() }, 'error after headers sent; destroying response');
    res.destroy();
    return;
  }

  sendError(res, appError.status, appError.code, appError.message, appError.details);
};
