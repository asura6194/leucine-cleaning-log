-- 001_extensions.sql
--
-- gen_random_uuid() is part of core PostgreSQL from version 13, so pgcrypto is
-- not required. The guard below fails loudly on an older server rather than
-- leaving a confusing "function does not exist" error in a later migration.

DO $$
BEGIN
  IF current_setting('server_version_num')::int < 130000 THEN
    RAISE EXCEPTION
      'PostgreSQL 13 or newer is required (found %)', current_setting('server_version');
  END IF;
END
$$;

-- citext gives a case-insensitive login identity without lower() on every read.
CREATE EXTENSION IF NOT EXISTS citext;
