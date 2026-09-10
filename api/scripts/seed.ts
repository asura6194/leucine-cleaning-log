/**
 * Development seed.
 *
 * Goals beyond "some rows exist":
 *   - enough records on one asset (72) that keyset pagination is actually
 *     exercised by hand, not just by tests
 *   - pre-existing audit history, including multi-field updates, so the audit
 *     panel has something real to render on first load
 *   - a retired asset that still owns cleaning history, proving retirement
 *     does not orphan anything
 *   - deterministic output, so page boundaries are reproducible between runs
 */
import 'dotenv/config';
import type { PoolClient } from 'pg';
import { pool, describeTarget } from '../src/db/pool.js';
import { hashPassword } from '../src/auth/password.js';

const SEED_PASSWORD = 'password123';

/** mulberry32 -- tiny deterministic PRNG so every seed produces identical data. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260908);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;

const METHODS = ['manual', 'cip', 'cop', 'solvent_flush'] as const;
const NOTES = [
  null,
  'Rinse water clear at final check.',
  'Product changeover from batch B-2214.',
  'Gasket replaced during teardown.',
  'Rinse extended to 12 min after visual check.',
  'Swab sample sent to QC, ref SW-0091.',
  null,
] as const;

type Actor = { id: string; label: string; role: string };
type Change = { field: string; oldValue: string | null; newValue: string | null };

const iso = (d: Date): string => d.toISOString();
const DAY_MS = 24 * 3600 * 1000;

/**
 * One act -> one audit event -> one row per field that moved. Mirrors exactly
 * what the API's update path will do, so seeded history is indistinguishable
 * from history the app produced.
 */
async function writeAuditEvent(
  client: PoolClient,
  args: {
    entityType: 'cleaning_record' | 'equipment';
    entityId: string;
    action: 'create' | 'update';
    actor: Actor;
    at: Date;
    changes: Change[];
  },
): Promise<void> {
  const changes = args.changes.filter((c) => c.oldValue !== c.newValue);
  if (changes.length === 0) return; // a no-op writes nothing -- same rule as the API

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO audit_events (entity_type, entity_id, action, actor_user_id, actor_label, occurred_at)
     VALUES ($1::audit_entity, $2, $3::audit_action, $4, $5, $6::timestamptz)
     RETURNING id`,
    [args.entityType, args.entityId, args.action, args.actor.id, args.actor.label, args.at],
  );
  const eventId = rows[0]!.id;

  await client.query(
    `INSERT INTO audit_field_changes (audit_event_id, field_name, old_value, new_value)
     SELECT $1, * FROM UNNEST($2::text[], $3::text[], $4::text[])`,
    [eventId, changes.map((c) => c.field), changes.map((c) => c.oldValue), changes.map((c) => c.newValue)],
  );
}

async function main(): Promise<void> {
  const target = describeTarget();
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|db):/.test(target);
  if (!local && process.env.ALLOW_REMOTE_SEED !== 'true') {
    throw new Error(
      `Refusing to seed ${target}: it does not look local. Set ALLOW_REMOTE_SEED=true if you really mean it.`,
    );
  }

  // Containers restart. Without this guard, every `docker compose up` would
  // TRUNCATE the tables and throw away whatever the reviewer had just entered.
  if (process.argv.includes('--if-empty')) {
    const { rows } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM users');
    if (rows[0] && rows[0].n !== '0') {
      console.log(`\n  ${target} already has data — skipping the seed (--if-empty).\n`);
      return;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // TRUNCATE rather than DELETE: row-level triggers do not fire on TRUNCATE,
    // which is what lets us clear the append-only audit tables in development.
    await client.query(
      `TRUNCATE audit_field_changes, audit_events, cleaning_records, equipment, users RESTART IDENTITY CASCADE`,
    );

    /* ---------- users ---------- */
    const hash = await hashPassword(SEED_PASSWORD);
    const userSpecs = [
      { email: 'priya@leucine.test', name: 'Priya Nair', role: 'operator' },
      { email: 'arun@leucine.test', name: 'Arun Menon', role: 'operator' },
      { email: 'ravi@leucine.test', name: 'Ravi Kumar', role: 'supervisor' },
      { email: 'divya@leucine.test', name: 'Divya Rao', role: 'admin' },
    ] as const;

    const users: Actor[] = [];
    for (const u of userSpecs) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
        [u.email, u.name, hash, u.role],
      );
      users.push({ id: rows[0]!.id, label: `${u.name} <${u.email}>`, role: u.role });
    }
    const [priya, arun, ravi] = users as [Actor, Actor, Actor];
    const operators = [priya, arun];
    const supervisor = ravi;

    /* ---------- equipment ---------- */
    const equipmentSpecs = [
      { code: 'MIX-101', name: 'Ribbon Blender 101', status: 'active', records: 72 },
      { code: 'MIX-102', name: 'Ribbon Blender 102', status: 'active', records: 6 },
      { code: 'TAB-201', name: 'Tablet Press 201', status: 'active', records: 14 },
      { code: 'COAT-301', name: 'Film Coater 301', status: 'active', records: 3 },
      { code: 'FBD-401', name: 'Fluid Bed Dryer 401', status: 'active', records: 0 },
      { code: 'GRA-501', name: 'High Shear Granulator 501', status: 'retired', records: 2 },
    ] as const;

    let recordCount = 0;
    let eventCount = 0;

    for (const spec of equipmentSpecs) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO equipment (code, name, status) VALUES ($1, $2, $3) RETURNING id`,
        [spec.code, spec.name, spec.status],
      );
      const equipmentId = rows[0]!.id;

      // The register is audited too, so a seeded asset needs the create event
      // the API would have written. Without it the asset-history drawer opens
      // empty on a fresh database and looks broken rather than new.
      const registeredAt = new Date(Date.now() - 400 * DAY_MS);
      await writeAuditEvent(client, {
        entityType: 'equipment',
        entityId: equipmentId,
        action: 'create',
        actor: supervisor,
        at: registeredAt,
        changes: [
          { field: 'code', oldValue: null, newValue: spec.code },
          { field: 'name', oldValue: null, newValue: spec.name },
          // 'active' at birth even for the asset that is retired below: the
          // trail has to show the transition, not a fait accompli.
          { field: 'status', oldValue: null, newValue: 'active' },
        ],
      });
      eventCount++;

      if (spec.status === 'retired') {
        await writeAuditEvent(client, {
          entityType: 'equipment',
          entityId: equipmentId,
          action: 'update',
          actor: supervisor,
          at: new Date(Date.now() - 30 * DAY_MS),
          changes: [{ field: 'status', oldValue: 'active', newValue: 'retired' }],
        });
        eventCount++;
      }

      // One asset carries a rename, so the demo has a piece of history that is
      // not just "created" -- and shows why renaming is worth auditing at all.
      if (spec.code === 'TAB-201') {
        await writeAuditEvent(client, {
          entityType: 'equipment',
          entityId: equipmentId,
          action: 'update',
          actor: supervisor,
          at: new Date(Date.now() - 120 * DAY_MS),
          changes: [{ field: 'name', oldValue: 'Tablet Press 2', newValue: spec.name }],
        });
        eventCount++;
      }

      let previousCleanedAt: Date | null = null;

      for (let i = 0; i < spec.records; i++) {
        // Walk backwards from "now" so the newest record is first in the
        // default ordering, with deliberately irregular gaps.
        //
        // Every 9th record is given the EXACT cleaned_at of the record before
        // it. Those collisions are the point: with a non-unique sort column,
        // pagination without a unique tiebreaker can return a row twice or
        // skip one entirely. Seeding real ties makes that observable by hand,
        // not just in a test.
        let cleanedAt: Date;
        if (i % 9 === 0 && previousCleanedAt) {
          cleanedAt = previousCleanedAt;
        } else {
          const daysBack = i * 1.35 + rand() * 0.4;
          cleanedAt = new Date(Date.now() - daysBack * 24 * 3600 * 1000);
        }
        previousCleanedAt = cleanedAt;

        const author = pick(operators);
        const method = pick(METHODS);
        const notes = pick(NOTES);

        // Roughly two thirds verified, weighted towards older records, which is
        // what a real backlog looks like and gives the status filter something
        // interesting to do.
        const verified = i > 3 && rand() < 0.68;

        const verifiedAt = verified
          ? new Date(cleanedAt.getTime() + (2 + rand() * 20) * 3600 * 1000)
          : null;

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO cleaning_records
             (equipment_id, cleaned_by_user_id, cleaned_at, method, notes,
              status, verified_by_user_id, verified_at, created_at, updated_at)
           VALUES ($1, $2, $3::timestamptz, $4::cleaning_method, $5, $6::cleaning_status, $7,
                    $8::timestamptz, $3::timestamptz, COALESCE($8::timestamptz, $3::timestamptz))
           RETURNING id`,
          [
            equipmentId,
            author.id,
            cleanedAt,
            method,
            notes,
            verified ? 'verified' : 'pending',
            verified ? supervisor.id : null,
            verifiedAt,
          ],
        );
        const recordId = inserted.rows[0]!.id;
        recordCount++;

        // The create event: every field that has a value moved from nothing to
        // that value. Fields still null at creation emit no line, because
        // "null -> null" is not a change.
        await writeAuditEvent(client, {
          entityType: 'cleaning_record',
          entityId: recordId,
          action: 'create',
          actor: author,
          at: cleanedAt,
          changes: [
            { field: 'cleaned_by_user_id', oldValue: null, newValue: author.label },
            { field: 'cleaned_at', oldValue: null, newValue: iso(cleanedAt) },
            { field: 'method', oldValue: null, newValue: method },
            { field: 'notes', oldValue: null, newValue: notes },
            { field: 'status', oldValue: null, newValue: 'pending' },
          ],
        });
        eventCount++;

        // Every fifth record also carries a correction: a two-field update by
        // the author, so the audit panel shows a grouped multi-field event.
        if (i % 5 === 2) {
          const correctedMethod = METHODS[(METHODS.indexOf(method) + 1) % METHODS.length]!;
          const correctedAt = new Date(cleanedAt.getTime() + 1.5 * 3600 * 1000);
          await client.query(
            `UPDATE cleaning_records SET method = $2, notes = $3, updated_at = $4 WHERE id = $1`,
            [recordId, correctedMethod, 'Method corrected after review of the cleaning log.', correctedAt],
          );
          await writeAuditEvent(client, {
            entityType: 'cleaning_record',
            entityId: recordId,
            action: 'update',
            actor: author,
            at: correctedAt,
            changes: [
              { field: 'method', oldValue: method, newValue: correctedMethod },
              {
                field: 'notes',
                oldValue: notes,
                newValue: 'Method corrected after review of the cleaning log.',
              },
            ],
          });
          eventCount++;
        }

        // The verification event: three fields move together, by the
        // supervisor rather than the author. This is the row that demonstrates
        // segregation of duties in the trail.
        if (verified && verifiedAt) {
          await writeAuditEvent(client, {
            entityType: 'cleaning_record',
            entityId: recordId,
            action: 'update',
            actor: supervisor,
            at: verifiedAt,
            changes: [
              { field: 'status', oldValue: 'pending', newValue: 'verified' },
              { field: 'verified_by_user_id', oldValue: null, newValue: supervisor.label },
              { field: 'verified_at', oldValue: null, newValue: iso(verifiedAt) },
            ],
          });
          eventCount++;
        }
      }
    }

    await client.query('COMMIT');

    const { rows: changeRows } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM audit_field_changes',
    );

    console.log(`
  seeded ${target}

    users                 ${users.length}   (password for all: ${SEED_PASSWORD})
    equipment             ${equipmentSpecs.length}
    cleaning records      ${recordCount}
    audit events          ${eventCount}
    audit field changes   ${changeRows[0]!.n}

  MIX-101 has 72 records -- 4 pages at the default limit of 20.
`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (err: unknown) => {
    console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`);
    await pool.end();
    process.exitCode = 1;
  });
