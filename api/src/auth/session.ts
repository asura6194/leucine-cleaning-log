import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { ForbiddenError, UnauthorizedError } from '../http/errors.js';
import type { AuthenticatedUser, UserRole } from '../domain/types.js';

export const SESSION_COOKIE = 'cl_session';

type SessionClaims = { sub: string; email: string; name: string; role: UserRole };

export function issueSession(res: Response, user: AuthenticatedUser): void {
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role } satisfies SessionClaims,
    config.jwtSecret,
    { expiresIn: config.sessionTtlSeconds },
  );

  res.cookie(SESSION_COOKIE, token, {
    // httpOnly: page scripts cannot read the session, so an XSS bug cannot
    // exfiltrate it. This is why the token is not in localStorage.
    httpOnly: true,
    // Lax still sends the cookie on top-level navigation but not on
    // cross-site subrequests, which covers CSRF for this API's shape.
    sameSite: 'lax',
    // Secure only in production: a dev server on http://localhost would
    // otherwise silently drop the cookie and look like a broken login.
    secure: config.isProduction,
    maxAge: config.sessionTtlSeconds * 1000,
    path: '/',
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Populates req.user from the session cookie, or 401s.
 *
 * The identity comes from the signed token and NOWHERE else. Any actor field
 * in a request body is ignored -- a client that could name its own actor could
 * forge audit history, which would make the entire trail worthless.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (!token) return next(new UnauthorizedError());

  try {
    const claims = jwt.verify(token, config.jwtSecret) as SessionClaims;
    req.user = { id: claims.sub, email: claims.email, name: claims.name, role: claims.role };
    next();
  } catch {
    // Expired and tampered are both "sign in again" to the caller; the
    // difference is not useful to them and hinting at it is not useful to us.
    next(new UnauthorizedError('Your session has expired. Sign in again.'));
  }
}

/** Must run after requireAuth. */
export function requireRole(...roles: readonly UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError(`This action requires one of: ${roles.join(', ')}.`));
    }
    next();
  };
}

export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}
