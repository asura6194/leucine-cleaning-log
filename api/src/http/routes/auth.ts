import { Router } from 'express';
import { verifyPassword } from '../../auth/password.js';
import { clearSession, currentUser, issueSession, requireAuth } from '../../auth/session.js';
import { findUserByEmail, listAllUsers } from '../../repositories/users.js';
import { UnauthorizedError } from '../errors.js';
import { handle } from '../handler.js';
import { loginBody, parseOrThrow } from '../validation.js';
import { userJson } from '../serialize.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  handle(async (req, res) => {
    const body = parseOrThrow(loginBody, req.body, 'credentials');
    const user = await findUserByEmail(body.email);

    // One message for "no such account" and "wrong password", and the hash is
    // verified even when the user does not exist, so response timing does not
    // reveal which emails are registered.
    const ok = user
      ? await verifyPassword(body.password, user.passwordHash)
      : await verifyPassword(body.password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');

    if (!user || !ok) throw new UnauthorizedError('Incorrect email or password.');

    issueSession(res, user);
    res.status(200).json({ data: userJson(user) });
  }),
);

authRouter.post(
  '/logout',
  handle(async (_req, res) => {
    clearSession(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  handle(async (req, res) => {
    res.status(200).json({ data: currentUser(req) });
  }),
);

/**
 * Needed by the front-end so "cleaned by" can be a picker of real people
 * rather than a free-text box. Authenticated, and deliberately returns no
 * password material -- see serialize.ts.
 */
authRouter.get(
  '/users',
  requireAuth,
  handle(async (_req, res) => {
    const users = await listAllUsers();
    res.status(200).json({ data: users.map(userJson) });
  }),
);
