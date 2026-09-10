import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { actorLabel, type User } from '../domain/types.js';
import { toUser, type UserRow } from './rows.js';

const COLUMNS = 'id, email, name, password_hash, role, created_at, updated_at';

export async function findUserByEmail(
  email: string,
): Promise<(User & { passwordHash: string }) | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE email = $1`,
    [email],
  );
  const row = rows[0];
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toUser(row) : null;
}

/**
 * Resolves user ids to their audit labels in one round trip.
 *
 * The diff needs a label for every user id it might touch, and doing that one
 * id at a time inside a transaction would be a query per field. Two ids at
 * most in practice, but the shape is what matters.
 */
export async function labelsForUsers(
  client: PoolClient,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const { rows } = await client.query<{ id: string; name: string; email: string }>(
    `SELECT id, name, email FROM users WHERE id = ANY($1::uuid[])`,
    [unique],
  );
  return new Map(rows.map((r) => [r.id, actorLabel(r)]));
}

export async function listAllUsers(): Promise<User[]> {
  const { rows } = await pool.query<UserRow>(
    `SELECT ${COLUMNS} FROM users ORDER BY name`,
  );
  return rows.map(toUser);
}
