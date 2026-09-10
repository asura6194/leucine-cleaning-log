import type { PoolClient } from 'pg';
import type { PageInfo } from '../../../shared/contract.js';
import { pool } from '../db/pool.js';
import { pageInfo, resolvePage, type PageRequest } from '../domain/pagination.js';
import type { Equipment, EquipmentPatch, EquipmentStatus } from '../domain/types.js';
import { toEquipment, type EquipmentRow } from './rows.js';

const COLUMNS = 'id, code, name, status, created_at, updated_at';

export async function insertEquipment(
  client: PoolClient,
  input: {
    code: string;
    name: string;
    status: EquipmentStatus;
  },
): Promise<Equipment> {
  const { rows } = await client.query<EquipmentRow>(
    `INSERT INTO equipment (code, name, status)
     VALUES ($1, $2, $3::equipment_status)
     RETURNING ${COLUMNS}`,
    [input.code, input.name, input.status],
  );
  return toEquipment(rows[0]!);
}

/**
 * `forUpdate` takes a row lock for the rest of the transaction, which is what
 * makes the read-diff-write sequence safe: without it two concurrent updates
 * can both read the same "old" values and write contradictory history. It
 * requires a client, because a lock outside a transaction is released
 * immediately and would be worse than useless -- it would look correct.
 */
export async function findEquipmentById(
  id: string,
  opts: { client?: PoolClient; forUpdate?: boolean } = {},
): Promise<Equipment | null> {
  if (opts.forUpdate && !opts.client) {
    throw new Error('findEquipmentById: forUpdate requires a transaction client');
  }
  const runner = opts.client ?? pool;
  const { rows } = await runner.query<EquipmentRow>(
    `SELECT ${COLUMNS} FROM equipment WHERE id = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  const row = rows[0];
  return row ? toEquipment(row) : null;
}

/**
 * One page of equipment, ordered by code.
 *
 * `code` is UNIQUE, so it is its own tiebreaker and the ordering is already
 * total -- no second sort column is needed here, unlike the cleaning-record
 * list whose timestamp is not unique.
 *
 * Same two-statement shape as the record list: a count, then the page.
 */
export async function listEquipmentPage(args: {
  status?: EquipmentStatus;
  request: PageRequest;
}): Promise<{ items: Equipment[]; info: PageInfo }> {
  const where = (params: unknown[]): string => {
    if (!args.status) return '';
    params.push(args.status);
    return `WHERE status = $${params.length}::equipment_status`;
  };

  const countParams: unknown[] = [];
  const countWhere = where(countParams);
  const { rows: countRows } = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM equipment ${countWhere}`,
    countParams,
  );
  const totalItems = Number(countRows[0]!.total);

  const bounds = resolvePage(args.request, totalItems);

  const params: unknown[] = [];
  const clause = where(params);
  params.push(bounds.limit);
  const limitAt = `$${params.length}`;
  params.push(bounds.offset);
  const offsetAt = `$${params.length}`;

  const { rows } = await pool.query<EquipmentRow>(
    `SELECT ${COLUMNS} FROM equipment ${clause}
      ORDER BY code ASC
      LIMIT ${limitAt} OFFSET ${offsetAt}`,
    params,
  );

  return { items: rows.map(toEquipment), info: pageInfo(bounds, totalItems) };
}

export async function updateEquipment(
  client: PoolClient,
  id: string,
  patch: EquipmentPatch,
): Promise<Equipment | null> {
  const sets: string[] = [];
  const params: unknown[] = [id];

  if (patch.code !== undefined) {
    params.push(patch.code);
    sets.push(`code = $${params.length}`);
  }
  if (patch.name !== undefined) {
    params.push(patch.name);
    sets.push(`name = $${params.length}`);
  }
  if (patch.status !== undefined) {
    params.push(patch.status);
    sets.push(`status = $${params.length}::equipment_status`);
  }
  if (sets.length === 0) return findEquipmentById(id, { client });

  const { rows } = await client.query<EquipmentRow>(
    `UPDATE equipment SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    params,
  );
  const row = rows[0];
  return row ? toEquipment(row) : null;
}
