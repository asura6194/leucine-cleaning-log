-- 005_audit_immutability.sql
--
-- An audit trail that can be edited is not an audit trail.
--
-- The design document specifies this as a least-privilege database role
-- holding only INSERT and SELECT on the audit tables. A trigger is used
-- instead, for three reasons: it travels with the schema rather than with
-- environment-specific role setup, it works identically on a local server and
-- on managed Postgres where the app connects as the owner, and -- most
-- usefully -- it is testable. Role grants are still the right production
-- complement; this is the portable floor, not a replacement.
--
-- Note the remaining hole: row-level triggers do not fire on TRUNCATE, which
-- is what lets the seed script reset a development database. A statement-level
-- TRUNCATE trigger would close it at the cost of making the dev workflow
-- awkward; that trade is recorded in NOTES.md.

CREATE OR REPLACE FUNCTION audit_rows_are_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'audit records are append-only: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_rows_are_append_only();

CREATE TRIGGER audit_field_changes_append_only
  BEFORE UPDATE OR DELETE ON audit_field_changes
  FOR EACH ROW EXECUTE FUNCTION audit_rows_are_append_only();
