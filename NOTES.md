# Notes — decisions, trade-offs and omissions

## Modelling

**The audit trail is two tables, not one.** A single `PATCH` that changes
`method` and `notes` is one act, by one person, at one instant, affecting two
fields. `audit_events` stores the act; `audit_field_changes` stores one row per
field that moved. The audit endpoint can then return grouped history with no
grouping logic in the query.

The flat alternative — one row per field change with actor and timestamp
repeated — is slightly less code but requires grouping on a timestamp to
reconstruct an act, which is ambiguous the moment two users save within the
same instant.

**`audit_events` points at its target with `(entity_type, entity_id)`, not a
foreign key.** This lets the same audit tables cover other entities later
without migrating existing history. The cost is that referential integrity for
that pair lives in application code — which is precisely why nothing in this
system is hard-deleted. If auditing only ever needed to cover cleaning records,
a plain `cleaning_record_id uuid REFERENCES cleaning_records(id)` would be the
better call: enforced by the database and simpler to explain.

**`actor_label` duplicates what a join to `users` would give.** Intentionally.
A join returns the actor's name *today*; the audit trail needs their name
*then*. Without the frozen copy, renaming a user silently rewrites every
historical audit view. The foreign key supplies integrity, the text column
supplies historical accuracy.

**`audit_events.id` is a `bigint` identity while domain tables use `uuid`.**
The audit tables are append-only and read in strict chronological order, so a
monotonic key gives a total ordering for free. `occurred_at` cannot order
events on its own — two events can share a timestamp.

**Audit values are stored as `text`.** Display-ready and trivially comparable,
at the cost of losing the original type. `jsonb` would preserve types and
require a rendering layer on read. Canonical forms: enum members verbatim,
timestamps as ISO-8601 UTC, user references as the referenced label, and an
empty prior value as SQL `NULL` rather than the string `"null"`.

**Equipment is retired, never deleted.** `DELETE /api/equipment/:id` sets
`status = 'retired'`. A hard delete would either orphan cleaning history or
cascade it away, and both are wrong for an auditable system.

## Deviations from the design document

**Audit immutability is enforced by a trigger, not by database role grants.**
The design specified an application role holding only `INSERT`/`SELECT` on the
audit tables. A trigger was used instead because it travels with the schema
rather than with environment-specific role setup, works identically on a local
server and on managed Postgres where the app connects as the owner, and — most
usefully — is testable. Role grants remain the right production complement;
this is the portable floor, not a replacement.

Known hole: row-level triggers do not fire on `TRUNCATE`, which is what lets
the seed script reset a development database. A statement-level `TRUNCATE`
trigger would close it at the cost of an awkward dev workflow. Accepted
knowingly.

**Passwords use Node's built-in `scrypt` rather than argon2id.** argon2id is
the better primitive. `scrypt` is memory-hard, is a recommended password KDF in
its own right, and ships in the Node standard library — so `npm install` needs
no native build toolchain on any platform. For a submission someone else has to
install, that portability was judged worth more than the marginal gain of
argon2id. The stored format is self-describing
(`scrypt$N$r$p$salt$hash`), so parameters can be raised, or the algorithm
swapped, without invalidating existing hashes.

## Verified, not assumed

Both list queries are served by a composite index that matches their `ORDER BY`
exactly:

```sql
(equipment_id, cleaned_at DESC, id DESC)                  -- ..._list_idx
(equipment_id, status, cleaned_at DESC, id DESC)          -- ..._status_list_idx
```

An index earns its place here by matching the sort, not by matching the
pagination technique: a B-tree stored in that order can be walked in that order,
so no sort step is needed either way. The equality column comes first, the sort
columns after, and the unique `id` closes the key so the ordering is total.

That is also why migration 007 only *renames* these indexes rather than
replacing them — the reversal from keyset to offset changed which rows are
skipped, not which index answers the query. The measured cost of that skipping,
and the point at which it starts to matter, are under *Pagination: offset,
deliberately* below.

The seed deliberately gives every ninth record the **exact** `cleaned_at` of the
record before it — 8 tied pairs in the data. Ordering by `cleaned_at` alone is
therefore genuinely non-deterministic here, so the `(cleaned_at, id)` tiebreaker
is observable by hand rather than only in a test.

## Assumptions

- A verified record stays editable, with the change audited. Real GMP would
  lock it behind an electronic signature; that is out of scope, and the audit
  trail is what makes a later edit acceptable here.
- Cleaning records are never deleted, hence no `delete` member on
  `audit_action`.
- `cleaned_by_user_id` is a user reference rather than free text. The brief's
  example suggests a string; taking the auth stretch goal makes it a foreign
  key, while still allowing an operator to log a cleaning performed by a
  colleague.
- `cleaned_at` is client-supplied and may be in the past (back-entry after a
  shift) but not in the future. Enforced in the service layer, because `now()`
  is not immutable and cannot appear in a `CHECK`.
- Audit history is returned newest-first and paginated, even though an
  individual record will rarely accumulate many events.
- Seed users share a known password, printed in the README, so a reviewer can
  sign in within a minute.

## Deliberately left out

- Electronic signatures and 21 CFR Part 11 signature manifestation.
- Cleaning-validation scheduling, due-date alerts, swab/TOC results,
  attachments, batch linkage.
- A full RBAC matrix. Two role checks are enforced — who may verify, and who
  may write to the equipment register.
- Password reset, sign-up, refresh-token rotation.
- Reporting, CSV export, printable batch records.
- CI, monitoring, deployment beyond Docker Compose.
- Optimistic UI. Mutations refetch; at this size correctness beats perceived
  speed.

## Front-end

**No router.** The app is a master/detail layout: pick an asset, see its
records, open one record's history in a side panel. A router would add a
dependency and a URL scheme to maintain for two views that are always on screen
together. The cost is that the selected asset is not linkable — accepted, and
the first thing I would add with more time.

**No component library, no state-management library.** One hand-written
stylesheet and `useState`. At this size a query cache would be scaffolding
around four endpoints.

**Vite proxies `/api` to Express in development.** This is the decision that
makes cookie auth painless: the browser only ever talks to `localhost:5173`, so
the session cookie is same-origin — no CORS preflight, no `SameSite=None`, no
`secure` cookie dropped over http. It also mirrors production, where the built
assets are served from the same origin as the API.

**Pagination is a numbered pager, not "load more".** Page numbers, prev/next
arrows and a 10 / 20 / 25 rows control — every one of those affordances needs an
offset and a total, which is what put the API on `LIMIT`/`OFFSET` rather than a
cursor. The pager's page-window arithmetic is a pure function in its own module
with unit tests, because which numbers to show around the current page is the
part that can be wrong in a way you cannot see. The full trade is under
*Pagination: offset, deliberately* below.

**The edit form sends only the fields that changed.** Not an optimisation — it
is what keeps the audit trail honest. Submitting every field on every save
would be indistinguishable, server-side, from the user having edited all of
them. Clearing the notes sends `notes: null` explicitly, because absent means
"leave alone" and null means "clear", and those must stay distinguishable all
the way from the form to the diff.

**`shared/contract.ts` is the single source of truth for the wire format.**
Types only, no runtime code, imported with `import type` by both sides. The
API's serialisers are annotated with those types, so a column renamed and
forgotten fails the API build; the web client imports the same types, so a
changed shape fails the web build. Hand-copying the shapes into the front-end
would have let the two drift silently until runtime.

**Two label sets per enum.** `CLEANING_METHOD_SHORT` for table cells,
`CLEANING_METHOD_LABELS` for pickers and history. The full label wrapped in the
table and made row heights ragged, which pushed the action buttons out of
vertical alignment down the list.

## Deviations discovered while building

**`exactOptionalPropertyTypes` was removed from the API's tsconfig.** It
conflicts with the types Zod infers for optional keys, and honouring it would
mean threading `| undefined` through every service signature. `strict` and
`noUncheckedIndexedAccess` remain. The distinction the flag protects — absent
versus explicitly null — is instead explicit in `computeDiff` and covered by a
test, which is a better place for it than a compiler flag.

Related, and found by probing rather than assuming: Zod omits a missing
optional key from its output, but *preserves* a key explicitly set to
`undefined`. `computeDiff` therefore treats `undefined` as absent and only
`null` as "clear this field". JSON cannot carry `undefined` so this cannot
arise over HTTP, but a constructed patch can hold it, and clearing a note
nobody touched would be silent data loss.

**Malformed JSON returned 500 before being fixed.** `express.json()` throws
before any route or schema of ours runs, so body-parser's error reached the
generic handler and the API blamed itself for the caller's mistake. Now
translated: `entity.parse.failed` → 400, `entity.too.large` → 413, unsupported
charset → 415. It surfaced because a shell mangled the quoting on a request
body — a good argument for testing the unhappy paths through a real client.

## Visual theme

The palette is taken from Leucine's own brand rather than invented. Every value
was **sampled from the logo and the product site**, not approximated by eye:

| Sampled | Value | Used for |
|---|---|---|
| Logo dot | `#3274FE` | Primary actions, focus rings, active indicators |
| Site link/eyebrow blue | `#56A6FD` | Links, micro-labels, quiet buttons — the lighter blue reads better than the brand blue on a dark ground |
| Site page background | `#141823` | Chrome: top bar, sidebar, cards, tables |
| Site data-panel ground | `#090C14` → `#0B0E16` | The deepest layer, behind the content area |
| Site card border | `#2D3243` | Every border |
| PASS pill | `#5AE1AF` on `#10352F` | Verified status |
| REVIEW pill | `#FDD02F` on `#382C11` | Pending status |

Two decisions follow from it:

**Single theme, deliberately.** The brand is dark, so there is no light variant
and no `prefers-color-scheme` branch. That means every colour has to be painted
explicitly rather than inherited — including `body`, which would otherwise
borrow the host background.

**`color-scheme: dark` on the root.** Without it the native controls — the
`datetime-local` picker, `select` menus, scrollbars — render as white
rectangles in an otherwise dark interface. This is the single line that stops a
dark theme looking half-finished, and it is easy to miss because the CSS
otherwise looks complete.

Semantic colour (pending / verified) is kept separate from the accent hue, so
status never competes with chrome for attention.

**One layout fix the retheme exposed:** with the audit drawer open the records
grid is wider than its container and scrolls horizontally, which left the
actions column off-screen at the default scroll position. A control the user
cannot see is worse than no control, so the last column is now
`position: sticky; right: 0` — reachable at any scroll offset. Each row state
(default, hover, selected) needs its own background on that pinned cell, or the
rows underneath show through it.

## Bugs found and fixed in the edit form

Three defects in `RecordFormDialog`, all found by driving the running UI rather
than by reading the code.

**A phantom `cleaned_at` audit line on every edit.** The form compared the
`datetime-local` input's value against the stored ISO timestamp. That input has
minute precision, so the round trip dropped the seconds and the value always
looked different — meaning editing *any* field also sent `cleanedAt`, and the
server dutifully recorded a change that never happened. 96 of the 98 seeded
records have non-zero seconds, so it fired almost every time. This was the
worst of the three: the whole point of the diff is that the trail records only
what moved, and the front-end was quietly undermining it. The fix is to compare
in the input's own precision — the original is stored as
`toLocalInputValue(record.cleanedAt)` and compared against that, so an untouched
field is byte-identical and nothing is sent.

**Choosing "me" for *cleaned by* sent an empty string.** The select used `''`
as its "me" sentinel and edit mode forwarded it verbatim, so the API replied
`cleanedByUserId: Must be a UUID`. The sentinel is now resolved to the
signed-in user's id before the request is built, and the option is labelled
with their actual name so it is not ambiguous. Create mode had never hit this,
because it omitted the field and let the server default apply — the same UI
choice behaving differently in the two modes is what hid the bug.

**Clearing the date produced a raw `Invalid time value`.** The form is
`noValidate` so that errors render in the app's own style, which also means
`required` is not enforced by the browser; the empty string reached
`new Date('').toISOString()` and threw. Now validated before submit, surfacing
as a field-level message like any server error.

The lesson worth keeping: all three lived in the boundary between a browser
input's precision and the API's, and none of them were visible from reading
either side alone.

## Pagination: offset, deliberately

Every list endpoint takes `?page=&pageSize=` and returns a `pageInfo`. One
contract, one code path, numbered pages in the UI.

This was a reversal. The first build used keyset pagination — an opaque cursor
encoding `(cleaned_at, id)`, resumed with a ROW comparison against the index.
That is the technically stronger mechanism and it is worth saying why it was
dropped, because the reasoning is the point rather than the outcome.

**What keyset buys.** A page costs O(limit) at any depth, because the cursor is
a WHERE clause rather than a count of rows to skip. And it is stable under
concurrent inserts: the cursor names a row, not a position, so a record logged
while you are reading page 2 cannot shift what page 3 contains.

**What it costs.** A cursor names the last row seen. That is enough to go
forwards and nothing else — no jumping to page 7, no "page 3 of 12", no
Previous button without a second reverse cursor. Those are not
implementation gaps; they are what the mechanism cannot express.

**Why offset won here.** The UI is a numbered pager with a rows-per-page
control, and every one of those affordances needs an offset and a total. The
performance argument for keyset only starts to bite at a size this system will
not reach:

| Rows on one asset | Deepest OFFSET scan | Plus the COUNT | Noticeable? |
|---|---|---|---|
| 97 (seeded) | ~0.04 ms | ~0.1 ms | no |
| 10,000 | ~4 ms | ~1 ms | no |
| 100,000 | ~36 ms | ~10 ms | barely |
| 1,000,000 | ~360 ms | ~52 ms | yes |

Measured, not guessed: a 500,000-row copy of the table with the same index,
`LIMIT 20 OFFSET 399980`, is an Index Only Scan that produces 400,000 rows and
discards 399,980 of them — 143 ms and 6,860 buffers, against 0.14 ms and 5
buffers for the equivalent cursor query. The ratio is real; the absolute
numbers are what decide. A cleaning log for one plant accrues a few thousand
records per asset per year, so the crossover is centuries away.

Building the cursor machinery for 97 rows would have been the thing NFR-18
("don't over-build") exists to prevent.

**What offset costs, recorded rather than hidden.** A record inserted while
someone is paging shifts every later row down one, so a row at the end of page
1 can reappear at the top of page 2. There is a test asserting exactly that —
not because it is desirable, but so the behaviour is a decision on record and
nobody "fixes" it later without understanding what changes.

**The tiebreaker matters more under offset, not less.** Every list orders by a
unique column or ends in one:

```sql
ORDER BY cleaned_at DESC, id DESC
```

`cleaned_at` is not unique — the seed contains deliberate ties. Without the
unique `id` the ordering is not total, and two executions of the same query can
disagree about which row sits either side of a page boundary. That is how a
numbered pager shows one row twice and hides another *with nothing having
changed underneath it*, which is worse than the insert-shift above and entirely
avoidable.

**The indexes did not change.** `(equipment_id, cleaned_at DESC, id DESC)` was
built for the keyset predicate and serves the offset query just as well,
because what an index gives you here is the ORDER BY for free — a B-tree stored
in that order can be walked in that order, with no sort step. Keyset
additionally pushes its WHERE into the same index and stops after `limit`
entries; OFFSET walks past the skipped rows first. Same index, different amount
of walking. Migration 007 renames them from `..._keyset_idx` to `..._list_idx`
so the names stop lying; nothing else about them moved.

**When to revisit.** If a single asset ever passes a few hundred thousand
records, the fix is not necessarily keyset — it is usually a cheaper count
first (`reltuples` from `pg_class`, or a cached total), because the `COUNT(*)`
degrades before the offset does. Keyset comes back only if the access pattern
also stops needing page numbers.

## The equipment register

The brief asks for CRUD on equipment. It was on the API from the start; the UI
and the auditing came later, and three decisions came with them.

**Equipment is audited, on the same terms as cleaning records.** A rename
silently re-labels every record already written against an asset, and a
retirement changes what may be logged against it — both are exactly the kind of
change an inspector asks about. Adding it cost one line of DDL:

```sql
ALTER TYPE audit_entity ADD VALUE IF NOT EXISTS 'equipment';   -- migration 006
```

No new tables, no backfill, no change to a single existing row. That is the
payoff for keying `audit_events` on `(entity_type, entity_id)` instead of
hanging it off `cleaning_records` with a foreign key — the choice was made in
migration 004 and the comment there predicted this migration by name.

**The diff engine is generic over an `AuditSpec`, not tied to one table.** A
spec names the entity, the auditable fields, the kind each holds (which drives
canonical rendering) and the column each is stored under. `computeDiff` takes
one and works for both entities; the alternative was a second near-copy of the
comparison logic, which is the copy that drifts. One TypeScript subtlety worth
knowing: the `current` parameter needs `NoInfer`, or the compiler infers the
field union from the record passed in rather than from the spec and then
complains that the spec is missing `id` and `createdAt` — fields that must
never be audited.

**Writing to the register needs supervisor or admin.** Segregation of duties
already governs verification; the register is master data and deserves the same
treatment. It is a separate constant from `VERIFIER_ROLES` even though both
currently list the same two roles, because they answer different questions and
could reasonably diverge. The client mirrors both lists so it can hide controls
the API would refuse — a deliberate duplication, and the safe direction: drift
shows up as a 403, not as silent over-permission.

One bug worth recording, found by driving the browser rather than by reading
the code. Creating an asset selected it and opened its history in the same
tick; the effect that resets the drawer when the selection changes then closed
it again a frame later. The fix is to close the drawer only when it belongs to
something being left behind, rather than unconditionally on any selection
change.

## With more time

- Role grants on the audit tables, in addition to the trigger.
- A linter. `npm run verify` runs typecheck and tests; there is no eslint
  configuration, which is the most obvious missing piece of the developer
  workflow.
- Per-test transaction rollback, or Testcontainers with a fresh database per
  file. Tests currently isolate themselves with unique fixture codes, which
  works but leaves rows behind.
- `If-Match` / `updated_at` preconditions on every mutation. `updatedAt` is
  already returned to the client; nothing sends it back, so two people editing
  the same record still last-write-wins within the fields each touched.
- Un-retiring an asset. Retirement is one-way in this build; reversing it is a
  new status transition and deserves its own audit action rather than being
  smuggled in as an ordinary update.
- A `TRUNCATE` guard on the audit tables, with a separate maintenance path for
  development resets.
- A router, so a selected asset and an open audit panel are linkable.
- A cheaper count — `reltuples` or a cached total — if a single asset ever
  grows past a few hundred thousand records. The count degrades before the
  offset does.
- Component tests for the front-end. The UI was verified by driving a real
  browser end to end (sign in, filter, page, edit, verify, add and retire
  equipment, read both histories back) but that check lives outside the
  repository.
