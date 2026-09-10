# Equipment Cleaning Log

A cleaning log for pharmaceutical manufacturing equipment with a field-level
audit trail: every change to a cleaning record is preserved as a history of
who changed what, when, and from which value to which.

PostgreSQL · Node.js · TypeScript · Express · React

> **Build status:** database, API, React front-end and Docker Compose are all
> working — 68 tests plus a 121-assertion Postman collection, and the UI driven
> end to end in a real browser. Equipment and cleaning records are both audited.
> See [NOTES.md](NOTES.md) for decisions and trade-offs.

---

## Run everything with Docker (one command)

The fastest way to see the whole system, and the only path that needs nothing
installed but Docker itself — no Node, no PostgreSQL.

```bash
docker compose up --build
```

First run takes 2–4 minutes while the images build; afterwards it is seconds.
Then open **<http://localhost:8080>** and sign in with any seeded account
(`priya@leucine.test` / `password123`, or `ravi@leucine.test` to get the Verify
action).

| Service | What it is | Where |
|---|---|---|
| `web` | The built React app, served by nginx, which also proxies `/api` to the API | <http://localhost:8080> |
| `api` | Express, compiled to JavaScript | <http://localhost:4000> — for Postman |
| `db` | PostgreSQL 17 | `localhost:5433` — for DBeaver |

Ports avoid the defaults on purpose: **5433**, not 5432, so the container does
not collide with a PostgreSQL you already have running.

Migrations run on every start and are idempotent. The seed runs **only when the
database is empty**, so restarting never discards data you entered.

```bash
docker compose up --build       # start (rebuild images)
docker compose up -d            # start in the background
docker compose logs -f api      # follow one service's logs
docker compose ps               # what is running, and is it healthy
docker compose down             # stop; the database volume survives
docker compose down -v          # stop and DELETE the database
```

### Why the browser talks to nginx and not to the API directly

nginx serves the front-end *and* forwards `/api` to the API container, so
everything the browser sees is one origin. That is what makes the httpOnly
session cookie work with no CORS configuration, no `SameSite=None`, and no
`secure` cookie being dropped over plain http. It is the same arrangement
Vite's dev proxy provides, so development and the container behave identically.

## Running it yourself (without Docker)

### Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 20+ | `node --version` |
| PostgreSQL 13+ | The migration refuses to run on anything older, because it relies on `gen_random_uuid()` being in core. |

## 1 · Create the database

Using `psql`:

```bash
psql -U postgres -c "CREATE DATABASE cleaning_log;"
```

Or in DBeaver: right-click your PostgreSQL connection → **Create** → **Database**,
name it `cleaning_log`.

## 2 · Configure the connection

```bash
cp api/.env.example api/.env
```

Then edit `api/.env` so `DATABASE_URL` matches your server:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/cleaning_log
PGSSLMODE=disable
```

`PGSSLMODE` stays `disable` for a local server. Set it to `require` when
pointing at managed Postgres (Supabase, RDS), which is the only change needed
to run against a hosted database.

## 3 · Install and migrate

```bash
npm run install:all
npm run migrate
```

Expected output:

```
  localhost:5432/cleaning_log

  applied  001_extensions.sql
  applied  002_enums.sql
  applied  003_domain_tables.sql
  applied  004_audit.sql
  applied  005_audit_immutability.sql
  applied  006_audit_equipment.sql
  applied  007_rename_list_indexes.sql

  7 migration(s) applied
```

## 4 · Seed

```bash
npm run seed
```

This creates 4 users, 6 equipment items, 97 cleaning records and 178 audit
events with 676 field-change rows. **MIX-101 carries 72 records**, which is
four pages at the default page size of 20 — enough to page through by hand.

All seeded users share the password `password123`:

| Email | Name | Role |
|---|---|---|
| `priya@leucine.test` | Priya Nair | operator |
| `arun@leucine.test` | Arun Menon | operator |
| `ravi@leucine.test` | Ravi Kumar | supervisor |
| `divya@leucine.test` | Divya Rao | admin |

Only `supervisor` and `admin` may verify a cleaning record.

## 5 · Run the API

```bash
npm run dev:api
```

The API listens on <http://localhost:4000>. Check it:

```bash
curl http://localhost:4000/api/healthz
# {"status":"ok","database":"ok"}
```

`healthz` reports the database as well as the process: a 200 from a server that
cannot reach PostgreSQL is a health check that lies.

### Trying it from the command line

```bash
# sign in (stores the session cookie in a jar)
curl -c jar -X POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"priya@leucine.test","password":"password123"}'

# list equipment
curl -b jar http://localhost:4000/api/equipment

# first page of cleaning records for one asset
curl -b jar "http://localhost:4000/api/equipment/<equipment-id>/cleaning-records?page=1&pageSize=20"

# edit a record -- this writes the audit trail
curl -b jar -X PATCH http://localhost:4000/api/cleaning-records/<record-id> \
  -H 'content-type: application/json' \
  -d '{"method":"cip","notes":"Rinse extended to 12 min."}'

# read the field-level history back
curl -b jar http://localhost:4000/api/cleaning-records/<record-id>/audit
```

## 6 · Run the tests

```bash
npm test          # 68 tests — 59 API, 9 web
npm run verify    # typecheck + tests
```

The integration tests run against the real PostgreSQL database configured in
`api/.env`. They create their own fixtures under unique equipment codes, so
they neither need the seed nor disturb it. The database is deliberately not
mocked: transactional audit writes, row locking and total ordering across
tied sort keys are all properties of PostgreSQL, and a mock would only assert
that the mock behaves as written.

## API

All endpoints are under `/api`. Every endpoint except `login` and `healthz`
requires a session cookie.

Two role gates, both enforced server-side:

- Moving a cleaning record to `verified` needs **supervisor** or **admin** —
  segregation of duties: the person who logs a cleaning should not be the
  person who attests to it.
- Writing to the equipment register needs **supervisor** or **admin** —
  it is controlled master data, and renaming an asset silently re-labels every
  cleaning record already written against it.

Reads are open to any signed-in user, including both audit trails.

| Endpoint | Behaviour |
|---|---|
| `POST /api/auth/login` | Credentials for a signed httpOnly session cookie. Rate limited. |
| `POST /api/auth/logout` | Clears the cookie. |
| `GET /api/auth/me` | The current user. |
| `GET /api/auth/users` | Users, for the "cleaned by" picker. |
| `GET /api/equipment` | Paginated list. `?status=`, `?page=`, `?pageSize=` |
| `POST /api/equipment` | Create. **Supervisor/admin only.** Writes a `create` audit event. 409 on a duplicate code. |
| `GET /api/equipment/:id` | One asset. |
| `PATCH /api/equipment/:id` | Partial update. **Supervisor/admin only.** Audited. |
| `DELETE /api/equipment/:id` | **Retires** the asset; the row is never removed. **Supervisor/admin only.** Audited as a status change. 409 if already retired. |
| `GET /api/equipment/:id/audit` | Field-level history for one asset, newest event first, paginated. Readable by any session. |
| `GET /api/equipment/:id/cleaning-records` | Paginated, newest cleaning first. `?status=`, `?page=`, `?pageSize=` |
| `POST /api/equipment/:id/cleaning-records` | Create. Writes a `create` audit event. 422 if the asset is retired. |
| `GET /api/cleaning-records/:id` | One record. |
| `PATCH /api/cleaning-records/:id` | Update. Writes the audit trail in the same transaction. |
| `GET /api/cleaning-records/:id/audit` | Field-level history, newest event first, paginated. |
| `GET /api/healthz` | Process and database reachability. |

### Pagination

Every list endpoint takes the same two parameters and returns the same
envelope:

```
?page=1&pageSize=20
```

```json
{ "data": [ ... ],
  "pageInfo": { "page": 1, "pageSize": 20, "totalItems": 72, "totalPages": 4 } }
```

`pageSize` defaults to 20 and is clamped to 100, so no caller can ask for an
unbounded response. `page` is 1-based; `page=0` is a 400 rather than a silent
"you probably meant 1".

`pageInfo.page` is the page **actually served**. A request past the end is
clamped to the last page rather than returning an empty grid, so a client whose
page size just changed can correct itself instead of highlighting a page number
that no longer exists. An empty list is one empty page, never zero — "page 1 of
0" is not something a pager can render.

There is no `hasMore`: it is `page < totalPages`, and a wire contract carrying
derivable state eventually carries a contradiction.

Offset rather than a cursor is a deliberate choice with a real cost, measured
and written up in [NOTES.md](NOTES.md).

### Errors

One shape throughout, so a client can switch on `code` and a form can attach
`details` to the field that caused them:

```json
{ "error": { "code": "conflict", "message": "That equipment code is already in use.",
             "details": [ { "path": "code", "message": "Already in use." } ] } }
```

`400` validation · `401` no session · `403` role · `404` missing ·
`409` conflict · `422` rule violation · `500` unexpected.

## 7 · Run the front-end

Two terminals. In the first:

```bash
npm run dev:api     # Express on http://localhost:4000
```

In the second:

```bash
npm run dev:web     # Vite on http://localhost:5173
```

Open <http://localhost:5173> and sign in as any seeded user
(`password123`). Sign in as **ravi@leucine.test** to see the Verify action;
**priya@leucine.test** is an operator and is not offered it.

Vite proxies `/api` to the Express server, so the browser only ever talks to
one origin. That is what makes the httpOnly session cookie work in development
without CORS, `SameSite=None`, or a `secure` cookie being silently dropped over
http — and it mirrors production, where the built assets are served from the
same origin as the API.

### What the UI does

| Screen | Behaviour |
|---|---|
| Sign in | Seeded accounts listed on the form. A failed attempt keeps what you typed. |
| Equipment list | Every asset, retired ones marked. Selecting one loads its records. Supervisors and admins also get **+ Add** and a per-row edit control; operators do not see either. |
| Add / edit equipment | Code and name, with retirement behind a confirmation step inside the dialog. On edit it sends only the fields that changed, for the same reason as the record form. |
| Cleaning records | Numbered pages with prev/next arrows and a 10 / 20 / 25 rows dropdown, plus All / Pending / Verified filters. Changing the filter, the page size or the asset returns you to page 1 — page 7 of one list is not page 7 of another. Notes truncate with the full text on hover. |
| Add / edit record | One dialog for both. On edit it sends **only the fields that changed** — submitting everything would be indistinguishable from the user having edited it, and the audit trail would be wrong. |
| Verify | Offered only to supervisors and admins. The server enforces it regardless; showing a button that always fails is not a UI. |
| Audit trail | A side panel, one block per event, with a table of `field · was · became` inside it. Cleared values show an explicit dash; old values are struck through. |
| Asset history | The same panel over the equipment trail, reached from **Asset history** in the records header. One component serves both, because the audit tables are polymorphic on `(entity_type, entity_id)`. |

The pager is numbered rather than load-more, which is what put the API on
`LIMIT`/`OFFSET`: jumping to page 7 and knowing there are 12 pages both need an
offset and a count, and a cursor can express neither. NOTES.md has the
measurements behind that trade and the point at which it would need revisiting.

## 8 · Build the front-end

```bash
npm run build:web       # typecheck, then a production bundle in web/dist
```

## Database commands

| Command | Effect |
|---|---|
| `npm run migrate` | Apply pending migrations. Safe to re-run. |
| `npm run migrate:status` | List applied and pending migrations, changing nothing. |
| `npm run seed` | Truncate and re-seed. Refuses to run against a non-local host unless `ALLOW_REMOTE_SEED=true`. |
| `npm run db:reset` | Drop the schema, re-migrate, re-seed. Local only. |
| `npm run typecheck` | `tsc --noEmit` across both the API and the web client. |

Migrations are **forward-only**. Editing a migration that has already been
applied is refused with a checksum mismatch — the fix is a new migration. In
development, `npm run db:reset` rebuilds from scratch.

## Schema at a glance

```
users ──┬─< cleaning_records >── equipment
        │        │
        │        ╎ (entity_type, entity_id)
        └─< audit_events ─< audit_field_changes
```

Five tables, six enums. `audit_events` records one act — who, when, what kind —
and `audit_field_changes` holds one row per field that actually moved, with its
old and new value. The connection from `cleaning_records` to `audit_events` is
deliberately not a foreign key; see `api/migrations/004_audit.sql`.

![Entity relationships](docs/diagrams/er-diagram.png)

## Documentation

| Document | Contents |
|---|---|
| [docs/Design-and-Requirements-Specification.pdf](docs/Design-and-Requirements-Specification.pdf) | The design record: entity model, ER diagram, column-level schema, the audited write path, and the full requirement set traced to the assignment brief. |
| [docs/More-Information.pdf](docs/More-Information.pdf) | Supplementary design reasoning: roles and segregation of duties, what is enforced where, and the questions the design invites. |
| [docs/database-layer.md](docs/database-layer.md) | The database layer as built: schema decisions, what the seed produces and why, verification queries with expected values, and setup troubleshooting. |
| [docs/postman/](docs/postman/) | A Postman collection: 53 requests in 8 folders, 121 assertions, ordered so a single Collection Runner pass exercises the audit trail, the role checks and pagination end to end. See [docs/api-testing.md](docs/api-testing.md). |
| [NOTES.md](NOTES.md) | Decisions, trade-offs, deviations from the specification, assumptions, and what was deliberately left out. |
