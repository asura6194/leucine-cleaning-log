-- 004_audit.sql
--
-- The audit trail is two tables, not one.
--
-- A single PATCH that changes method and notes is ONE act, by ONE person, at
-- ONE instant, affecting TWO fields. audit_events stores the act (who, when,
-- what kind); audit_field_changes stores one row per field that actually moved.
-- The retrieval endpoint can then return grouped history without any grouping
-- logic in the query.
--
-- The flat alternative -- one row per field change with actor and timestamp
-- repeated -- was rejected because reconstructing an act from those rows means
-- grouping on a timestamp, which is ambiguous the moment two users save within
-- the same instant.

CREATE TABLE audit_events (
  -- bigint identity, not uuid. This table is append-only, higher volume than
  -- the domain tables, and read in strict chronological order, so a
  -- monotonically increasing key supplies both the ordering guarantee and the
  -- pagination cursor. occurred_at cannot order events on its own: two events
  -- can share a timestamp.
  id              bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- (entity_type, entity_id) is the polymorphic pointer to the audited row.
  -- Deliberately NOT a foreign key: no single table to reference, since the
  -- same audit tables are meant to cover other entities later. Referential
  -- integrity for this pair is enforced in application code, which is exactly
  -- why cleaning records are never hard-deleted.
  entity_type     audit_entity NOT NULL,
  entity_id       uuid         NOT NULL,

  action          audit_action NOT NULL,

  -- The "who", as a real reference. RESTRICT means an actor can never be
  -- removed from under their own history.
  actor_user_id   uuid         NOT NULL REFERENCES users (id) ON DELETE RESTRICT,

  -- A frozen copy of the actor's identity at the instant of the change.
  -- Joining to users would return their name TODAY, not their name THEN: if a
  -- user is renamed, every historical audit view would silently rewrite
  -- itself. The FK gives integrity; this column gives historical accuracy.
  actor_label     text         NOT NULL,

  -- Server clock only, never accepted from the client. Contrast
  -- cleaning_records.cleaned_at, which is a claim about the physical world;
  -- this is a fact about the system.
  occurred_at     timestamptz  NOT NULL DEFAULT now(),

  -- Correlates an audit row with the request log line that produced it.
  -- Nullable because seed and migration writes have no HTTP request behind them.
  request_id      text,

  CONSTRAINT audit_events_actor_label_length CHECK (char_length(actor_label) BETWEEN 1 AND 320)
);

-- Serves "audit history for this record, newest first" directly.
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, id DESC);

CREATE TABLE audit_field_changes (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- CASCADE documents that a line has no meaning without its header. In
  -- practice the immutability trigger below makes deleting a header
  -- impossible, so this path is unreachable while that trigger exists.
  audit_event_id  bigint NOT NULL REFERENCES audit_events (id) ON DELETE CASCADE,

  -- Validated in application code against an allowlist of auditable fields.
  field_name      text   NOT NULL,

  -- Canonical text rendering: enum members verbatim, timestamps as ISO-8601
  -- UTC, user references as the referenced label. An empty prior value is SQL
  -- NULL, never the string 'null'. Storing text keeps the table display-ready
  -- and trivially comparable; jsonb would preserve types at the cost of a
  -- rendering layer on read.
  old_value       text,
  new_value       text,

  -- One field cannot appear twice within one event. Also serves as the index
  -- for loading an event's lines.
  CONSTRAINT audit_field_changes_one_row_per_field UNIQUE (audit_event_id, field_name),

  -- A field change that changes nothing is not a field change. The service
  -- layer already suppresses these; this is the backstop.
  CONSTRAINT audit_field_changes_actually_changed CHECK (old_value IS DISTINCT FROM new_value)
);
