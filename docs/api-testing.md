# API testing

Three ways to exercise the API, in descending order of how quickly they
convince someone the thing works.

The Postman collection lives beside this file in [`postman/`](postman/).

---

## 1 · Postman collection — the fastest way to see it work

`docs/postman/Equipment-Cleaning-Log.postman_collection.json`
**53 requests · 8 folders · 121 assertions**

```bash
npm run migrate
npm run seed        # the collection expects MIX-101 to exist
npm run dev         # API on http://localhost:4000
```

Postman → **Import** → drop in the collection file. No environment file
needed: `host` and `baseUrl` are collection variables already pointing at
`http://localhost:4000`.

Then use the **Collection Runner** on the whole collection. Folders are ordered
so each request sets up the next, and every request carries assertions — so a
green run is a working API, not merely 53 requests that returned something.

**There is no token to copy.** Login returns a signed httpOnly cookie, which
Postman's cookie jar stores and replays automatically. Folder 5 deliberately
switches from an operator to a supervisor mid-run; that is how the role checks
are demonstrated.

The collection is safe to run repeatedly. The one request that would collide
with a unique index generates a fresh equipment code per run in a pre-request
script.

### What each folder proves

| Folder | Point being made |
|---|---|
| 1 · System | `healthz` reports the database, not just the process. Reads need a session, not only writes — the first request clears the cookie jar so it genuinely runs unauthenticated. |
| 2 · Auth | Unknown email and wrong password return an identical message, and the hash is verified even for a missing user so timing reveals nothing. No password material in any response. |
| 3 · Equipment | CRUD on the register; an operator refused with 403 on all three write verbs; the asset audit trail after a create and after a rename, including the no-op save that writes nothing; and a duplicate code translated to 409 with the offending field named — never surfacing as a 500. |
| **4 · Cleaning records & audit** | The centrepiece, as a narrative: create writes every field as `null → value` and **no** line for fields still empty; a two-field save produces **one** event with **two** lines; resubmitting identical values asserts the event count **did not change**; `notes: null` asserts a `value → null` line, proving an explicit null differs from an omitted key. |
| **5 · Roles** | An operator gets 403 verifying their own work. A supervisor succeeds, and `status`, `verified_by_user_id` and `verified_at` are asserted to move together in **one** event attributed to them. Un-verifying is 422. |
| **6 · Pagination** | `pageInfo` internally consistent (`totalPages` = ceil(`totalItems` / `pageSize`)); page 2 asserts an empty intersection with page 1; a jump straight to the last page; a page past the end clamped rather than blank; a filtered total that follows the filter; `pageSize` clamped to 100; `page=0` refused with the offending field named; and the audit endpoint on the same contract. |
| 7 · Validation | One error envelope throughout. Malformed JSON is 400, not 500. Unknown fields are rejected rather than ignored. |
| 8 · Retirement | `DELETE` retires the asset; its history stays readable, it accepts no new records, and retiring twice is 409. |

Folders 4, 5 and 6 map directly onto the assignment's stated evaluation
criteria and are the ones worth opening first.

---

## 2 · Newman — the same collection on the command line

```bash
npm install -g newman
newman run docs/postman/Equipment-Cleaning-Log.postman_collection.json
```

Verified: **53/53 requests, 121/121 assertions, twice in succession.**

One gotcha, found the hard way: a request whose `url` is a raw-only *object*
(`{"raw": "..."}`) is accepted by the Postman UI but rejected by Newman with
`request url is empty`. Plain string URLs work in both, which is what this
collection uses.

---

## 3 · curl — for a reviewer on macOS or Linux

```bash
BASE=http://localhost:4000/api

curl -s $BASE/healthz

curl -s -c jar -X POST $BASE/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"priya@leucine.test","password":"password123"}'

curl -s -b jar $BASE/equipment

curl -s -b jar "$BASE/equipment/<equipment-id>/cleaning-records?limit=20"

curl -s -b jar -X PATCH $BASE/cleaning-records/<record-id> \
  -H 'content-type: application/json' \
  -d '{"method":"cip","notes":"Rinse extended to 12 min."}'

curl -s -b jar $BASE/cleaning-records/<record-id>/audit
```

### On Windows

Two traps, both shell-level rather than API-level:

**`curl` is not curl.** In Windows PowerShell 5.1, bare `curl` is an alias for
`Invoke-WebRequest`, which takes entirely different flags. Write `curl.exe`.

**PowerShell mangles quotes passed to native executables.** A JSON body written
inline arrives at the server with its double quotes stripped, which the API
correctly reports as a 400 for malformed JSON. Put the body in a file instead:

```powershell
$T = "$env:TEMP\body.json"
'{"email":"priya@leucine.test","password":"password123"}' | Set-Content -Encoding ascii $T
curl.exe -s -c $J -X POST $B/auth/login -H "content-type: application/json" -d "@$T"
```

Or skip `curl` entirely and use PowerShell's own client, which handles JSON and
cookies natively:

```powershell
$login = @{ email = 'priya@leucine.test'; password = 'password123' } | ConvertTo-Json
Invoke-RestMethod "$B/auth/login" -Method Post -ContentType 'application/json' -Body $login -SessionVariable S
Invoke-RestMethod "$B/auth/me" -WebSession $S
```

---

## 4 · The automated suite

The Postman collection is for a human to watch. The repository's own tests are
what run in CI and on every change:

```bash
npm test          # 68 tests — 59 API, 9 web
npm run verify    # typecheck + tests
```

| File | Covers |
|---|---|
| `api/tests/diff.test.ts` | `computeDiff` and canonical rendering — no change, one field, several fields, null↔value, identical resubmit, `undefined` treated as absent, non-auditable fields ignored, equal-but-differently-formatted timestamps. Then the same engine driven over equipment, which is the proof that generalising it removed a duplicate rather than adding an abstraction. Pure functions, no database. |
| `api/tests/password.test.ts` | scrypt verify/reject, salt randomness, malformed stored hash returning `false` rather than throwing. |
| `api/tests/api.test.ts` | Integration against a real PostgreSQL: audit correctness, the no-op suppression, role enforcement on both gates, the concurrent-update chain, pagination completeness and stability across ties, retirement, the audited equipment register, and atomicity in both directions — including an injected trigger failure on `audit_field_changes` proving a failed audit write rolls the record change back with it. |
| `web/tests/pageNumbers.test.ts` | The pager's page-number window as a pure function: the current page is always present, the first and last are always reachable, the control keeps a constant width once it abbreviates, and no ellipsis ever stands for fewer than two pages. |

The integration tests deliberately do **not** mock the database. Transactional
audit writes, `SELECT … FOR UPDATE` row locking and page boundaries that stay
stable across tied sort keys are all properties of PostgreSQL; a mock would
only assert that the mock behaves as written. They create their own fixtures under unique
`TST-*` equipment codes, so they neither depend on the seed nor disturb it.

### The one test worth reading first

`keeps the audit chain contiguous under concurrent updates`. Two simultaneous
`PATCH`es on the same record must produce `manual → cip → cop` — a chain where
each event's new value is the next event's old value. Without
`SELECT … FOR UPDATE` both requests read the same "old" value and write
`manual → cip` **and** `manual → cop`: two updates claiming the same starting
point, and an audit trail that lies about what happened.
