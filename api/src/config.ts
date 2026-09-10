import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy api/.env.example to api/.env and fill it in.`,
    );
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer.`);
  return n;
}

export const config = {
  port: optionalInt('PORT', 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  },

  /**
   * Signs the session cookie. Required with no fallback: a default secret in
   * source is a default secret in production, and this one protects the
   * identity the entire audit trail is attributed to.
   */
  jwtSecret: required('JWT_SECRET'),
  sessionTtlSeconds: optionalInt('SESSION_TTL_SECONDS', 8 * 60 * 60),

  /**
   * Exact origin allowed to send credentialed requests. Not '*': the browser
   * refuses wildcard origins once credentials are involved, and an allowlist
   * of one is the correct answer for a single-page app anyway.
   */
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },
} as const;
