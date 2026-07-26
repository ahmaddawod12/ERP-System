DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'smart_job_backup'
  ) THEN
    CREATE ROLE smart_job_backup
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOINHERIT;
  END IF;
END;
$$;
--> statement-breakpoint

GRANT pg_read_all_data TO smart_job_backup;
--> statement-breakpoint

DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO smart_job_backup',
    pg_catalog.current_database()
  );
END;
$$;
--> statement-breakpoint

ALTER ROLE smart_job_backup SET statement_timeout = '55min';
ALTER ROLE smart_job_backup SET lock_timeout = '5s';
ALTER ROLE smart_job_backup SET idle_in_transaction_session_timeout = '30s';
--> statement-breakpoint

COMMENT ON ROLE smart_job_backup IS
  'Dedicated logical-backup login; password/login is provisioned out of band';
