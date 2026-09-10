# Postman collection

`Equipment-Cleaning-Log.postman_collection.json` — 53 requests in 8 folders,
121 assertions.

## Import

Postman → **Import** → drop in the collection file. The environment file is
optional: `host` and `baseUrl` are already collection variables defaulting to
`http://localhost:4000`.

## Before running

```bash
npm run migrate
npm run seed        # the collection expects MIX-101 to exist
npm run dev         # API on http://localhost:4000
```

## Run it

Use the **Collection Runner** on the whole collection. The folders are ordered
so each request sets up the next, and every request carries assertions — a
green run is a working API. It is safe to run repeatedly: the one request that
would collide with a unique index generates a fresh code per run.

Or step through folder by folder from the top.

There is no token to copy. Login returns a signed httpOnly cookie, which
Postman's cookie jar stores and replays automatically. Folder 3 switches to the
supervisor for the register writes and switches back to the operator at the end,
so the verification refusal later is a real 403 rather than an accident of who
happened to be signed in. Folder 5 switches from
an operator to a supervisor mid-run, which is how the role checks are shown.

## Command line

```bash
npm install -g newman
newman run docs/postman/Equipment-Cleaning-Log.postman_collection.json
```

Verified: 53/53 requests, 121/121 assertions, twice in succession.

## What each folder demonstrates

| Folder | Point |
|---|---|
| 1 · System | Health reports the database, not just the process. Reads require a session, not only writes. |
| 2 · Auth | Identical message for unknown email and wrong password; no password material in any response. |
| 3 · Equipment | CRUD on the register, the supervisor/admin gate an operator hits as a 403, the audit trail a create and a rename write, and a duplicate code translated to 409 rather than surfacing as a 500. |
| **4 · Cleaning records & audit** | One event per save, one line per field that moved, `null → value` on create, `value → null` on clear, and **no event at all** when a save changed nothing. |
| **5 · Roles** | An operator gets 403 verifying their own work; a supervisor succeeds, and three fields move together in one event attributed to them. Un-verifying is 422. |
| **6 · Pagination** | `pageInfo` that agrees with itself, no row on two adjacent pages, an arbitrary jump to the last page, a past-the-end page clamped rather than blank, a filtered total that follows the filter, `pageSize` clamped to 100, `page=0` refused as 400, and the audit trail paginated by the same contract. |
| 7 · Validation | One error envelope throughout. Malformed JSON is 400, not 500. Unknown fields are rejected, not ignored. |
| 8 · Retirement | `DELETE` retires the asset; its history stays readable, it accepts no new records, and retiring twice is 409. |

Folders 4, 5 and 6 are the ones worth reading first — they are the assignment's
stated evaluation criteria.
