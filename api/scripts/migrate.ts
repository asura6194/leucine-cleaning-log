/**
 * Forward-only migration runner.
 *
 * Deliberately ~120 lines of plain SQL plumbing rather than a migration
 * framework: the whole mechanism is visible, and it is the part of the stack a
 * reviewer is most likely to ask about.
 *
 *   npm run migrate            apply everything pending
 *   npm run migrate:status     show applied / pending without changing anything
 *   npm run db:reset           drop the schema, re-apply, re-seed (local only)
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, describeTarget } from '../src/db/pool.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    text        PRIMARY KEY,
    checksum    text        NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )`;

type Migration = { filename: string; sql: string; checksum: string };

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort() // zero-padded numeric prefixes make lexical order the intended order
    .map((filename) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
      return { filename, sql, checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16) };
    });
}

async function applied(): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ filename: string; checksum: string }>(
    'SELECT filename, checksum FROM schema_migrations',
  );
  return new Map(rows.map((r) => [r.filename, r.checksum]));
}

/**
 * Refuses to destroy anything that does not look like a local database. A
 * reset is a development convenience; it should be hard to fire at a real one.
 */
async function reset(force: boolean): Promise<void> {
  const target = describeTarget();
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|db):/.test(target);

  if (!local && process.env.ALLOW_REMOTE_RESET !== 'true') {
    throw new Error(
      `Refusing to reset ${target}: it does not look local. Set ALLOW_REMOTE_RESET=true if you really mean it.`,
    );
  }
  if (!force) {
    throw new Error('Refusing to reset without --force.');
  }

  console.log(`  dropping and recreating schema public on ${target}`);
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const target = describeTarget();

  if (args.has('--reset')) {
    await reset(args.has('--force'));
    console.log('  schema reset\n');
    return;
  }

  await pool.query(TRACKING_TABLE);

  const all = loadMigrations();
  const done = await applied();

  // Forward-only discipline: an already-applied file that has since been
  // edited is a mistake, not something to silently re-run. The fix is a new
  // migration, so fail with that instruction rather than guessing.
  for (const m of all) {
    const recorded = done.get(m.filename);
    if (recorded && recorded !== m.checksum) {
      throw new Error(
        `${m.filename} has changed since it was applied (recorded ${recorded}, now ${m.checksum}).\n` +
          'Migrations are forward-only: add a new migration instead of editing this one.\n' +
          'During development, `npm run db:reset` rebuilds from scratch.',
      );
    }
  }

  const pending = all.filter((m) => !done.has(m.filename));

  if (args.has('--status')) {
    console.log(`\n  ${target}\n`);
    for (const m of all) {
      console.log(`  ${done.has(m.filename) ? 'applied' : 'PENDING'}  ${m.filename}`);
    }
    console.log('');
    return;
  }

  if (pending.length === 0) {
    console.log(`\n  ${target}\n  nothing to apply, ${all.length} migration(s) already applied\n`);
    return;
  }

  console.log(`\n  ${target}\n`);
  for (const m of pending) {
    const client = await pool.connect();
    try {
      // One transaction per migration: PostgreSQL has transactional DDL, so a
      // migration that fails halfway leaves no partial schema behind.
      await client.query('BEGIN');
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
        m.filename,
        m.checksum,
      ]);
      await client.query('COMMIT');
      console.log(`  applied  ${m.filename}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  FAILED   ${m.filename}`);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log(`\n  ${pending.length} migration(s) applied\n`);
}

main()
  .then(() => pool.end())
  .catch(async (err: unknown) => {
    console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`);
    await pool.end();
    process.exitCode = 1;
  });
