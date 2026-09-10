import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { requestContext } from './http/context.js';
import { errorHandler, handle, notFoundHandler } from './http/handler.js';
import { authRouter } from './http/routes/auth.js';
import { cleaningRecordRouter } from './http/routes/cleaningRecords.js';
import { equipmentRouter } from './http/routes/equipment.js';

export function createApp(): Express {
  const app = express();

  // Behind a proxy in any real deployment, so the rate limiter and `secure`
  // cookies see the real client protocol and address.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      // An exact origin, not '*': browsers refuse a wildcard once credentials
      // are involved, and a single-page app has exactly one origin anyway.
      origin: config.corsOrigin,
      credentials: true,
    }),
  );
  // A body cap, so a large payload is rejected before it is parsed rather
  // than after it has been buffered.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(requestContext);

  app.get(
    '/api/healthz',
    handle(async (_req, res) => {
      // Reports the dependency, not just the process. A 200 from a server that
      // cannot reach its database is a health check that lies.
      try {
        await pool.query('SELECT 1');
        res.status(200).json({ status: 'ok', database: 'ok' });
      } catch {
        res.status(503).json({ status: 'degraded', database: 'unreachable' });
      }
    }),
  );

  // Login is the one endpoint an attacker can call repeatedly without a
  // session, so it is the one that needs a limit.
  app.use(
    '/api/auth/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'too_many_requests', message: 'Too many attempts. Try again later.' } },
    }),
  );

  app.use('/api/auth', authRouter);
  app.use('/api/equipment', equipmentRouter);
  app.use('/api/cleaning-records', cleaningRecordRouter);

  // Order matters: unmatched routes become a 404 error, and the error handler
  // is last so everything above can throw into it.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
