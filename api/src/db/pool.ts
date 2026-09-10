import { Pool } from 'pg';

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy api/.env.example to api/.env and point it at your local PostgreSQL server.',
    );
  }
  return url;
}

/**
 * A managed host (Supabase, RDS) needs TLS; a local server almost never has it
 * configured. PGSSLMODE keeps that an environment concern rather than a code one.
 */
function ssl(): { rejectUnauthorized: boolean } | false {
  const mode = process.env.PGSSLMODE ?? 'disable';
  if (mode === 'disable') return false;
  // 'require' trusts the host without verifying the chain, which is what
  // managed providers hand out by default. 'verify-full' would need a CA bundle.
  return { rejectUnauthorized: mode === 'verify-full' };
}

export const pool = new Pool({
  connectionString: connectionString(),
  ssl: ssl(),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

/** Human-readable target, safe to log: credentials stripped. */
export function describeTarget(): string {
  try {
    const u = new URL(connectionString());
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}
