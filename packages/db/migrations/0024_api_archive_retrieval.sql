-- Archive retrieval: RLS policies, API role grants, and a list RPC.
--
-- The archive_runs table existed in the baseline but had RLS enabled with no
-- policies and no grants to smart_job_api, making it unreadable through the
-- API role. This migration adds the missing policies, grants, and a bounded
-- list function so company members can discover their monthly archives.

CREATE OR REPLACE FUNCTION private.app_has_archive_access(
  p_company_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.app_is_dev()
    OR EXISTS (
      SELECT 1
      FROM public.company_memberships membership
      WHERE membership.company_id = p_company_id
        AND membership.user_id = private.app_auth_uid()
        AND membership.status = 'active'
    )
    OR (
      EXISTS (
        SELECT 1
        FROM public.company_memberships membership
        WHERE membership.company_id = p_company_id
          AND membership.user_id = private.app_auth_uid()
          AND membership.status = 'active'
      )
      AND EXISTS (
        SELECT 1
        FROM public.company_subscriptions subscription
        WHERE subscription.company_id = p_company_id
      )
    )
$$;--> statement-breakpoint

CREATE POLICY archive_runs_company_read_policy
  ON public.archive_runs
  FOR SELECT
  USING (private.app_has_archive_access(company_id));--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.list_api_company_archives(
  p_internal_company_id UUID,
  p_data_type VARCHAR(32) DEFAULT NULL,
  p_page_size INTEGER DEFAULT 50,
  p_after_created_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL
) RETURNS TABLE(
  id UUID,
  archive_key VARCHAR,
  data_type VARCHAR,
  status archive_run_status,
  doc_count INTEGER,
  deleted_count INTEGER,
  storage_path VARCHAR,
  checksum VARCHAR,
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
  v_has_access BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'COMPANY_MEMBERSHIP_REQUIRED';
  END IF;

  SELECT private.app_has_archive_access(p_internal_company_id) INTO v_has_access;
  IF NOT v_has_access THEN
    RAISE EXCEPTION 'COMPANY_ACCESS_DENIED';
  END IF;

  IF p_data_type IS NOT NULL AND p_data_type NOT IN ('jobs', 'documents') THEN
    RAISE EXCEPTION 'INVALID_DATA_TYPE';
  END IF;

  RETURN QUERY
  SELECT
    ar.id,
    ar.archive_key,
    ar.data_type,
    ar.status,
    ar.doc_count,
    ar.deleted_count,
    ar.storage_path,
    ar.checksum,
    ar.created_at,
    ar.completed_at
  FROM public.archive_runs ar
  WHERE ar.company_id = p_internal_company_id
    AND (p_data_type IS NULL OR ar.data_type = p_data_type)
    AND (
      p_after_created_at IS NULL
      OR (ar.created_at, ar.id) < (p_after_created_at, COALESCE(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  ORDER BY ar.created_at DESC, ar.id DESC
  LIMIT v_page_size + 1;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.app_has_archive_access(UUID)
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.list_api_company_archives(UUID, VARCHAR(32), INTEGER, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.list_api_company_archives(UUID, VARCHAR(32), INTEGER, TIMESTAMPTZ, UUID)
  TO smart_job_api;--> statement-breakpoint

GRANT SELECT ON public.archive_runs TO smart_job_api;
