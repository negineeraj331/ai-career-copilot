import type { Request, RequestHandler, Response } from 'express';
import { UnauthenticatedError } from '../../core/errors/app-error.js';
import { sendNoContent, sendSuccess } from '../../core/http/envelope.js';
import { getContext } from '../../core/logger/request-context.js';
import { truncateIp } from '../../core/security/request-id.js';
import { requireActor } from '../../middleware/authenticate.js';
import * as auth from './auth.service.js';
import { REFRESH_COOKIE, clearSessionCookies, setSessionCookies } from './session-cookies.js';

/**
 * Controllers translate HTTP to service calls and back. No business logic, no
 * database access — a controller that reaches past the service layer is a
 * review rejection, and the ESLint config enforces it.
 */

function meta(req: Request): auth.RequestMeta {
  return {
    userAgent: req.header('user-agent'),
    // Read the truncated value the requestContext middleware already computed.
    //
    // An earlier version did `req.ip.replace(/^::ffff:/, '')` here, which only
    // strips the IPv6-mapped prefix and leaves the address whole — so device
    // sessions stored full IPs while the audit log (which reads the context)
    // stored /24s. The tests passed because they only asserted the audit log;
    // a live run showed `127.0.0.1` sitting in the session list.
    ipPrefix: getContext()?.ipPrefix ?? truncateIp(req.ip) ?? 'unknown',
  };
}

export const register: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      await auth.register(req.body as Parameters<typeof auth.register>[0], meta(req));
      // Identical 201 whether or not the address was taken — see auth.service.
      sendSuccess(
        res,
        {
          message: 'Check your email to verify your account.',
          email: (req.body as { email: string }).email,
        },
        201,
      );
    } catch (error) {
      next(error);
    }
  })();
};

export const login: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const body = req.body as { email: string; password: string; rememberMe: boolean };
      const result = await auth.login(body, meta(req));

      if (result.kind === 'mfa') {
        // No session cookies: the password is only the first factor.
        sendSuccess(res, {
          mfaRequired: true,
          mfaToken: result.mfaToken,
          expiresIn: result.expiresIn,
        });
        return;
      }

      setSessionCookies(res, result.session);
      sendSuccess(res, { user: result.user, mfaRequired: false });
    } catch (error) {
      next(error);
    }
  })();
};

export const verifyMfa: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const body = req.body as { mfaToken: string; code?: string; recoveryCode?: string };
      const result = await auth.completeMfa(body, meta(req));
      setSessionCookies(res, result.session);
      sendSuccess(res, { user: result.user, mfaRequired: false });
    } catch (error) {
      next(error);
    }
  })();
};

export const refresh: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const cookies = req.cookies as Record<string, string> | undefined;
      const token = cookies?.[REFRESH_COOKIE];
      if (!token) throw new UnauthenticatedError('Please sign in again.');

      const session = await auth.refresh(token, meta(req));
      setSessionCookies(res, session);
      sendSuccess(res, { refreshed: true });
    } catch (error) {
      // Any refresh failure clears the cookies. Leaving a dead token in the
      // browser makes the client retry forever against a token that can never
      // succeed.
      clearSessionCookies(res);
      next(error);
    }
  })();
};

export const logout: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      await auth.logout(actor.sessionId, actor.id);
      clearSessionCookies(res);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  })();
};

export const logoutAll: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      await auth.logoutAll(actor.id);
      clearSessionCookies(res);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  })();
};

export const verifyEmail: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      await auth.verifyEmail((req.body as { token: string }).token);
      sendSuccess(res, { message: 'Your email is verified. You can sign in now.' });
    } catch (error) {
      next(error);
    }
  })();
};

export const resendVerification: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      await auth.resendVerification((req.body as { email: string }).email);
      sendSuccess(res, { message: 'If that address needs verifying, we have sent a new link.' });
    } catch (error) {
      next(error);
    }
  })();
};

export const forgotPassword: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      await auth.forgotPassword((req.body as { email: string }).email);
      // Always the same response, whether or not the address exists.
      sendSuccess(res, {
        message: 'If an account exists for that address, we have sent a reset link.',
      });
    } catch (error) {
      next(error);
    }
  })();
};

export const resetPassword: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const body = req.body as { token: string; password: string };
      await auth.resetPassword(body.token, body.password);
      clearSessionCookies(res);
      sendSuccess(res, { message: 'Your password has been reset. Please sign in.' });
    } catch (error) {
      next(error);
    }
  })();
};

export const requestMagicLink: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      await auth.requestMagicLink((req.body as { email: string }).email);
      sendSuccess(res, {
        message: 'If an account exists for that address, we have sent a sign-in link.',
      });
    } catch (error) {
      next(error);
    }
  })();
};

export const verifyMagicLink: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const result = await auth.verifyMagicLink((req.body as { token: string }).token, meta(req));
      if (result.kind === 'mfa') {
        sendSuccess(res, {
          mfaRequired: true,
          mfaToken: result.mfaToken,
          expiresIn: result.expiresIn,
        });
        return;
      }
      setSessionCookies(res, result.session);
      sendSuccess(res, { user: result.user, mfaRequired: false });
    } catch (error) {
      next(error);
    }
  })();
};

export const me: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      sendSuccess(res, { user: await auth.currentUser(actor.id) });
    } catch (error) {
      next(error);
    }
  })();
};

export const listSessions: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      sendSuccess(res, { sessions: await auth.listSessions(actor.id, actor.sessionId) });
    } catch (error) {
      next(error);
    }
  })();
};

export const revokeSession: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      await auth.revokeOneSession(actor.id, (req.params as { id: string }).id);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  })();
};

export const changePassword: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      const body = req.body as { currentPassword: string; newPassword: string };
      await auth.changePassword(actor.id, body.currentPassword, body.newPassword, actor.sessionId);
      sendSuccess(res, { message: 'Password updated. Other devices have been signed out.' });
    } catch (error) {
      next(error);
    }
  })();
};

export const setupMfa: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      const enrolment = await auth.setupMfa(actor.id);
      // The raw secret is returned once, for manual entry when a QR code cannot
      // be scanned. It is not stored anywhere reversible outside the encrypted column.
      sendSuccess(res, { secret: enrolment.secret, otpauthUrl: enrolment.otpauthUrl });
    } catch (error) {
      next(error);
    }
  })();
};

export const confirmMfa: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      const codes = await auth.confirmMfa(actor.id, (req.body as { code: string }).code);
      // Shown exactly once. Only argon2 hashes are stored.
      sendSuccess(res, {
        recoveryCodes: codes,
        message: 'Save these recovery codes now — they will not be shown again.',
      });
    } catch (error) {
      next(error);
    }
  })();
};

export const disableMfa: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      await auth.disableMfa(actor.id, (req.body as { password: string }).password);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  })();
};

export const auditLog: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      sendSuccess(res, { events: await auth.auditLogFor(actor.id) });
    } catch (error) {
      next(error);
    }
  })();
};

export type { Response };
