/**
 * Integration tests, against a REAL PostgreSQL.
 *
 * The database is deliberately not mocked. Every behaviour asserted here --
 * transactional audit writes, row locking, page boundaries across tied sort
 * keys -- is a property of PostgreSQL, so a mock would be asserting that the
 * mock behaves as written rather than that the system works.
 *
 * Requires a migrated database: `npm run migrate` (the seed is not needed;
 * each test creates its own fixtures under a unique equipment code).
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

const app = createApp();

/** Signs in and returns an agent that carries the session cookie. */
async function signIn(email: string) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .send({ email, password: 'password123' })
    .expect(200);
  return { agent, user: res.body.data as { id: string; role: string } };
}

/**
 * Fixture equipment. Always created by the supervisor: since the register is
 * manager-only, an operator agent here would 403 and every test that depends
 * on a fixture would fail for the wrong reason.
 */
async function createEquipment(suffix = randomUUID().slice(0, 8)) {
  const res = await supervisor.agent
    .post('/api/equipment')
    .send({ code: `TST-${suffix}`, name: `Test asset ${suffix}` })
    .expect(201);
  return res.body.data.id as string;
}

async function createRecord(
  agent: request.Agent,
  equipmentId: string,
  body: Record<string, unknown> = {},
) {
  const res = await agent
    .post(`/api/equipment/${equipmentId}/cleaning-records`)
    .send({ cleanedAt: '2026-09-01T06:00:00Z', method: 'manual', ...body })
    .expect(201);
  return res.body.data;
}

const auditOf = async (agent: request.Agent, recordId: string) => {
  const res = await agent.get(`/api/cleaning-records/${recordId}/audit`).expect(200);
  return res.body.data as {
    action: string;
    actorLabel: string;
    changes: { fieldName: string; oldValue: string | null; newValue: string | null }[];
  }[];
};

const equipmentAuditOf = async (agent: request.Agent, equipmentId: string) => {
  const res = await agent.get(`/api/equipment/${equipmentId}/audit`).expect(200);
  return res.body.data as {
    action: string;
    actorLabel: string;
    changes: { fieldName: string; oldValue: string | null; newValue: string | null }[];
  }[];
};

let operator: Awaited<ReturnType<typeof signIn>>;
let supervisor: Awaited<ReturnType<typeof signIn>>;

beforeAll(async () => {
  operator = await signIn('priya@leucine.test');
  supervisor = await signIn('ravi@leucine.test');
});

afterAll(async () => {
  await pool.end();
});

describe('authentication', () => {
  it('rejects a wrong password with 401 and no hint about which part was wrong', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'priya@leucine.test', password: 'nope' })
      .expect(401);
    expect(res.body.error.message).toBe('Incorrect email or password.');
  });

  it('reports malformed JSON as 400, not 500', async () => {
    // body-parser throws before any route or schema runs. Unhandled that is a
    // 500, which blames the server for the caller's mistake.
    const res = await request(app)
      .post('/api/auth/login')
      .set('content-type', 'application/json')
      .send('{email: nope}')
      .expect(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('requires a session for reads and writes alike', async () => {
    await request(app).get('/api/equipment').expect(401);
    await request(app).post('/api/equipment').send({ code: 'XX-1', name: 'x' }).expect(401);
  });
});

describe('audit trail', () => {
  it('records a create event listing every field that holds a value', async () => {
    const equipmentId = await createEquipment();
    const record = await createRecord(operator.agent, equipmentId, { notes: 'First clean.' });

    const events = await auditOf(operator.agent, record.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe('create');
    expect(events[0]!.actorLabel).toContain('priya@leucine.test');

    const fields = events[0]!.changes.map((c) => c.fieldName).sort();
    expect(fields).toEqual(['cleaned_at', 'cleaned_by_user_id', 'method', 'notes', 'status']);
    // Nothing was verified yet, so null -> null produced no line.
    expect(fields).not.toContain('verified_at');
    expect(events[0]!.changes.every((c) => c.oldValue === null)).toBe(true);
  });

  it('groups a multi-field save into ONE event with one line per field', async () => {
    const equipmentId = await createEquipment();
    const record = await createRecord(operator.agent, equipmentId, { notes: 'Before.' });

    await operator.agent
      .patch(`/api/cleaning-records/${record.id}`)
      .send({ method: 'cip', notes: 'After.' })
      .expect(200);

    const events = await auditOf(operator.agent, record.id);
    expect(events).toHaveLength(2);

    const update = events[0]!; // newest first
    expect(update.action).toBe('update');
    expect(update.changes).toEqual(
      expect.arrayContaining([
        { fieldName: 'method', oldValue: 'manual', newValue: 'cip' },
        { fieldName: 'notes', oldValue: 'Before.', newValue: 'After.' },
      ]),
    );
    expect(update.changes).toHaveLength(2);
  });

  it('writes no event when the save changed nothing', async () => {
    const equipmentId = await createEquipment();
    const record = await createRecord(operator.agent, equipmentId, { notes: 'Same.' });

    // Resubmit identical values, exactly as a form that was opened and saved
    // without edits would.
    await operator.agent
      .patch(`/api/cleaning-records/${record.id}`)
      .send({ method: 'manual', notes: 'Same.' })
      .expect(200);

    expect(await auditOf(operator.agent, record.id)).toHaveLength(1);
  });

  it('records clearing a field as value -> null', async () => {
    const equipmentId = await createEquipment();
    const record = await createRecord(operator.agent, equipmentId, { notes: 'Delete me.' });

    await operator.agent
      .patch(`/api/cleaning-records/${record.id}`)
      .send({ notes: null })
      .expect(200);

    const [update] = await auditOf(operator.agent, record.id);
    expect(update!.changes).toEqual([
      { fieldName: 'notes', oldValue: 'Delete me.', newValue: null },
    ]);
  });

  it('attributes the event to the session user, never to the request body', async () => {
    const equipmentId = await createEquipment();
    const record = await createRecord(operator.agent, equipmentId);

    // A body claiming a different actor must not change who is recorded.
    await supervisor.agent
      .patch(`/api/cleaning-records/${record.id}`)
      .send({ method: 'cip', actorUserId: operator.user.id })
      .expect(400); // .strict() rejects the unknown key outright

    await supervisor.agent
      .patch(`/api/cleaning-records/${record.id}`)
      .send({ method: 'cip' })
      .expect(200);

    const [update] = await auditOf(operator.agent, record.id);
    expect(update!.actorLabel).toContain('ravi@leucine.test');
  });

  it('leaves nothing behind when a request fails validation', async () => {
    const equipmentId = await createEquipment();
    const record = await createRecord(operator.agent, equipmentId);
    const before = await auditOf(operator.agent, record.id);

    await operator.agent
      .patch(`/api/cleaning-records/${record.id}`)
      .send({ cleanedAt: '2031-01-01T00:00:00Z' })
      .expect(422);

    const after = await auditOf(operator.agent, record.id);
    expect(after).toHaveLength(before.length);

    const res = await operator.agent.get(`/api/cleaning-records/${record.id}`).expect(200);
    expect(res.body.data.cleanedAt).toBe('2026-09-01T06:00:00.000Z');
  });

  it('leaves the record untouched when the AUDIT insert is the thing that fails', async () => {
    // The atomicity guarantee runs both ways. The duplicate-code test proves
    // that a failed row write takes its audit event with it; this proves the
    // reverse, which is the direction that actually matters -- a record that
    // changed with no audit line is a silent hole in the trail.
    //
    // The failure has to be injected, because nothing in normal operation
    // makes the audit insert fail. A trigger on audit_field_changes is the
    // least invasive way: it needs no code change and no mocking, so what is
    // under test is the real transaction boundary.
    const equipmentId = await createEquipment();
    const record = await createRecord(operator.agent, equipmentId, { method: 'manual' });

    await pool.query(`
      CREATE OR REPLACE FUNCTION test_audit_boom() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$`);
    await pool.query(`
      CREATE TRIGGER test_audit_boom BEFORE INSERT ON audit_field_changes
      FOR EACH ROW EXECUTE FUNCTION test_audit_boom()`);

    try {
      await operator.agent
        .patch(`/api/cleaning-records/${record.id}`)
        .send({ method: 'cip', notes: 'Should not survive.' })
        .expect(500);
    } finally {
      // finally, not after: a failed assertion above must not leave a trigger
      // behind that breaks every test that runs after it.
      await pool.query('DROP TRIGGER IF EXISTS test_audit_boom ON audit_field_changes');
      await pool.query('DROP FUNCTION IF EXISTS test_audit_boom()');
    }

    // The record rolled back with the audit rows.
    const after = await operator.agent.get(`/api/cleaning-records/${record.id}`).expect(200);
    expect(after.body.data.method).toBe('manual');
    expect(after.body.data.notes).toBeNull();

    // And exactly one event -- the original create -- is on the trail.
    const events = await auditOf(operator.agent, record.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('create');
  });

  it('keeps the audit chain contiguous under concurrent updates', async () => {
    const equipmentId = await createEquipment();
    const record = await createRecord(operator.agent, equipmentId);

    // Without SELECT ... FOR UPDATE both requests read the same "old" value
    // and each writes an audit line starting from it -- producing history that
    // claims two independent changes from one starting point.
    await Promise.all([
      operator.agent.patch(`/api/cleaning-records/${record.id}`).send({ method: 'cip' }),
      operator.agent.patch(`/api/cleaning-records/${record.id}`).send({ method: 'cop' }),
    ]);

    const events = await auditOf(operator.agent, record.id);
    const chain = events
      .slice()
      .reverse()
      .flatMap((e) => e.changes.filter((c) => c.fieldName === 'method'));

    for (let i = 0; i < chain.length - 1; i++) {
      expect(chain[i]!.newValue).toBe(chain[i + 1]!.oldValue);
    }
  });
});

describe('verification and roles', () => {
  it('refuses to let an operator verify, and allows a supervisor', async () => {
    const equipmentId = await createEquipment();
    const record = await createRecord(operator.agent, equipmentId);

    await operator.agent
      .patch(`/api/cleaning-records/${record.id}`)
      .send({ status: 'verified' })
      .expect(403);

    await supervisor.agent
      .patch(`/api/cleaning-records/${record.id}`)
      .send({ status: 'verified' })
      .expect(200);

    const [verifyEvent] = await auditOf(operator.agent, record.id);
    expect(verifyEvent!.changes.map((c) => c.fieldName).sort()).toEqual([
      'status',
      'verified_at',
      'verified_by_user_id',
    ]);
    expect(verifyEvent!.actorLabel).toContain('ravi@leucine.test');
  });

  it('refuses to un-verify', async () => {
    const equipmentId = await createEquipment();
    const record = await createRecord(operator.agent, equipmentId);
    await supervisor.agent
      .patch(`/api/cleaning-records/${record.id}`)
      .send({ status: 'verified' })
      .expect(200);

    await supervisor.agent
      .patch(`/api/cleaning-records/${record.id}`)
      .send({ status: 'pending' })
      .expect(422);
  });
});

describe('pagination', () => {
  const TOTAL = 45;
  let equipmentId: string;

  beforeAll(async () => {
    equipmentId = await createEquipment();

    // Every third record shares the exact cleaned_at of the one before it.
    // Those ties are the point: cleaned_at is not unique, and an ordering that
    // is not total lets two runs of the same query disagree about which row
    // sits either side of a page boundary -- which is how a numbered pager
    // shows one row twice and hides another with nothing having changed.
    for (let i = 0; i < TOTAL; i++) {
      const minute = Math.floor(i / 3);
      await createRecord(operator.agent, equipmentId, {
        cleanedAt: new Date(Date.UTC(2026, 7, 1, 6, minute)).toISOString(),
        method: i % 2 === 0 ? 'manual' : 'cip',
        ...(i % 4 === 0 ? { notes: `Note ${i}` } : {}),
      });
    }
  }, 60_000);

  async function page(pageNumber: number, pageSize: number, query = '') {
    const res = await operator.agent
      .get(
        `/api/equipment/${equipmentId}/cleaning-records` +
          `?page=${pageNumber}&pageSize=${pageSize}${query}`,
      )
      .expect(200);
    return res.body as {
      data: { id: string; cleanedAt: string; status: string }[];
      pageInfo: { page: number; pageSize: number; totalItems: number; totalPages: number };
    };
  }

  /** Walks every page front to back and returns what it saw. */
  async function walkAllPages(pageSize: number, query = '') {
    const first = await page(1, pageSize, query);
    const ids = first.data.map((r) => r.id);
    for (let p = 2; p <= first.pageInfo.totalPages; p++) {
      ids.push(...(await page(p, pageSize, query)).data.map((r) => r.id));
    }
    return { ids, pages: first.pageInfo.totalPages, info: first.pageInfo };
  }

  it('returns every row exactly once across pages', async () => {
    const { ids, pages, info } = await walkAllPages(10);
    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(pages).toBe(Math.ceil(TOTAL / 10));
    expect(info.totalItems).toBe(TOTAL);
  });

  it('reports a page size that does not divide the total without losing the remainder', async () => {
    // 45 rows at 7 per page is 6 full pages and a short one. Off-by-one bugs in
    // ceil() live exactly here.
    const { ids, pages } = await walkAllPages(7);
    expect(pages).toBe(7);
    expect(ids).toHaveLength(TOTAL);
    const last = await page(7, 7);
    expect(last.data).toHaveLength(TOTAL % 7);
  });

  it('orders strictly by (cleanedAt, id) descending, including across ties', async () => {
    // The tiebreaker is what makes the order total. Without it the assertion
    // below can pass on one run and fail on the next with identical data.
    const all = await page(1, 100);
    const keys = all.data.map((r) => [r.cleanedAt, r.id] as const);
    for (let i = 0; i < keys.length - 1; i++) {
      const [aTime, aId] = keys[i]!;
      const [bTime, bId] = keys[i + 1]!;
      expect(aTime > bTime || (aTime === bTime && aId > bId)).toBe(true);
    }
  });

  it('never shows the same row on two adjacent pages, including across a tie', async () => {
    // A page boundary is only stable if the sort is total. Page 3 at size 3
    // lands inside the seeded ties on purpose.
    for (let p = 1; p < 5; p++) {
      const a = await page(p, 3);
      const b = await page(p + 1, 3);
      const aIds = a.data.map((r) => r.id);
      const bIds = b.data.map((r) => r.id);
      expect(aIds.filter((id) => bIds.includes(id))).toEqual([]);
    }
  });

  it('is stable across repeated reads of the same page', async () => {
    const a = await page(3, 4);
    const b = await page(3, 4);
    expect(a.data.map((r) => r.id)).toEqual(b.data.map((r) => r.id));
  });

  it('clamps a page past the end to the last page instead of returning nothing', async () => {
    const res = await page(9999, 10);
    // The response says which page it actually served, so a client whose page
    // size just changed can correct itself rather than highlighting a page
    // number that no longer exists above rows from a different one.
    expect(res.pageInfo.page).toBe(res.pageInfo.totalPages);
    expect(res.data.length).toBeGreaterThan(0);
  });

  it('reports one empty page rather than zero pages', async () => {
    // "Page 1 of 0" is not something a pager can render.
    const empty = await createEquipment();
    const res = await operator.agent
      .get(`/api/equipment/${empty}/cleaning-records?page=1&pageSize=10`)
      .expect(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pageInfo).toEqual({
      page: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 1,
    });
  });

  it('combines a status filter with pagination, and counts only what matches', async () => {
    // Every fixture starts pending, so verify one first -- otherwise the
    // filtered count equals the unfiltered one and the assertion below would
    // pass even if the count ignored the filter entirely.
    const before = await page(1, 100);
    const target = before.data[0]!;
    await supervisor.agent
      .patch(`/api/cleaning-records/${target.id}`)
      .send({ status: 'verified' })
      .expect(200);

    const pending = await walkAllPages(7, '&status=pending');
    expect(new Set(pending.ids).size).toBe(pending.ids.length);
    expect(pending.ids).not.toContain(target.id);

    // The total must describe the FILTERED set. A count that ignored the
    // filter would render the right rows under the wrong number of pages.
    expect(pending.info.totalItems).toBe(pending.ids.length);
    expect(pending.info.totalItems).toBe(TOTAL - 1);

    const verified = await page(1, 100, '&status=verified');
    expect(verified.data.map((r) => r.id)).toEqual([target.id]);
    expect(verified.pageInfo.totalItems).toBe(1);
    expect(verified.pageInfo.totalPages).toBe(1);
  });

  it('clamps pageSize to the maximum instead of honouring it', async () => {
    const res = await page(1, 5000);
    expect(res.pageInfo.pageSize).toBe(100);
    expect(res.data.length).toBeLessThanOrEqual(100);
  });

  it('defaults to page 1 at the configured page size when asked for neither', async () => {
    const res = await operator.agent
      .get(`/api/equipment/${equipmentId}/cleaning-records`)
      .expect(200);
    expect(res.body.pageInfo.page).toBe(1);
    expect(res.body.pageInfo.pageSize).toBe(20);
  });

  it('rejects a page number that is not a positive integer', async () => {
    for (const bad of ['0', '-2', 'abc', '1.5']) {
      const res = await operator.agent
        .get(`/api/equipment/${equipmentId}/cleaning-records?page=${bad}`)
        .expect(400);
      expect(res.body.error.code).toBe('bad_request');
      expect(res.body.error.details?.[0]?.path).toBe('page');
    }
  });

  it('SHIFTS a row across pages when one is inserted mid-walk', async () => {
    // The known cost of offset pagination, asserted rather than left implicit.
    // OFFSET counts positions, so an insert at the top moves every later row
    // down one and someone paging through sees a row twice. At this volume it
    // is an occasional cosmetic annoyance; the test exists so the behaviour is
    // a recorded decision rather than a surprise, and so nobody "fixes" it by
    // accident without understanding what changed.
    const pageSize = 5;
    const first = await page(1, pageSize);
    const lastOnPageOne = first.data[pageSize - 1]!.id;

    await createRecord(operator.agent, equipmentId, {
      cleanedAt: new Date(Date.UTC(2026, 7, 1, 23, 0)).toISOString(),
    });

    const second = await page(2, pageSize);
    expect(second.data[0]!.id).toBe(lastOnPageOne);
  });
});

describe('equipment', () => {
  it('reports a duplicate code as 409, not 500', async () => {
    const suffix = randomUUID().slice(0, 8);
    await createEquipment(suffix);
    const res = await supervisor.agent
      .post('/api/equipment')
      .send({ code: `TST-${suffix}`, name: 'Duplicate' })
      .expect(409);
    expect(res.body.error.details?.[0]?.path).toBe('code');
  });

  it('retires rather than deletes, and keeps the history reachable', async () => {
    const equipmentId = await createEquipment();
    const record = await createRecord(operator.agent, equipmentId);

    const res = await supervisor.agent.delete(`/api/equipment/${equipmentId}`).expect(200);
    expect(res.body.data.status).toBe('retired');

    // The row is still there, and so is its cleaning history.
    await operator.agent.get(`/api/equipment/${equipmentId}`).expect(200);
    await operator.agent.get(`/api/cleaning-records/${record.id}`).expect(200);

    // But it cannot accrue new records.
    await operator.agent
      .post(`/api/equipment/${equipmentId}/cleaning-records`)
      .send({ cleanedAt: '2026-09-01T06:00:00Z', method: 'cip' })
      .expect(422);

    await supervisor.agent.delete(`/api/equipment/${equipmentId}`).expect(409);
  });

  it('refuses register writes from an operator, and still allows reads', async () => {
    const equipmentId = await createEquipment();

    await operator.agent.post('/api/equipment').send({ code: 'OP-1', name: 'Nope' }).expect(403);
    await operator.agent.patch(`/api/equipment/${equipmentId}`).send({ name: 'Nope' }).expect(403);
    await operator.agent.delete(`/api/equipment/${equipmentId}`).expect(403);

    // Reading the register, and its history, is open to any session.
    await operator.agent.get(`/api/equipment/${equipmentId}`).expect(200);
    await operator.agent.get(`/api/equipment/${equipmentId}/audit`).expect(200);

    // And nothing was written by the refused calls.
    const res = await supervisor.agent.get(`/api/equipment/${equipmentId}`).expect(200);
    expect(res.body.data.name).toMatch(/^Test asset /);
  });

  it('writes a create event naming every field the asset was born with', async () => {
    const suffix = randomUUID().slice(0, 8);
    const equipmentId = await createEquipment(suffix);

    const events = await equipmentAuditOf(supervisor.agent, equipmentId);
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('create');
    expect(events[0]?.actorLabel).toContain('ravi@leucine.test');
    expect(events[0]?.changes.map((c) => c.fieldName).sort()).toEqual(['code', 'name', 'status']);
    expect(events[0]?.changes.find((c) => c.fieldName === 'code')?.newValue).toBe(`TST-${suffix}`);
  });

  it('audits a rename as one event with one line', async () => {
    const equipmentId = await createEquipment();
    await supervisor.agent
      .patch(`/api/equipment/${equipmentId}`)
      .send({ name: 'Renamed asset' })
      .expect(200);

    const events = await equipmentAuditOf(supervisor.agent, equipmentId);
    expect(events).toHaveLength(2); // create, then update -- newest first
    expect(events[0]?.action).toBe('update');
    expect(events[0]?.changes).toHaveLength(1);
    expect(events[0]?.changes[0]?.fieldName).toBe('name');
    expect(events[0]?.changes[0]?.newValue).toBe('Renamed asset');
  });

  it('writes no event when a patch changes nothing', async () => {
    const suffix = randomUUID().slice(0, 8);
    const equipmentId = await createEquipment(suffix);

    await supervisor.agent
      .patch(`/api/equipment/${equipmentId}`)
      .send({ code: `TST-${suffix}`, name: `Test asset ${suffix}` })
      .expect(200);

    expect(await equipmentAuditOf(supervisor.agent, equipmentId)).toHaveLength(1);
  });

  it('records retirement as an ordinary status change in the trail', async () => {
    const equipmentId = await createEquipment();
    await supervisor.agent.delete(`/api/equipment/${equipmentId}`).expect(200);

    const events = await equipmentAuditOf(supervisor.agent, equipmentId);
    expect(events[0]?.changes).toEqual([
      { fieldName: 'status', oldValue: 'active', newValue: 'retired' },
    ]);
  });

  it('keeps the two trails separate even though they share the tables', async () => {
    const equipmentId = await createEquipment();
    const record = await createRecord(operator.agent, equipmentId);

    // The asset's history must not contain the record's create event, and the
    // record's must not contain the asset's -- which is the whole point of
    // keying audit_events on (entity_type, entity_id) rather than entity_id.
    const assetEvents = await equipmentAuditOf(supervisor.agent, equipmentId);
    const recordEvents = await auditOf(operator.agent, record.id);

    expect(assetEvents).toHaveLength(1);
    expect(assetEvents[0]?.changes.map((c) => c.fieldName).sort()).toEqual([
      'code',
      'name',
      'status',
    ]);
    expect(recordEvents).toHaveLength(1);
    expect(recordEvents[0]?.changes.map((c) => c.fieldName)).toContain('cleaned_at');
  });

  it('rolls the audit event back with the row when the write fails', async () => {
    // A duplicate code fails at the unique index AFTER the transaction has
    // begun. If the audit insert were not in the same transaction, a create
    // event would survive for an asset that does not exist.
    const suffix = randomUUID().slice(0, 8);
    await createEquipment(suffix);

    const before = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_events WHERE entity_type = 'equipment'`,
    );
    await supervisor.agent
      .post('/api/equipment')
      .send({ code: `TST-${suffix}`, name: 'Duplicate' })
      .expect(409);
    const after = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_events WHERE entity_type = 'equipment'`,
    );

    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });
});
