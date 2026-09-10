-- 003_domain_tables.sql
--
-- users, equipment, cleaning_records. updated_at is maintained by the service
-- layer rather than a trigger, so the behaviour is visible in application code
-- and cannot silently disagree with what the audit trail recorded.

CREATE TABLE users (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext      NOT NULL UNIQUE,
  name           text        NOT NULL,
  password_hash  text        NOT NULL,
  role           user_role   NOT NULL DEFAULT 'operator',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_name_length  CHECK (char_length(name)  BETWEEN 1 AND 120),
  CONSTRAINT users_email_length CHECK (char_length(email) BETWEEN 3 AND 254)
);

CREATE TABLE equipment (
  id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text             NOT NULL UNIQUE,
  name        text             NOT NULL,
  status      equipment_status NOT NULL DEFAULT 'active',
  created_at  timestamptz      NOT NULL DEFAULT now(),
  updated_at  timestamptz      NOT NULL DEFAULT now(),

  CONSTRAINT equipment_code_length CHECK (char_length(code) BETWEEN 2 AND 32),
  CONSTRAINT equipment_name_length CHECK (char_length(name) BETWEEN 1 AND 120)
);

-- Supports the paginated equipment list, which orders by code within a status.
CREATE INDEX equipment_status_code_idx ON equipment (status, code);

CREATE TABLE cleaning_records (
  id                   uuid            PRIMARY KEY DEFAULT gen_random_uuid(),

  -- RESTRICT, not CASCADE: cleaning history must outlive any attempt to remove
  -- the asset. The API retires equipment instead of deleting it.
  equipment_id         uuid            NOT NULL REFERENCES equipment (id) ON DELETE RESTRICT,

  -- Defaults to the authenticated user in the API, but may name a colleague who
  -- actually performed the work.
  cleaned_by_user_id   uuid            NOT NULL REFERENCES users (id)     ON DELETE RESTRICT,

  -- Client-supplied: a cleaning is often logged after the shift. The
  -- not-in-the-future rule lives in the service layer, because now() is not
  -- immutable and therefore cannot appear in a CHECK constraint.
  cleaned_at           timestamptz     NOT NULL,

  method               cleaning_method NOT NULL,

  -- Nullable on purpose: this is the field that exercises null -> value and
  -- value -> null diffing in the audit trail.
  notes                text,

  status               cleaning_status NOT NULL DEFAULT 'pending',
  verified_by_user_id  uuid            REFERENCES users (id)              ON DELETE RESTRICT,
  verified_at          timestamptz,

  created_at           timestamptz     NOT NULL DEFAULT now(),
  updated_at           timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT cleaning_records_notes_length CHECK (notes IS NULL OR char_length(notes) <= 2000),

  -- The verified state cannot exist half-populated, in either direction:
  -- verified implies both columns are set, and either column set implies
  -- verified.
  CONSTRAINT cleaning_records_verified_state_consistent CHECK (
    (status = 'verified') = (verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL)
  )
);

-- "Records for this equipment, newest cleaning first" -- the list query.
-- The column order matches the ORDER BY exactly, so PostgreSQL can walk the
-- index in order and skip the sort entirely. id is the unique tiebreaker:
-- cleaned_at alone is not unique, and an ordering that is not total lets rows
-- shuffle across a page boundary between two runs of the same query.
--
-- Renamed in 007 once the list moved from keyset to offset pagination; the
-- index is unchanged, because what it serves is the ORDER BY, not the
-- technique used to slice it.
CREATE INDEX cleaning_records_equipment_keyset_idx
  ON cleaning_records (equipment_id, cleaned_at DESC, id DESC);

-- Same query with ?status= applied. A partial index per status was considered
-- and rejected: two statuses today, but a composite index keeps working if a
-- third is ever added.
CREATE INDEX cleaning_records_equipment_status_keyset_idx
  ON cleaning_records (equipment_id, status, cleaned_at DESC, id DESC);
