import type { RequestHandler } from 'express';
import type { UserRole } from '@cc/shared';
import { prisma } from '../core/db/prisma.js';
import { ForbiddenError, UnauthenticatedError } from '../core/errors/app-error.js';
import { setContextUser } from '../core/logger/request-context.js';
import { ACCESS_COOKIE } from '../modules/auth/session-cookies.js';
import { verifyAccessToken } from '../modules/auth/tokens.service.js';

export interface Actor {
  id: string;
  role: UserRole;
  sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
  }
}

/**
 * Verify the access token and attach the actor.
 *
 * The JWT is verified without a database round trip — that is the point of a
 * short-lived access token. The cost is that a revoked session stays usable for
 * at most 15 minutes; the session table is checked at the refresh boundary
 * instead, which is the documented trade in ADR-006.
 *
 * One exception: the session is checked here too, because "sign out everywhere"
 * has to mean something sooner than 15 minutes when a user hits it after losing
 * a laptop. One indexed lookup per request is worth that.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const cookies = req.cookies as Record<string, string> | undefined;
      const token = cookies?.[ACCESS_COOKIE];
      if (!token) throw new UnauthenticatedError();

      const claims = await verifyAccessToken(token);

      const session = await prisma().deviceSession.findUnique({ where: { id: claims.sid } });
      if (!session || session.revokedAt || session.expiresAt < new Date()) {
        throw new UnauthenticatedError('Your session has ended. Please sign in again.');
      }

      req.actor = { id: claims.sub, role: claims.role, sessionId: claims.sid };
      setContextUser(claims.sub);
      next();
    } catch (error) {
      next(error);
    }
  })();
};

/** Attaches the actor when a valid token is present, but never rejects. For
 *  endpoints that behave differently when signed in without requiring it. */
export const optionalAuthenticate: RequestHandler = (req, _res, next) => {
  void (async () => {
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = cookies?.[ACCESS_COOKIE];
    if (!token) {
      next();
      return;
    }
    try {
      const claims = await verifyAccessToken(token);
      req.actor = { id: claims.sub, role: claims.role, sessionId: claims.sid };
      setContextUser(claims.sub);
    } catch {
      // An invalid token on an optional route is simply "not signed in".
    }
    next();
  })();
};

/**
 * Coarse role gate. This is a first filter, never the authorisation decision —
 * a CANDIDATE guard says nothing about *whose* resource is being requested.
 * Ownership is checked in the service layer, per request, against the actor.
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.actor) {
      next(new UnauthenticatedError());
      return;
    }
    if (!roles.includes(req.actor.role)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}

export function requireActor(req: { actor?: Actor }): Actor {
  if (!req.actor) throw new UnauthenticatedError();
  return req.actor;
}
