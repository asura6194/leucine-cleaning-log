# Database layer

Reference for the PostgreSQL layer as actually built: what the schema contains,
what the seed produces and why, how to verify it, and the local-setup issues
worth knowing about.

Status: **complete and verified.** Five migrations apply cleanly, every
constraint and trigger has been tested by trying to violate it, and the list
index has been confirmed with `EXPLAIN ANALYZE`.

---

## 1 · What exists

| Migration | Contents |
|---|---|
| `001_extensions.sql` | Server-version guard (fails loudly below PostgreSQL 13, because `gen_random_uuid()` must be in core) and the `citext` extension for case-insensitive email. |
| `002_enums.sql` | Six enums: `user_role`, `equipment_status`, `cleaning_status`, `cleaning_method`, `audit_action`, `audit_entity`. |
| `003_domain_tables.sql` | `users`, `equipment`, `cleaning_records`, plus the two composite indexes that give the list queries their ordering. |
| `004_audit.sql` | `audit_events` and `audit_field_changes`, with the reasoning for the header/lines split in the file header. |
| `005_audit_immutability.sql` | Trigger rejecting `UPDATE` and `DELETE` on both audit tables. |

Six tables in total, counting `schema_migrations`, which the migration runner
creates and maintains itself.

### The migration runner

`api/scripts/migrate.ts` — about 120 lines of plain SQL plumbing rather than a
migration framework, so the whole mechanism is inspectable.

- Applies `migrations/*.sql` in lexical order, which zero-padded numeric
  prefixes make the intended order.
- **One transaction per migration.** PostgreSQL has transactional DDL, so a
  migration that fails halfway leaves no partial schema behind.
- Records `filename`, a truncated SHA-256 `checksum`, and `applied_at` in
  `schema_migrations`.
- **Forward-only.** If an already-applied file has since been edited, the
  checksum no longer matches and the runner refuses to continue, telling you to
  add a new migration instead. In development, `npm run db:reset` rebuilds from
  scratch.
- `--reset` refuses to run against a host that does not look local unless
  `ALLOW_REMOTE_RESET=true` is set.

---

## 2 · Schema decisions worth being able to defend

Each of these is commented in the migration that implements it; this is the
summary.

**The audit trail is two tables, not one.** One `PATCH` changing `method` and
`notes` is one act, by one person, at one instant, affecting two fields.
`audit_events` stores the act; `audit_field_changes` stores one row per field
that moved. Grouped history then falls out of the schema instead of needing a
`GROUP BY` on a timestamp — which becomes ambiguous the moment two users save
within the same instant.

**`audit_events` addresses its target with `(entity_type, entity_id)`, not a
foreign key.** This lets the same tables audit other entities later without
migrating existing history. The cost is that referential integrity for that
pair lives in application code, which is exactly why nothing here is
hard-deleted. If auditing only ever needed to cover cleaning records, a plain
`cleaning_record_id uuid REFERENCES cleaning_records(id)` would be the better
call — enforced by the database and simpler to explain.

**`actor_label` duplicates what a join would give, deliberately.** A join
returns the actor's name *today*; an audit trail needs their name *then*.
Without the frozen copy, renaming a user silently rewrites every historical
audit view. The foreign key supplies integrity; the text column supplies
historical accuracy.

**`audit_events.id` is a `bigint` identity while domain tables use `uuid`.** The
audit tables are append-only and read in strict chronological order, so a
monotonic key provides the ordering guarantee that `occurred_at` cannot: two
events can share a timestamp.
`occurred_at` cannot order events on its own — two events can share a timestamp.

**`updated_at` is maintained in the service layer, not by a trigger.** The
behaviour stays visible in application code and cannot silently disagree with
what the audit trail recorded.

**Equipment is retired, never deleted.** `equipment_id` is
`ON DELETE RESTRICT`, so the database refuses to remove an asset that owns
cleaning history.

### Constraints that have been tested by violating them

| Attempt | Result |
|---|---|
| `UPDATE audit_events …` | `audit records are append-only: UPDATE on audit_events is not permitted` |
| `DELETE FROM audit_field_changes …` | same trigger, for `DELETE` |
| Set `status='verified'` without the verifier columns | violates `cleaning_records_verified_state_consistent` |
| Insert a field change where `old_value = new_value` | violates `audit_field_changes_actually_changed` |
| Insert the same `field_name` twice in one event | violates `audit_field_changes_one_row_per_field` |
| `DELETE FROM equipment` where records exist | violates the `cleaning_records_equipment_id_fkey` restriction |

### Pagination index, verified

Both list indexes exist to give the query its `ORDER BY` for free. A B-tree
stored in `(equipment_id, cleaned_at DESC, id DESC)` can be **walked** in that
order, so PostgreSQL needs no sort step:

```
Limit (actual time=0.159..0.166 rows=20)
  Buffers: shared hit=1 read=3
  ->  Index Only Scan using cleaning_records_equipment_list_idx on cleaning_records
        Index Cond: (equipment_id = $1)
        Heap Fetches: 20
```

The filtered variant uses `cleaning_records_equipment_status_list_idx` the same
way, with `status` in position 2 — **equality columns must precede the sort
columns in a composite index**, or the index stops being usable for the
ordering:

```
Index Cond: ((equipment_id = $1) AND (status = 'pending'))
```

What OFFSET costs, measured on a 500,000-row copy of the table with the same
indexes:

| Query | Inner rows produced | Buffers | Time |
|---|---|---|---|
| `LIMIT 20 OFFSET 0` | 20 | 4 | 0.17 ms |
| `LIMIT 20 OFFSET 9,980` (page 500) | 10,000 | 168 | 5.0 ms |
| `LIMIT 20 OFFSET 399,980` (page 20,000) | 400,000 | 6,860 | 143 ms |

Read the inner `rows=`: the index is used in every case, but OFFSET makes it
produce every preceding row and discard all but the last twenty. The cost is
linear in depth, which is exactly the trade recorded in `NOTES.md` — acceptable
at a few thousand records per asset, not at a million.

**On the seeded data the planner ignores these indexes for deeper pages**, and
is right to: 219 rows fit in a handful of heap pages, so a sequential scan plus
a quicksort beats an index traversal. That is worth knowing before reading too
much into an `EXPLAIN` on a small table — a plan is a decision about *this*
data, not a property of the schema.

Two more concepts visible in that output:

- **`Heap Fetches`** — an *Index Only* Scan is not automatically heap-free.
  PostgreSQL still consults the **visibility map** to know a row is visible to
  the current transaction, and on freshly inserted pages that map is not set,
  so it falls back to the table. The count drops to zero after `VACUUM`, which
  is why the same query gets faster with no code change.
- **`Buffers`** — 8 KB pages touched, and the most honest cost metric here:
  unlike timings it does not move with cache warmth or machine load.

---

## 3 · The seed

`api/scripts/seed.ts`. Run with `npm run seed`. It is the only thing that has
ever written rows to this database.

What it does, in order:

1. **Guard** — refuses to run against a non-local host unless
   `ALLOW_REMOTE_SEED=true`.
2. **`TRUNCATE`** the five tables. Note the choice: row-level triggers do not
   fire on `TRUNCATE`, and the audit tables reject `DELETE`, so `TRUNCATE` is
   the only way to clear them. That is a genuine hole in the immutability
   guarantee and is recorded in `NOTES.md` rather than hidden.
3. **4 users**, sharing one computed password hash — hashing is deliberately
   slow, and doing it four times would quadruple seed time for no benefit.
4. **6 equipment items**, one of them `retired`, so retirement can be seen not
   to orphan history.
5. **97 cleaning records** walking backwards from today.
6. **178 audit events** with **676 field-change rows** — including a `create`
   event for each of the six assets, a rename on `TAB-201` and a retirement on
   `GRA-501`, so the equipment trail has history to show on a fresh database.

### The audit rows are written the same way the API will write them

The helper `writeAuditEvent` inserts one header plus one row per changed field,
and applies the same suppression rule as the service layer:

```ts
const changes = args.changes.filter((c) => c.oldValue !== c.newValue);
if (changes.length === 0) return;   // a no-op writes nothing
```

So seeded history is structurally indistinguishable from history the running
application produces. The audit panel cannot look correct on seed data and
wrong on real data.

Each record receives up to three events:

| Event | Actor | Fields changed |
|---|---|---|
| `create` | the operator | every field holding a value (`null` → value) |
| `update` — correction, every 5th record | same operator | `method` + `notes` — two fields, one save |
| `update` — verification, ~68% of records | **the supervisor**, not the author | `status`, `verified_by_user_id`, `verified_at` |

The verification event is by a different person than the create event on
purpose: segregation of duties, visible in the trail.

### Three numbers that are not arbitrary

- **72 records on MIX-101** — exactly four pages at the default limit of 20,
  including a partial last page, so an off-by-one is visible by hand.
- **8 tied `cleaned_at` values** — every 9th record copies the previous
  record's exact timestamp. Ordering by `cleaned_at` alone is therefore
  genuinely non-deterministic in this data, so the `(cleaned_at, id)`
  tiebreaker is demonstrable rather than theoretical.
- **Deterministic PRNG** (mulberry32, seed `20260908`) — re-running produces
  identical data, so page boundaries stay stable and pagination tests can
  assert real values instead of "some rows came back".

### Seeded credentials

All four users share the password `password123`.

| Email | Name | Role |
|---|---|---|
| `priya@leucine.test` | Priya Nair | operator |
| `arun@leucine.test` | Arun Menon | operator |
| `ravi@leucine.test` | Ravi Kumar | supervisor |
| `divya@leucine.test` | Divya Rao | admin |

Only `supervisor` and `admin` may verify a cleaning record.

Passwords are hashed with Node's built-in `scrypt`, stored self-describing as
`scrypt$N$r$p$salt$hash`. See `NOTES.md` for why not argon2id.

---

## 4 · Verifying it

Open a SQL editor **on the `cleaning_log` database** — in DBeaver, confirm with
`SELECT current_database();` before trusting any result.

### Are the tables there?

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expect six: `audit_events`, `audit_field_changes`, `cleaning_records`,
`equipment`, `schema_migrations`, `users`.

### Do the row counts match the seed?

```sql
SELECT 'users'               AS table_name, count(*) AS rows FROM users
UNION ALL SELECT 'equipment',            count(*) FROM equipment
UNION ALL SELECT 'cleaning_records',     count(*) FROM cleaning_records
UNION ALL SELECT 'audit_events',         count(*) FROM audit_events
UNION ALL SELECT 'audit_field_changes',  count(*) FROM audit_field_changes
UNION ALL SELECT 'schema_migrations',    count(*) FROM schema_migrations
ORDER BY table_name;
```

| table_name | rows |
|---|---|
| audit_events | 170 |
| audit_field_changes | 656 |
| cleaning_records | 97 |
| equipment | 6 |
| schema_migrations | 5 |
| users | 4 |

If those six match, the whole layer is verified — schema, migrations and seed.

### The audit trail for one record

```sql
SELECT e.id AS event, e.occurred_at, e.action, e.actor_label,
       c.field_name, c.old_value, c.new_value
FROM audit_events e
JOIN audit_field_changes c ON c.audit_event_id = e.id
WHERE e.entity_id = (
  SELECT id FROM cleaning_records
  WHERE equipment_id = (SELECT id FROM equipment WHERE code = 'MIX-101')
  ORDER BY cleaned_at DESC LIMIT 1
)
ORDER BY e.id, c.field_name;
```

Rows sharing an `event` number are one person's single save.

### Immutability, demonstrated

```sql
UPDATE audit_events SET actor_label = 'someone else' WHERE id = 1;
```

Expect: `audit records are append-only: UPDATE on audit_events is not permitted`.

### The deliberate timestamp ties

```sql
SELECT cleaned_at, count(*)
FROM cleaning_records
GROUP BY cleaned_at
HAVING count(*) > 1
ORDER BY cleaned_at DESC;
```

Eight rows.

---

## 5 · Commands

| Command | Effect |
|---|---|
| `npm run migrate` | Apply pending migrations. Safe to re-run. |
| `npm run migrate:status` | List applied and pending migrations, changing nothing. |
| `npm run seed` | Truncate and re-seed. Same data every time. |
| `npm run db:reset` | Drop the schema, re-migrate, re-seed. Local only, requires `--force` internally. |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest. The current tests need no database. |

---

## 6 · Moving to Docker or Supabase later

The application reads two environment variables and nothing else:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
PGSSLMODE=disable        # require, for a managed host
```

Nothing in the code knows where PostgreSQL lives, so the same migrations and
seed run unchanged against a Compose service or managed Postgres. Notes for
Supabase specifically:

- Use **Supavisor session mode on port 5432** for a long-lived Express process.
  Transaction mode (6543) does not support prepared statements and is intended
  for serverless. Direct connections are IPv6-only without the IPv4 add-on.
- Set `PGSSLMODE=require`.
- Free projects pause after 7 days of low activity; data survives and the
  project resumes from the dashboard.
- Use it as managed PostgreSQL only — not Supabase Auth, not Row Level
  Security, not `supabase-js`. This application brings its own auth, and RLS
  would fight the audit design, whose actor comes from the application's own
  session rather than a database role.

---

## Appendix · Local setup on Windows

The path that works, condensed:

1. Install PostgreSQL 17 with the EDB installer, keeping **Command Line Tools**
   ticked. Write the superuser password down as you type it.
2. `psql` is not added to `PATH` by the installer. For one shell session:
   ```powershell
   $env:Path += ";C:\Program Files\PostgreSQL\17\bin"
   ```
3. `psql -U postgres -c "CREATE DATABASE cleaning_log;"`
4. Copy `api/.env.example` to `api/.env` and set the real password.
5. `npm install --prefix api`, then `npm run migrate`, then `npm run seed`.

`psql` is a convenience only — migrate and seed reach PostgreSQL through the
Node `pg` driver, so the database can be created in DBeaver instead and `psql`
skipped entirely.

### Errors encountered, and what they actually meant

| Symptom | Cause |
|---|---|
| `'psql' is not recognized` | Installed, but not on `PATH`. |
| `'$old' is not recognized as an internal or external command` | PowerShell syntax pasted into `cmd.exe`. Type `powershell` to switch shells in place. |
| `Unexpected token '-U' in expression or statement` | A quoted command path in PowerShell is a *string*, not a command. Prefix it with the call operator `&`, or put the `bin` folder on `PATH` and call `psql` plainly. |
| `Cannot open postgresql-x64-17 service on computer '.'` | Access denied — the shell is not elevated. It is not a missing service. |
| `password authentication failed`, with **no password prompt shown** | `PGPASSWORD` is set in the environment and is being used silently. Clear it with `Remove-Item Env:PGPASSWORD` so `psql` prompts. |
| `psql` appears to hang after the password prompt | It is waiting for input; typed characters are not echoed. Type it blind and press Enter. |
| Tables invisible in DBeaver | The connection is pinned to the `postgres` database. Either tick **Show all databases** in the connection's PostgreSQL settings, or create a connection whose **Database** is `cleaning_log`. Tables live under **Schemas → public → Tables**, and DBeaver caches metadata — press **F5**. |

Do **not** use `setx PATH "%PATH%;..."` in `cmd` to make the `PATH` change
permanent: `%PATH%` expands to the combined machine and user path, `setx`
writes all of it into the *user* scope, and it truncates at 1024 characters.
Set it through the user-scope API in PowerShell, or the System Properties
dialog.
