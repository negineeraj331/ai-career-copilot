import type { ErrorCode } from '@cc/shared';

export interface FieldError {
  field: string;
  message: string;
}

/**
 * One error hierarchy for the whole service (TR-02).
 *
 * Every instance carries an HTTP status, a stable machine code the client
 * switches on, and a message that is *always safe to show a user*. Anything an
 * attacker could learn from — a driver error, a stack trace, a SQL fragment —
 * stays in `cause` and reaches the logs only.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: FieldError[];
  /** True for errors that are part of normal operation (a 404, a validation
   *  failure). These are not reported to Sentry — burying real bugs under
   *  ordinary traffic is how alerting stops being useful. */
  readonly expected: boolean;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options: { details?: FieldError[]; cause?: unknown; expected?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = options.details;
    this.expected = options.expected ?? true;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(details: FieldError[], message = 'Some fields need attention.') {
    super('VALIDATION_ERROR', 400, message, { details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Please sign in to continue.') {
    super('UNAUTHENTICATED', 401, message);
  }
}

export class MfaRequiredError extends AppError {
  constructor(message = 'Enter your authentication code to continue.') {
    super('MFA_REQUIRED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that.') {
    super('FORBIDDEN', 403, message);
  }
}

export class CsrfError extends AppError {
  constructor(message = 'Your session expired. Refresh the page and try again.') {
    super('CSRF_INVALID', 403, message);
  }
}

/**
 * Also the correct response when a user asks for a resource they do not own.
 * Returning 403 there would confirm the resource exists, which is an
 * enumeration oracle. See docs/12 §3.
 */
export class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super('NOT_FOUND', 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: FieldError[]) {
    super('CONFLICT', 409, message, { details });
  }
}

/**
 * Optimistic-concurrency failure on a versioned resource.
 *
 * docs/06 promises the 409 carries the server's current version, and a client
 * cannot act on a number buried in an English sentence — the editor needs it to
 * offer "reload and reapply". `details` is FieldError[] and holds strings only,
 * so the number rides on the class and the handler puts it in a header, which
 * is exactly how RateLimitedError already surfaces Retry-After.
 */
export class VersionConflictError extends AppError {
  readonly currentVersion: number;
  constructor(currentVersion: number, expectedVersion: number) {
    super(
      'CONFLICT',
      409,
      'This resume changed somewhere else. Reload to get the latest version.',
      {
        details: [
          {
            field: 'expectedVersion',
            message: `Sent ${String(expectedVersion)}, but the current version is ${String(currentVersion)}.`,
          },
        ],
      },
    );
    this.currentVersion = currentVersion;
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'That file is too large.') {
    super('PAYLOAD_TOO_LARGE', 413, message);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, details?: FieldError[]) {
    super('UNPROCESSABLE', 422, message, { details });
  }
}

export class AccountLockedError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super('ACCOUNT_LOCKED', 423, 'Too many failed attempts. Try again shortly.');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = 'Too many requests. Please slow down.') {
    super('RATE_LIMITED', 429, message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class QuotaExceededError extends AppError {
  constructor(message: string, details?: FieldError[]) {
    super('QUOTA_EXCEEDED', 429, message, { details });
  }
}

export class AiUnavailableError extends AppError {
  constructor(message = 'AI features are temporarily unavailable. Everything else still works.') {
    super('AI_UNAVAILABLE', 503, message, { expected: false });
  }
}

export class ServiceUnavailableError extends AppError {
  readonly retryAfterSeconds?: number;
  constructor(
    message = 'Temporarily unavailable. Please try again shortly.',
    retryAfterSeconds?: number,
  ) {
    super('SERVICE_UNAVAILABLE', 503, message, { expected: false });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Wraps anything unexpected. The message is deliberately generic — the real
 *  cause is logged against the request ID the client is given. */
export class InternalError extends AppError {
  constructor(cause?: unknown) {
    super('INTERNAL_ERROR', 500, 'Something went wrong on our end.', {
      cause,
      expected: false,
    });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
