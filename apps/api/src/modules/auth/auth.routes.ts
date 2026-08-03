import { Router } from 'express';
import { z } from 'zod';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  magicLinkRequestSchema,
  magicLinkVerifySchema,
  mfaConfirmSchema,
  mfaDisableSchema,
  registerSchema,
  resetPasswordSchema,
  uuidSchema,
  verifyEmailSchema,
} from '@cc/shared';
import { validate } from '../../core/http/validate.js';
import { limiters } from '../../core/security/rate-limit.js';
import { authenticate } from '../../middleware/authenticate.js';
import * as controller from './auth.controller.js';
import * as oauth from './oauth/oauth.controller.js';

/**
 * Either a TOTP code or a recovery code, never both and never neither. Doing
 * this in the schema means the service can trust it rather than re-checking.
 */
const mfaVerifyBodySchema = z
  .object({
    mfaToken: z.string().min(1),
    code: z
      .string()
      .regex(/^\d{6}$/, 'Enter the 6-digit code.')
      .optional(),
    recoveryCode: z.string().trim().min(1).optional(),
    rememberMe: z.boolean().default(false),
  })
  .refine((b) => Boolean(b.code) !== Boolean(b.recoveryCode), {
    message: 'Provide either an authenticator code or a recovery code.',
    path: ['code'],
  });

export function authRoutes(): Router {
  const router = Router();

  // ── Public ────────────────────────────────────────────────────────────────
  // Auth-sensitive limiters fail closed when Redis is unavailable; the rest of
  // the API fails open. See docs/12 §6.

  router.post(
    '/register',
    limiters.register(),
    validate({ body: registerSchema }),
    controller.register,
  );
  router.post('/login', limiters.login(), validate({ body: loginSchema }), controller.login);
  router.post('/mfa/verify', validate({ body: mfaVerifyBodySchema }), controller.verifyMfa);

  // Refresh takes no body — it reads the httpOnly cookie. It still requires a
  // CSRF token, applied globally: it is a state-changing request.
  router.post('/refresh', controller.refresh);

  router.post('/verify-email', validate({ body: verifyEmailSchema }), controller.verifyEmail);
  router.post(
    '/resend-verification',
    limiters.passwordReset(),
    validate({ body: forgotPasswordSchema }),
    controller.resendVerification,
  );

  router.post(
    '/forgot-password',
    limiters.passwordReset(),
    validate({ body: forgotPasswordSchema }),
    controller.forgotPassword,
  );
  router.post('/reset-password', validate({ body: resetPasswordSchema }), controller.resetPassword);

  router.post(
    '/magic-link',
    limiters.passwordReset(),
    validate({ body: magicLinkRequestSchema }),
    controller.requestMagicLink,
  );
  router.post(
    '/magic-link/verify',
    validate({ body: magicLinkVerifySchema }),
    controller.verifyMagicLink,
  );

  // ── Authenticated ─────────────────────────────────────────────────────────

  router.post('/logout', authenticate, controller.logout);
  router.post('/logout-all', authenticate, controller.logoutAll);

  router.get('/me', authenticate, controller.me);
  router.get('/sessions', authenticate, controller.listSessions);
  router.delete(
    '/sessions/:id',
    authenticate,
    validate({ params: z.object({ id: uuidSchema }) }),
    controller.revokeSession,
  );

  router.post(
    '/change-password',
    authenticate,
    validate({ body: changePasswordSchema }),
    controller.changePassword,
  );

  router.post('/mfa/setup', authenticate, controller.setupMfa);
  router.post(
    '/mfa/confirm',
    authenticate,
    validate({ body: mfaConfirmSchema }),
    controller.confirmMfa,
  );
  router.delete('/mfa', authenticate, validate({ body: mfaDisableSchema }), controller.disableMfa);

  router.get('/audit-log', authenticate, controller.auditLog);

  // ── OAuth ─────────────────────────────────────────────────────────────────
  // These are GETs, so the CSRF middleware safe-lists them. The single-use
  // `state` in Redis is what protects the handshake — the callback arrives via
  // the provider's redirect and carries neither a header nor a body we control.
  const providerParam = z.object({ provider: z.enum(['google', 'github']) });

  router.get('/oauth/:provider', validate({ params: providerParam }), oauth.start);
  router.get('/oauth/:provider/callback', validate({ params: providerParam }), oauth.callback);

  router.get('/oauth', authenticate, oauth.listLinked);
  router.post(
    '/oauth/:provider/link',
    authenticate,
    validate({ params: providerParam }),
    oauth.startLink,
  );
  router.delete(
    '/oauth/:provider',
    authenticate,
    validate({ params: providerParam }),
    oauth.unlink,
  );

  return router;
}
