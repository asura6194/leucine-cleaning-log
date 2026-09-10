import type { PoolClient } from 'pg';
import type { PageInfo } from '../../../shared/contract.js';
import { pool } from '../db/pool.js';
import { pageInfo, resolvePage, type PageRequest } from '../domain/pagination.js';
import type {
  CleaningMethod,
  CleaningRecord,
  CleaningRecordPatch,
  CleaningStatus,
} from '../domain/types.js';
import { toCleaningRecord, type CleaningRecordRow } from './rows.js';

const COLUMNS = `id, equipment_id, cleaned_by_user_id, cleaned_at, method, notes,
                 status, verified_by_user_id, verified_at, created_at, updated_at`;

export async function insertCleaningRecord(
  client: PoolClient,
  input: {
    equipmentId: string;
    cleanedByUserId: string;
    cleanedAt: Date;
    method: CleaningMethod;
    notes: string | null;
  },
): Promise<CleaningRecord> {
  const { rows } = await client.query<CleaningRecordRow>(
    `INSERT INTO cleaning_records
       (equipment_id, cleaned_by_user_id, cleaned_at, method, notes)
     VALUES ($1, $2, $3::timestamptz, $4::cleaning_method, $5)
     RETURNING ${COLUMNS}`,
    [input.equipmentId, input.cleanedByUserId, input.cleanedAt, input.method, input.notes],
  );
  return toCleaningRecord(rows[0]!);
}

/**
 * Loads one record, optionally taking a row lock.
 *
 * `forUpdate` is what makes concurrent edits safe. Without it, two callers can
 * both read the same "old" values and each write an audit line starting from
 * them -- producing a history that claims two independent changes from one
 * starting point when the real sequence was serial. With it, the second
 * transaction waits, then reads the already-updated row and records the true
 * intermediate value.
 */
export async function findCleaningRecordById(
  id: string,
  opts: { client?: PoolClient; forUpdate?: boolean } = {},
): Promise<CleaningRecord | null> {
  const runner = opts.client ?? pool;
  if (opts.forUpdate && !opts.client) {
    throw new Error('FOR UPDATE requires a transaction client: a lock outside one is pointless.');
  }
  const { rows } = await runner.query<CleaningRecordRow>(
    `SELECT ${COLUMNS} FROM cleaning_records WHERE id = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  const row = rows[0];
  return row ? toCleaningRecord(row) : null;
}

/**
 * One page of cleaning records for an asset, newest cleaning first.
 *
 * Two statements, because a numbered pager needs two facts: which rows are on
 * this page, and how many there are in total. They are separate rather than a
 * `COUNT(*) OVER()` window, because a window function returns no rows at all
 * when the page is empty -- and an out-of-range page is exactly when the
 * caller most needs to be told the real total.
 *
 * ORDER BY carries the unique `id` as a tiebreaker and that is not decoration.
 * `cleaned_at` is not unique (the seed contains deliberate ties), and an
 * ordering that is not total lets OFFSET show one row twice and hide another
 * WITHIN A SINGLE unchanged dataset -- rows either side of a page boundary can
 * swap between two executions of the same query. The tiebreaker makes the sort
 * total, so there is exactly one correct sequence and the boundary is stable.
 *
 * The WHERE clause is assembled from a fixed set of fragments rather than
 * written as `($2 IS NULL OR status = $2)`. The one-size-fits-all form makes
 * the planner choose a plan that has to work for both branches, which loses
 * the index; building only the conditions that apply keeps each query on its
 * index. Values are always bound parameters -- nothing user-supplied is ever
 * concatenated into SQL.
 */
export async function listCleaningRecordsPage(args: {
  equipmentId: string;
  status?: CleaningStatus;
  request: PageRequest;
}): Promise<{ items: CleaningRecord[]; info: PageInfo }> {
  const where = (params: unknown[]): string => {
    params.push(args.equipmentId);
    const conditions = [`equipment_id = $${params.length}`];
    if (args.status) {
      params.push(args.status);
      conditions.push(`status = $${params.length}::cleaning_status`);
    }
    return conditions.join(' AND ');
  };

  const countParams: unknown[] = [];
  const countWhere = where(countParams);
  const { rows: countRows } = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM cleaning_records WHERE ${countWhere}`,
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

  const { rows } = await pool.query<CleaningRecordRow>(
    `SELECT ${COLUMNS}
       FROM cleaning_records
      WHERE ${clause}
      ORDER BY cleaned_at DESC, id DESC
      LIMIT ${limitAt} OFFSET ${offsetAt}`,
    params,
  );

  return { items: rows.map(toCleaningRecord), info: pageInfo(bounds, totalItems) };
}

/**
 * Applies the patch. Called only from inside the update transaction, after the
 * row has been locked and diffed.
 *
 * Note `'notes' in patch` rather than a null check: an absent key means leave
 * it alone, an explicit null means clear it, and conflating them would either
 * lose a deliberate clear or wipe a note nobody touched.
 */
export async function updateCleaningRecord(
  client: PoolClient,
  id: string,
  patch: CleaningRecordPatch,
  verification: { verifiedByUserId: string | null; verifiedAt: Date | null } | null,
): Promise<CleaningRecord> {
  const sets: string[] = [];
  const params: unknown[] = [id];

  const set = (fragment: (placeholder: string) => string, value: unknown): void => {
    params.push(value);
    sets.push(fragment(`$${params.length}`));
  };

  if (patch.cleanedByUserId !== undefined) set((p) => `cleaned_by_user_id = ${p}`, patch.cleanedByUserId);
  if (patch.cleanedAt !== undefined) set((p) => `cleaned_at = ${p}::timestamptz`, patch.cleanedAt);
  if (patch.method !== undefined) set((p) => `method = ${p}::cleaning_method`, patch.method);
  if ('notes' in patch) set((p) => `notes = ${p}`, patch.notes ?? null);
  if (patch.status !== undefined) set((p) => `status = ${p}::cleaning_status`, patch.status);

  // The verifier columns move as a set with status, never independently -- the
  // table's CHECK constraint rejects a half-populated verified state.
  if (verification) {
    set((p) => `verified_by_user_id = ${p}`, verification.verifiedByUserId);
    set((p) => `verified_at = ${p}::timestamptz`, verification.verifiedAt);
  }

  const { rows } = await client.query<CleaningRecordRow>(
    `UPDATE cleaning_records SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    params,
  );
  return toCleaningRecord(rows[0]!);
}
