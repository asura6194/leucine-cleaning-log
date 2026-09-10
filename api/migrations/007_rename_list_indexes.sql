-- 007_rename_list_indexes.sql
--
-- The two composite indexes were named for keyset pagination. The list
-- endpoints now use LIMIT/OFFSET instead, so the names lie -- but the INDEXES
-- themselves are unchanged and still exactly right, which is the point worth
-- understanding.
--
-- An index earns its place by matching the ORDER BY, not by matching the
-- pagination technique. Both queries end in
--
--     ORDER BY cleaned_at DESC, id DESC
--
-- and a B-tree stored in that order can be walked in that order, so PostgreSQL
-- needs no sort step either way. Keyset additionally pushes its WHERE clause
-- into the same index and stops after `limit` entries; OFFSET has to walk past
-- the skipped rows first. Same index, different amount of walking.
--
-- The unique `id` stays in the key for the same reason it was there before,
-- and it matters MORE under OFFSET, not less: cleaned_at is not unique, and an
-- ordering that is not total lets two executions of the same query disagree
-- about which row sits either side of a page boundary. That is how a numbered
-- pager shows one row twice and hides another without anything having changed.
--
-- Renaming an index is a catalogue-only operation: no rewrite, no rebuild, and
-- it holds only a brief lock.

ALTER INDEX cleaning_records_equipment_keyset_idx
  RENAME TO cleaning_records_equipment_list_idx;

ALTER INDEX cleaning_records_equipment_status_keyset_idx
  RENAME TO cleaning_records_equipment_status_list_idx;
