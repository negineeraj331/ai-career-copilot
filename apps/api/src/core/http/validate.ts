import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../errors/app-error.js';

/**
 * Zod validation middleware (TR-04).
 *
 * Parsing happens once, at the edge. Everything downstream works with parsed,
 * typed values — a service should never be the thing that discovers a body was
 * the wrong shape.
 *
 * The parsed result *replaces* the raw input, so defaults, coercions, and
 * normalisations (lowercased emails, trimmed strings) actually reach the
 * handler. Validating without assigning back is a common and quiet mistake:
 * everything passes, and none of the transforms apply.
 */

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const errors: { field: string; message: string }[] = [];

    for (const source of ['body', 'query', 'params'] as const) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (result.success) {
        if (source === 'query') {
          // Express 5 makes req.query a getter with no setter, so assigning to
          // it throws. Redefine the property instead of silently losing the
          // parsed value — this is the one place the usual pattern breaks.
          Object.defineProperty(req, 'query', {
            value: result.data,
            writable: true,
            configurable: true,
            enumerable: true,
          });
        } else {
          req[source] = result.data as never;
        }
        continue;
      }

      for (const issue of result.error.issues) {
        errors.push({
          field: [source === 'body' ? '' : source, ...issue.path].filter(Boolean).join('.'),
          message: issue.message,
        });
      }
    }

    // Report every field at once. Returning the first failure makes a user fix
    // a five-field form one round trip at a time.
    if (errors.length > 0) {
      next(new ValidationError(errors));
      return;
    }

    next();
  };
}
