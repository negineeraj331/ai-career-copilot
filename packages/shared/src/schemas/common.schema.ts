import { z } from 'zod';
import { LIMITS } from '../constants/index.js';

/** Primitives reused everywhere. Defined once so validation cannot drift between
 *  the API and the web client — both import these exact objects. */

export const uuidSchema = z.uuid();

/**
 * Normalise BEFORE validating, not after.
 *
 * `.trim()` and `.toLowerCase()` are transforms that run *after* the checks they
 * follow, so `z.email().trim()` would reject a pasted "  User@Example.com  " as
 * malformed instead of cleaning it up. Piping puts normalisation first, which is
 * also what SRS FR-01 specifies.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.').max(LIMITS.EMAIL_MAX));

export const urlSchema = z.url();
export const isoDateTimeSchema = z.iso.datetime();

/** Month precision (`2024-06`) — resumes state months, not days, and pretending
 *  to day precision would force users to invent a day they do not remember. */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

/** Cursor pagination. Offset pagination drifts when rows are inserted mid-scroll,
 *  which is exactly what happens on a live dashboard. See docs/06 §1.5. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).default(LIMITS.PAGE_SIZE_DEFAULT),
  cursor: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const pageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});
export type PageInfo = z.infer<typeof pageInfoSchema>;

/** Machine-readable error codes. The client switches on these, never on the
 *  human-readable message. Kept in sync with docs/06 §1.3. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'MFA_REQUIRED',
  'FORBIDDEN',
  'CSRF_INVALID',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNPROCESSABLE',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'ACCOUNT_LOCKED',
  'AI_UNAVAILABLE',
  'AI_REFUSED',
  'AI_INVALID_OUTPUT',
  // Distinct from INTERNAL_ERROR: the request was not served because a
  // dependency is down, not because our code failed. Retrying may succeed,
  // so the client should back off rather than treat it as a bug.
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const fieldErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
});

export const responseMetaSchema = z.object({
  requestId: z.string(),
  timestamp: isoDateTimeSchema,
});

export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: errorCodeSchema,
    /** Always safe to render to a user. Internals never cross this boundary. */
    message: z.string(),
    details: z.array(fieldErrorSchema).optional(),
  }),
  meta: responseMetaSchema,
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Builds the success envelope for a given payload schema.
 *  `successEnvelope(userSchema)` → `{ success: true, data: User, meta }`. */
export function successEnvelope<T extends z.ZodType>(data: T) {
  return z.object({
    success: z.literal(true),
    data,
    meta: responseMetaSchema,
  });
}

/** Builds a cursor-paginated list envelope for a given item schema. */
export function paginatedEnvelope<T extends z.ZodType>(item: T) {
  return successEnvelope(
    z.object({
      items: z.array(item),
      pageInfo: pageInfoSchema,
    }),
  );
}
