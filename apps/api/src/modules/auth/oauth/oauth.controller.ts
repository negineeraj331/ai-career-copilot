import type { Request, RequestHandler } from 'express';
import { env } from '../../../config/env.js';
import { getContext } from '../../../core/logger/request-context.js';
import { truncateIp } from '../../../core/security/request-id.js';
import { sendNoContent, sendSuccess } from '../../../core/http/envelope.js';
import { isAppError } from '../../../core/errors/app-error.js';
import { loggerFor } from '../../../core/logger/logger.js';
import { requireActor } from '../../../middleware/authenticate.js';
import { setSessionCookies } from '../session-cookies.js';
import * as oauth from './oauth.service.js';

const log = loggerFor('oauth.controller');

function meta(req: Request) {
  return {
    userAgent: req.header('user-agent'),
    ipPrefix: getContext()?.ipPrefix ?? truncateIp(req.ip) ?? 'unknown',
  };
}

/**
 * Failures redirect to the web app with a code rather than rendering JSON.
 *
 * The user arrived here by following a provider's redirect, so they are looking
 * at a browser tab, not reading an API response. Dumping an error envelope in
 * front of them is a dead end with no way back into the product.
 */
function redirectWithError(res: Parameters<RequestHandler>[1], code: string): void {
  const url = new URL('/auth/callback', env().WEB_URL);
  url.searchParams.set('error', code);
  res.redirect(302, url.toString());
}

export const start: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const { provider } = req.params as { provider: string };
      const { url } = await oauth.beginAuthorization({ provider });
      res.redirect(302, url);
    } catch (error) {
      next(error);
    }
  })();
};

/** Same handshake, but for an already-signed-in user adding a provider. */
export const startLink: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      const { provider } = req.params as { provider: string };
      const { url } = await oauth.beginAuthorization({ provider, linkUserId: actor.id });
      sendSuccess(res, { authorizationUrl: url });
    } catch (error) {
      next(error);
    }
  })();
};

export const callback: RequestHandler = (req, res, next) => {
  void (async () => {
    const { provider } = req.params as { provider: string };
    const query = req.query as { code?: string; state?: string; error?: string };

    // The user declined at the provider, or the provider refused. Not an error
    // on our side — send them back with a code the UI can explain.
    if (query.error) {
      redirectWithError(res, 'provider_denied');
      return;
    }

    if (!query.code || !query.state) {
      redirectWithError(res, 'invalid_callback');
      return;
    }

    try {
      const result = await oauth.completeCallback({
        provider,
        code: query.code,
        state: query.state,
        meta: meta(req),
      });

      if (result.kind === 'linked') {
        const url = new URL('/settings/security', env().WEB_URL);
        url.searchParams.set('linked', result.provider.toLowerCase());
        res.redirect(302, url.toString());
        return;
      }

      if (result.kind === 'mfa') {
        // A verified provider identity is still only one factor. The MFA step
        // is completed by the existing /auth/mfa/verify endpoint.
        const url = new URL('/auth/mfa', env().WEB_URL);
        url.searchParams.set('pending', '1');
        res.redirect(302, url.toString());
        return;
      }

      setSessionCookies(res, result.session);
      res.redirect(302, new URL('/dashboard', env().WEB_URL).toString());
    } catch (error) {
      // Expected failures (expired state, unverified email, provider down) get
      // a specific code; anything else is logged and reported generically.
      if (isAppError(error) && error.expected) {
        log.info({ code: error.code, provider }, 'oauth callback rejected');
        redirectWithError(res, error.code.toLowerCase());
        return;
      }
      log.error({ err: error, provider }, 'oauth callback failed');
      next(error);
    }
  })();
};

export const unlink: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      await oauth.unlinkProvider(actor.id, (req.params as { provider: string }).provider);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  })();
};

export const listLinked: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const actor = requireActor(req);
      sendSuccess(res, { providers: await oauth.listLinkedProviders(actor.id) });
    } catch (error) {
      next(error);
    }
  })();
};
