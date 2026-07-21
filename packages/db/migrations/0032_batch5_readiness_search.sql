CREATE SCHEMA IF NOT EXISTS extensions;--> statement-breakpoint

DO $$
DECLARE
  v_extension_schema NAME;
BEGIN
  SELECT namespace.nspname
    INTO v_extension_schema
  FROM pg_catalog.pg_extension extension
  INNER JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pg_trgm';

  IF v_extension_schema IS NULL THEN
    CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
  ELSIF v_extension_schema <> 'extensions' THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END;
$$;--> statement-breakpoint

ALTER TABLE public.documents ADD COLUMN search_text text GENERATED ALWAYS AS (
  pg_catalog.lower(
    document_code || ' ' ||
    COALESCE(client_name_snapshot, '') || ' ' ||
    COALESCE(client_phone_snapshot, '') || ' ' ||
    COALESCE(client_city_snapshot, '') || ' ' ||
    COALESCE(client_vat_snapshot, '')
  )
) STORED;--> statement-breakpoint

ALTER TABLE public.inventory_parts ADD COLUMN normalized_name text
  GENERATED ALWAYS AS (pg_catalog.lower(name)) STORED;--> statement-breakpoint

ALTER TABLE public.jobs ADD COLUMN search_text text GENERATED ALWAYS AS (
  pg_catalog.lower(
    COALESCE(title, '') || ' ' ||
    COALESCE(description, '') || ' ' ||
    COALESCE(location, '') || ' ' ||
    COALESCE(address, '') || ' ' ||
    COALESCE(client_name_snapshot, '') || ' ' ||
    COALESCE(client_phone_snapshot, '') || ' ' ||
    COALESCE(assigned_member_name_snapshot, '') || ' ' ||
    COALESCE(created_by_name_snapshot, '')
  )
) STORED;--> statement-breakpoint

CREATE INDEX documents_search_text_trgm_idx
  ON public.documents USING gin (search_text extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX inventory_parts_normalized_name_trgm_idx
  ON public.inventory_parts USING gin (normalized_name extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX jobs_search_text_trgm_idx
  ON public.jobs USING gin (search_text extensions.gin_trgm_ops);--> statement-breakpoint

CREATE TABLE private.api_schema_metadata (
  component TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT api_schema_metadata_component_nonempty_check
    CHECK (pg_catalog.btrim(component) <> ''),
  CONSTRAINT api_schema_metadata_version_nonempty_check
    CHECK (pg_catalog.btrim(schema_version) <> '')
);--> statement-breakpoint

INSERT INTO private.api_schema_metadata (component, schema_version)
VALUES ('cloudrun-api', 'batch5-2026-07-21')
ON CONFLICT (component) DO UPDATE
SET schema_version = EXCLUDED.schema_version,
    applied_at = pg_catalog.clock_timestamp();--> statement-breakpoint

REVOKE ALL ON TABLE private.api_schema_metadata
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
       smart_job_pdf, smart_job_email, smart_job_archiver;--> statement-breakpoint

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
      SELECT metadata.schema_version = p_expected_schema_version
      FROM private.api_schema_metadata metadata
      WHERE metadata.component = 'cloudrun-api'
    ), false)
    AND pg_catalog.to_regclass('public.jobs_search_text_trgm_idx') IS NOT NULL
    AND pg_catalog.to_regclass('public.documents_search_text_trgm_idx') IS NOT NULL
    AND pg_catalog.to_regclass('public.inventory_parts_normalized_name_trgm_idx') IS NOT NULL
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
      'private.list_api_company_archives(uuid,character varying,integer,timestamp with time zone,uuid)',
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
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.check_api_readiness(TEXT)
  FROM PUBLIC, anon, authenticated, service_role,
       smart_job_pdf, smart_job_email, smart_job_archiver;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.check_api_readiness(TEXT) TO smart_job_api;
