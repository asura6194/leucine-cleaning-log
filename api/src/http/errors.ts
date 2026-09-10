/**
 * One error shape for the whole API.
 *
 *   { "error": { "code": "not_found", "message": "...", "details": [...] } }
 *
 * Callers can switch on `code`; humans can read `message`; forms can attach
 * `details` to the field that caused them. Nothing leaks: no stack traces, no
 * SQL text, no constraint names.
 */
export type ErrorDetail = { path: string; message: string };

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(400, 'bad_request', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in to continue.') {
    super(401, 'unauthorized', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, 'forbidden', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(404, 'not_found', id ? `No ${resource} with id ${id}.` : `No such ${resource}.`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(409, 'conflict', message, details);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(422, 'unprocessable', message, details);
  }
}

/**
 * Errors thrown by body-parser, BEFORE any route or schema of ours runs.
 *
 * Unhandled these become a 500, which is a lie: a caller that sent malformed
 * JSON made a client error, and telling them the server broke sends them
 * looking in the wrong place. Discovered exactly that way -- a shell mangled
 * the quoting on a request body and the API blamed itself.
 */
type BodyParserError = { type?: string };

export function translateBodyParserError(err: unknown): AppError | null {
  const type = (err as BodyParserError)?.type;
  if (typeof type !== 'string') return null;

  switch (type) {
    case 'entity.parse.failed':
      return new BadRequestError('Request body is not valid JSON.', [
        { path: 'body', message: 'Malformed JSON.' },
      ]);
    case 'entity.too.large':
      return new AppError(413, 'payload_too_large', 'Request body is too large.');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new AppError(415, 'unsupported_media_type', 'Unsupported content encoding or charset.');
    default:
      return null;
  }
}

/** PostgreSQL error codes this API translates rather than propagates as 500. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';
const PG_RESTRICT_VIOLATION = '23001'; // raised by the audit append-only trigger

type PgError = { code?: string; constraint?: string };

/**
 * Turns a database constraint violation into the response it deserves.
 *
 * A duplicate equipment code is the caller's mistake (409), not a server
 * failure (500) -- but the constraint NAME never reaches the client, because
 * that would leak schema detail and couple callers to our table design.
 */
export function translateDatabaseError(err: unknown): AppError | null {
  const pg = err as PgError;
  if (!pg || typeof pg.code !== 'string') return null;

  switch (pg.code) {
    case PG_UNIQUE_VIOLATION:
      if (pg.constraint === 'equipment_code_key') {
        return new ConflictError('That equipment code is already in use.', [
          { path: 'code', message: 'Already in use.' },
        ]);
      }
      if (pg.constraint === 'users_email_key') {
        return new ConflictError('That email address is already registered.', [
          { path: 'email', message: 'Already registered.' },
        ]);
      }
      return new ConflictError('That value is already in use.');

    case PG_FOREIGN_KEY_VIOLATION:
      return new ConflictError('A referenced record does not exist, or is still in use.');

    case PG_CHECK_VIOLATION:
      return new UnprocessableError('The request would leave a record in an invalid state.');

    case PG_RESTRICT_VIOLATION:
      // The audit append-only trigger. Reaching this means application code
      // tried to rewrite history, which is a bug worth surfacing plainly.
      return new AppError(500, 'audit_immutable', 'Audit records cannot be modified.');

    default:
      return null;
  }
}
