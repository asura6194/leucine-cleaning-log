import type { NextFunction, Request, Response } from 'express';
import {
  AppError,
  NotFoundError,
  translateBodyParserError,
  translateDatabaseError,
} from './errors.js';

/**
 * Express 5 forwards a rejected promise from a handler to the error middleware
 * on its own, so no async wrapper is needed -- but keeping this named helper
 * documents that every route is expected to be async and that throwing is the
 * intended way to fail.
 */
export type AsyncHandler = (req: Request, res: Response) => Promise<void>;

export const handle =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`route ${req.method} ${req.path}`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError =
    err instanceof AppError
      ? err
      : (translateBodyParserError(err) ?? translateDatabaseError(err));

  if (appError) {
    res.status(appError.status).json({
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
      },
    });
    return;
  }

  // Anything unrecognised is a bug. It is logged in full server-side and
  // returned as a bare 500: stack traces, SQL text and constraint names must
  // never reach a client.
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      requestId: req.requestId,
      level: 'error',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );

  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong. Please try again.' },
  });
}
