import type { PoolClient } from 'pg';
import { pool } from './pool.js';

/**
 * Runs `fn` inside a single transaction on a single connection.
 *
 * The single-connection part is the point. BEGIN applies to a CONNECTION, so
 * if a later statement took a different client from the pool it would execute
 * outside the transaction and every atomicity guarantee would silently
 * evaporate. Passing the client through makes that impossible to get wrong by
 * accident -- which is the main hazard of using the pg driver directly rather
 * than an ORM.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
