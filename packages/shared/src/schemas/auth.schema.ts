import { z } from 'zod';
import { LIMITS } from '../constants/index.js';
import { emailSchema, isoDateTimeSchema, uuidSchema } from './common.schema.js';

export const USER_ROLES = ['CANDIDATE', 'MENTOR', 'RECRUITER', 'ADMIN'] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

export const USER_TIERS = ['FREE', 'PRO', 'TEAM'] as const;
export const userTierSchema = z.enum(USER_TIERS);
export type UserTier = z.infer<typeof userTierSchema>;

export const OAUTH_PROVIDERS = ['GOOGLE', 'GITHUB'] as const;
export const oauthProviderSchema = z.enum(OAUTH_PROVIDERS);
export type OAuthProvider = z.infer<typeof oauthProviderSchema>;

/**
 * Length and a breach/common-password denylist are the controls with evidence
 * behind them. Composition rules (a symbol, a digit, mixed case) reliably produce
 * `Password1!` — so they are deliberately absent. See docs/12 §2.1.
 * The denylist itself is checked server-side; it cannot ship in the client bundle.
 */
export const passwordSchema = z
  .string()
  .min(LIMITS.PASSWORD_MIN, `Use at least ${LIMITS.PASSWORD_MIN} characters.`)
  .max(LIMITS.PASSWORD_MAX);

export const nameSchema = z.string().trim().min(1).max(LIMITS.NAME_MAX);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
  /** Extends refresh-token TTL only. It never extends the access token. */
  rememberMe: z.boolean().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** RFC 6238: 6 digits. Recovery codes go to a different endpoint field. */
export const totpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.');

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  code: totpCodeSchema,
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaRecoverySchema = z.object({
  mfaToken: z.string().min(1),
  recoveryCode: z.string().trim().min(1),
});

export const mfaConfirmSchema = z.object({ code: totpCodeSchema });

export const mfaDisableSchema = z.object({
  /** Re-authentication: disabling a second factor must cost more than a click. */
  password: z.string().min(1),
});

export const verifyEmailSchema = z.object({ token: z.string().min(1) });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const magicLinkRequestSchema = z.object({ email: emailSchema });
export const magicLinkVerifySchema = z.object({ token: z.string().min(1) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

/** The only user shape that ever leaves the API. No hash, no MFA secret,
 *  no internal counters — a response schema is a disclosure boundary. */
export const publicUserSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: userRoleSchema,
  tier: userTierSchema,
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const loginResponseSchema = z.object({
  user: publicUserSchema.optional(),
  mfaRequired: z.boolean(),
  mfaToken: z.string().optional(),
  expiresIn: z.number().int().optional(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const deviceSessionSchema = z.object({
  id: uuidSchema,
  device: z.string(),
  /** Truncated to /24 (IPv4) or /48 (IPv6). Enough to recognise a session,
   *  less PII than a full address. docs/12 §8. */
  ipPrefix: z.string(),
  lastSeenAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  current: z.boolean(),
});
export type DeviceSession = z.infer<typeof deviceSessionSchema>;

export const AUDIT_EVENTS = [
  'REGISTER',
  'EMAIL_VERIFIED',
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOGOUT',
  'LOGOUT_ALL',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'MAGIC_LINK_REQUESTED',
  'MAGIC_LINK_USED',
  'MFA_ENABLED',
  'MFA_DISABLED',
  'MFA_CHALLENGE_FAILED',
  'RECOVERY_CODE_USED',
  'OAUTH_LINKED',
  'OAUTH_UNLINKED',
  'SESSION_REVOKED',
  'REFRESH_REUSE_DETECTED',
  'ACCOUNT_LOCKED',
  'ROLE_CHANGED',
  'DATA_EXPORTED',
  'ACCOUNT_DELETED',
] as const;

export const auditEventSchema = z.enum(AUDIT_EVENTS);
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const auditLogEntrySchema = z.object({
  id: uuidSchema,
  event: auditEventSchema,
  outcome: z.enum(['SUCCESS', 'FAILURE']),
  ipPrefix: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
