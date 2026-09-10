-- 002_enums.sql
--
-- Native enums rather than lookup tables: every one of these is a closed set
-- owned by the application. If cleaning methods later had to be configurable
-- per plant, cleaning_method would become a table -- that is a deliberate
-- future change, not something to pre-build now.

-- Who is acting. Only supervisor and admin may verify a cleaning record.
CREATE TYPE user_role AS ENUM ('operator', 'supervisor', 'admin');

-- Equipment lifecycle. Retirement replaces deletion so cleaning history
-- always keeps a parent row to point at.
CREATE TYPE equipment_status AS ENUM ('active', 'retired');

-- Cleaning record lifecycle. One-way: pending -> verified. There is no
-- transition back; a mistaken verification is corrected by a new record.
CREATE TYPE cleaning_status AS ENUM ('pending', 'verified');

-- cip = clean-in-place, cop = clean-out-of-place.
CREATE TYPE cleaning_method AS ENUM ('manual', 'cip', 'cop', 'solvent_flush');

-- No 'delete' member: nothing in this system is deleted, so an audit action
-- describing a deletion could never legitimately be written.
CREATE TYPE audit_action AS ENUM ('create', 'update');

-- Extension point for the polymorphic audit target. Only cleaning_record is
-- wired up today; adding 'equipment' later is an ALTER TYPE, not a migration
-- of existing history.
CREATE TYPE audit_entity AS ENUM ('cleaning_record');
