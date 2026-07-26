-- Authoritative archive periods and narrow API retrieval functions.
--
-- This is the expand side of the archive retrieval change. Existing API
-- revisions retain their RLS-protected SELECT grant until the new exact-run
-- RPC has completed its rollout; the grant is removed in the later contract
-- migration after deployment evidence confirms no old revision remains.

ALTER TABLE public.archive_runs
  ADD COLUMN period_start TIMESTAMPTZ,
  ADD COLUMN period_end TIMESTAMPTZ;
--> statement-breakpoint

DO $$
DECLARE
  v_unknown_count BIGINT;
  v_conflict_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO v_unknown_count
  FROM public.archive_runs AS run
  WHERE NOT CASE
    WHEN run.archive_key ~ '^[0-9]{4}-(0?[1-9]|1[0-2])-[jd]$' THEN
      (run.data_type = 'jobs' AND run.archive_key ~ '-j$')
      OR (run.data_type = 'documents' AND run.archive_key ~ '-d$')
    WHEN run.archive_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[jd]-s[0-9]{6}$' THEN
      (
        (run.data_type = 'jobs' AND run.archive_key ~ '-j-s[0-9]{6}$')
        OR (run.data_type = 'documents' AND run.archive_key ~ '-d-s[0-9]{6}$')
      )
      AND pg_catalog.split_part(run.archive_key, '-s', 2)::INTEGER > 0
    ELSE false
  END;
  IF v_unknown_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ARCHIVE_PERIOD_BACKFILL_UNKNOWN_KEY',
      DETAIL = pg_catalog.format('%s archive run(s) have an unmappable key', v_unknown_count);
  END IF;

  UPDATE public.archive_runs AS run
  SET period_start = pg_catalog.make_timestamptz(
        pg_catalog.split_part(run.archive_key, '-', 1)::INTEGER,
        pg_catalog.split_part(run.archive_key, '-', 2)::INTEGER,
        1, 0, 0, 0, 'UTC'
      ),
      period_end = pg_catalog.make_timestamptz(
        pg_catalog.split_part(run.archive_key, '-', 1)::INTEGER,
        pg_catalog.split_part(run.archive_key, '-', 2)::INTEGER,
        1, 0, 0, 0, 'UTC'
      ) + INTERVAL '1 month',
      segment = CASE
        WHEN run.archive_key ~ '-s[0-9]{6}$'
          THEN pg_catalog.split_part(run.archive_key, '-s', 2)::INTEGER
        ELSE 1
      END;

  SELECT COUNT(*)
  INTO v_conflict_count
  FROM (
    SELECT run.company_id, run.data_type, run.period_start, run.segment
    FROM public.archive_runs AS run
    GROUP BY run.company_id, run.data_type, run.period_start, run.segment
    HAVING COUNT(*) > 1
  ) AS conflict;
  IF v_conflict_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'ARCHIVE_PERIOD_SEGMENT_CONFLICT',
      DETAIL = pg_catalog.format('%s duplicate period segment(s) found', v_conflict_count);
  END IF;
END;
$$;
--> statement-breakpoint

ALTER TABLE public.archive_runs
  ALTER COLUMN period_start SET NOT NULL,
  ALTER COLUMN period_end SET NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX archive_runs_company_type_period_segment_unique
  ON public.archive_runs (company_id, data_type, period_start, segment);
--> statement-breakpoint

CREATE INDEX archive_runs_company_type_period_cursor_idx
  ON public.archive_runs (company_id, data_type, period_start, created_at, id);
--> statement-breakpoint

ALTER TABLE public.archive_runs
  ADD CONSTRAINT archive_runs_period_check CHECK (
    period_start = (
      pg_catalog.date_trunc('month', period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    )
    AND period_end = period_start + INTERVAL '1 month'
  ),
  ADD CONSTRAINT archive_runs_key_period_check CHECK (
    CASE
      WHEN archive_key ~ '^[0-9]{4}-(0?[1-9]|1[0-2])-[jd]$' THEN
        pg_catalog.split_part(archive_key, '-', 1)::INTEGER
          = pg_catalog.extract(YEAR FROM period_start AT TIME ZONE 'UTC')::INTEGER
        AND pg_catalog.split_part(archive_key, '-', 2)::INTEGER
          = pg_catalog.extract(MONTH FROM period_start AT TIME ZONE 'UTC')::INTEGER
        AND (
          (data_type = 'jobs' AND archive_key ~ '-j$')
          OR (data_type = 'documents' AND archive_key ~ '-d$')
        )
        AND segment = 1
      WHEN archive_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[jd]-s[0-9]{6}$' THEN
        pg_catalog.split_part(archive_key, '-', 1)::INTEGER
          = pg_catalog.extract(YEAR FROM period_start AT TIME ZONE 'UTC')::INTEGER
        AND pg_catalog.split_part(archive_key, '-', 2)::INTEGER
          = pg_catalog.extract(MONTH FROM period_start AT TIME ZONE 'UTC')::INTEGER
        AND (
          (data_type = 'jobs' AND archive_key ~ '-j-s[0-9]{6}$')
          OR (data_type = 'documents' AND archive_key ~ '-d-s[0-9]{6}$')
        )
        AND pg_catalog.split_part(archive_key, '-s', 2)::INTEGER = segment
      ELSE false
    END
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.record_archiver_uploaded_run(
  p_lease_id UUID,
  p_lease_token UUID,
  p_doc_count INTEGER,
  p_storage_path TEXT,
  p_checksum TEXT,
  p_storage_generation BIGINT,
  p_id_manifest_path TEXT,
  p_id_manifest_checksum TEXT,
  p_id_manifest_generation BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
  v_run public.archive_runs%ROWTYPE;
  v_public_company_id BIGINT;
  v_full_key TEXT;
  v_expected_storage_path TEXT;
  v_expected_id_path TEXT;
BEGIN
  IF p_lease_id IS NULL
     OR p_lease_token IS NULL
     OR p_doc_count IS NULL
     OR p_doc_count NOT BETWEEN 1 AND 1000000
     OR p_storage_path IS NULL
     OR p_checksum IS NULL
     OR p_checksum !~ '^[0-9a-f]{64}$'
     OR p_storage_generation IS NULL
     OR p_id_manifest_path IS NULL
     OR p_id_manifest_checksum IS NULL
     OR p_id_manifest_checksum !~ '^[0-9a-f]{64}$'
     OR p_id_manifest_generation IS NULL
     OR p_storage_generation <= 0
     OR p_id_manifest_generation <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_UPLOAD_INVALID';
  END IF;
  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
    AND lease.lease_until > pg_catalog.clock_timestamp()
  FOR UPDATE OF lease;
  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;
  SELECT company.public_company_id
  INTO STRICT v_public_company_id
  FROM public.companies AS company
  WHERE company.id = v_lease.company_id;

  v_full_key := pg_catalog.format(
    '%s-%s-s%s',
    v_lease.archive_key,
    CASE WHEN v_lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
    pg_catalog.lpad(v_lease.segment::TEXT, 6, '0')
  );
  v_expected_storage_path := pg_catalog.format(
    'companies/%s/archives/%s.json', v_public_company_id, v_full_key
  );
  v_expected_id_path := pg_catalog.format(
    'companies/%s/archives/%s.ids.json', v_public_company_id, v_full_key
  );
  IF p_storage_path <> v_expected_storage_path OR p_id_manifest_path <> v_expected_id_path THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_OBJECT_PATH_INVALID';
  END IF;

  INSERT INTO public.archive_runs (
    company_id, archive_key, data_type, status, period_start, period_end,
    snapshot_at, segment, doc_count, deleted_count, delete_cursor,
    storage_path, checksum, storage_generation, id_manifest_path,
    id_manifest_checksum, id_manifest_generation, created_at, completed_at
  ) VALUES (
    v_lease.company_id, v_full_key, v_lease.data_type,
    'uploaded_not_deleted', v_lease.period_start, v_lease.period_end,
    v_lease.snapshot_at, v_lease.segment, p_doc_count, 0, 0,
    p_storage_path, p_checksum, p_storage_generation, p_id_manifest_path,
    p_id_manifest_checksum, p_id_manifest_generation,
    pg_catalog.clock_timestamp(), NULL
  )
  ON CONFLICT (company_id, archive_key, data_type) DO UPDATE
  SET status = 'uploaded_not_deleted'
  WHERE public.archive_runs.period_start = EXCLUDED.period_start
    AND public.archive_runs.period_end = EXCLUDED.period_end
    AND public.archive_runs.segment = EXCLUDED.segment
    AND public.archive_runs.doc_count = EXCLUDED.doc_count
    AND public.archive_runs.storage_path = EXCLUDED.storage_path
    AND public.archive_runs.checksum = EXCLUDED.checksum
    AND public.archive_runs.storage_generation = EXCLUDED.storage_generation
    AND public.archive_runs.id_manifest_path = EXCLUDED.id_manifest_path
    AND public.archive_runs.id_manifest_checksum = EXCLUDED.id_manifest_checksum
    AND public.archive_runs.id_manifest_generation = EXCLUDED.id_manifest_generation
  RETURNING public.archive_runs.* INTO v_run;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'ARCHIVE_UPLOAD_CONFLICT';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'runId', v_run.id,
    'docCount', v_run.doc_count,
    'deleteCursor', v_run.delete_cursor,
    'status', v_run.status
  );
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.list_api_company_archives_v2(
  p_internal_company_id UUID,
  p_data_type VARCHAR(32) DEFAULT NULL,
  p_period_start TIMESTAMPTZ DEFAULT NULL,
  p_period_end TIMESTAMPTZ DEFAULT NULL,
  p_page_size INTEGER DEFAULT 50,
  p_after_created_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL
) RETURNS TABLE(
  id UUID,
  archive_key VARCHAR,
  data_type VARCHAR,
  status public.archive_run_status,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  segment INTEGER,
  doc_count INTEGER,
  deleted_count INTEGER,
  checksum VARCHAR,
  storage_generation BIGINT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_page_size INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'COMPANY_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT private.app_has_archive_access(p_internal_company_id) THEN
    RAISE EXCEPTION 'COMPANY_ACCESS_DENIED';
  END IF;
  IF p_data_type IS NOT NULL AND p_data_type NOT IN ('jobs', 'documents') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_DATA_TYPE';
  END IF;
  IF (p_period_start IS NULL) <> (p_period_end IS NULL)
     OR (p_after_created_at IS NULL) <> (p_after_id IS NULL)
     OR (
       p_period_start IS NOT NULL
       AND (
         p_data_type IS NULL
         OR p_period_start <> (
           pg_catalog.date_trunc('month', p_period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
         )
         OR p_period_end <> p_period_start + INTERVAL '1 month'
       )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_LIST_FILTER_INVALID';
  END IF;

  RETURN QUERY
  SELECT
    run.id,
    run.archive_key,
    run.data_type,
    run.status,
    run.period_start,
    run.period_end,
    run.segment,
    run.doc_count,
    run.deleted_count,
    run.checksum,
    run.storage_generation,
    run.created_at,
    run.completed_at
  FROM public.archive_runs AS run
  WHERE run.company_id = p_internal_company_id
    AND (p_data_type IS NULL OR run.data_type = p_data_type)
    AND (p_period_start IS NULL OR run.period_start = p_period_start)
    AND (p_period_end IS NULL OR run.period_end = p_period_end)
    AND (
      p_after_created_at IS NULL
      OR (run.created_at, run.id) < (p_after_created_at, p_after_id)
    )
  ORDER BY run.created_at DESC, run.id DESC
  LIMIT v_page_size + 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.get_api_company_archive_run(
  p_internal_company_id UUID,
  p_archive_run_id UUID
) RETURNS TABLE(
  id UUID,
  archive_key VARCHAR,
  data_type VARCHAR,
  status public.archive_run_status,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  segment INTEGER,
  storage_path VARCHAR,
  checksum VARCHAR,
  storage_generation BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF private.app_auth_uid() IS NULL THEN
    RAISE EXCEPTION 'COMPANY_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT private.app_has_archive_access(p_internal_company_id) THEN
    RAISE EXCEPTION 'COMPANY_ACCESS_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    run.id,
    run.archive_key,
    run.data_type,
    run.status,
    run.period_start,
    run.period_end,
    run.segment,
    run.storage_path,
    run.checksum,
    run.storage_generation
  FROM public.archive_runs AS run
  WHERE run.company_id = p_internal_company_id
    AND run.id = p_archive_run_id
  LIMIT 1;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION private.list_api_company_archives_v2(
  UUID, VARCHAR(32), TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated, service_role,
       smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.get_api_company_archive_run(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role,
       smart_job_pdf, smart_job_email, smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.list_api_company_archives_v2(
  UUID, VARCHAR(32), TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TIMESTAMPTZ, UUID
) TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.get_api_company_archive_run(UUID, UUID)
  TO smart_job_api;
--> statement-breakpoint

INSERT INTO private.api_schema_metadata (component, schema_version)
VALUES ('cloudrun-api', 'batch6-2026-07-26')
ON CONFLICT (component) DO UPDATE
SET schema_version = EXCLUDED.schema_version,
    applied_at = pg_catalog.clock_timestamp();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.check_api_readiness(
  p_expected_schema_version TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COALESCE((
      SELECT metadata.schema_version = 'batch6-2026-07-26'
        AND p_expected_schema_version IN ('batch5-2026-07-21', 'batch6-2026-07-26')
      FROM private.api_schema_metadata AS metadata
      WHERE metadata.component = 'cloudrun-api'
    ), false)
    AND pg_catalog.to_regclass('public.jobs_search_text_trgm_idx') IS NOT NULL
    AND pg_catalog.to_regclass('public.documents_search_text_trgm_idx') IS NOT NULL
    AND pg_catalog.to_regclass('public.inventory_parts_normalized_name_trgm_idx') IS NOT NULL
    AND pg_catalog.to_regclass('public.archive_runs_company_type_period_segment_unique') IS NOT NULL
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.set_api_request_context(uuid,integer,integer,integer)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.create_api_job_with_details(uuid,public.job_status,text,text,text,text,integer,jsonb,jsonb,uuid,timestamp with time zone)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.list_api_company_archives_v2(uuid,character varying,timestamp with time zone,timestamp with time zone,integer,timestamp with time zone,uuid)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.get_api_company_archive_run(uuid,uuid)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.create_api_tax_invoice(uuid,jsonb,timestamp with time zone)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.create_api_contact_request(text,text,text,text,text)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.jobs', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.jobs', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.jobs', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.documents', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.documents', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.documents', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.inventory_parts', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.inventory_parts', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.inventory_parts', 'DELETE');
$$;
