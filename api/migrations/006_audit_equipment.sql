-- 006_audit_equipment.sql
--
-- Equipment joins the audit trail.
--
-- 002_enums.sql created audit_entity with a single member and a comment
-- predicting this: "adding 'equipment' later is an ALTER TYPE, not a migration
-- of existing history". This is that ALTER TYPE, and nothing else was needed --
-- no new tables, no backfill, no change to a single existing row. That is the
-- payoff for making the audit tables polymorphic on (entity_type, entity_id)
-- instead of hanging them off cleaning_records with a foreign key.
--
-- Safe to run against a populated database: adding an enum member does not
-- rewrite the column, and the existing index on
-- (entity_type, entity_id, id DESC) already serves the new entity's history
-- query without modification.
--
-- IF NOT EXISTS makes it idempotent, which matters because the container
-- runs every migration on every start.

ALTER TYPE audit_entity ADD VALUE IF NOT EXISTS 'equipment';
