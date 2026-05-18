-- Supabase hardening pass:
-- - move privileged RPC implementations out of the exposed public schema
-- - keep public RPC names as service-role-only compatibility wrappers
-- - point RLS policies at private helper functions
-- - add cost/performance helper indexes and cleanup RPCs

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA private FROM anon;
    REVOKE CREATE ON SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA private FROM authenticated;
    REVOKE CREATE ON SCHEMA public FROM authenticated;
    GRANT USAGE ON SCHEMA private TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA private TO service_role;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.app_auth_uid()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '');
$$;

ALTER FUNCTION public.app_is_dev() SET SCHEMA private;
ALTER FUNCTION public.app_has_company_access(uuid) SET SCHEMA private;
ALTER FUNCTION public.allocate_company_counter(UUID, TEXT) SET SCHEMA private;
ALTER FUNCTION public.allocate_system_counter(TEXT, INTEGER) SET SCHEMA private;
ALTER FUNCTION public.increment_rate_limit_bucket(VARCHAR, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ) SET SCHEMA private;
ALTER FUNCTION public.claim_tax_invoice_idempotency(UUID, TEXT, VARCHAR, VARCHAR, TIMESTAMPTZ) SET SCHEMA private;
ALTER FUNCTION public.apply_inventory_movement(UUID, UUID, NUMERIC, UUID, UUID, public.inventory_movement_type, UUID, UUID, UUID, TEXT, TIMESTAMPTZ) SET SCHEMA private;
ALTER FUNCTION public.apply_inventory_pick_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ) SET SCHEMA private;
ALTER FUNCTION public.apply_job_inventory_consumption_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ) SET SCHEMA private;
ALTER FUNCTION public.get_clients_page(UUID, INTEGER, INTEGER, UUID, TEXT) SET SCHEMA private;
ALTER FUNCTION public.get_company_inventory_page(UUID, INTEGER, INTEGER, UUID, TEXT) SET SCHEMA private;
ALTER FUNCTION public.get_member_inventory_page(UUID, TEXT, INTEGER, INTEGER, UUID, TEXT) SET SCHEMA private;
ALTER FUNCTION public.redeem_company_invite(VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR) SET SCHEMA private;
ALTER FUNCTION public.bump_company_sync_version(UUID, TEXT) SET SCHEMA private;

CREATE OR REPLACE FUNCTION private.app_is_dev()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users u
    WHERE u.id = private.app_auth_uid()
      AND COALESCE(u.system_role::text, '') = 'dev'
  );
$$;

CREATE OR REPLACE FUNCTION private.app_has_company_access(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_memberships m
    WHERE m.company_id = target_company_id
      AND m.user_id = private.app_auth_uid()
      AND m.status = 'active'
  )
  OR private.app_is_dev();
$$;

CREATE OR REPLACE FUNCTION public.app_is_dev()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.app_is_dev();
$$;

CREATE OR REPLACE FUNCTION public.app_has_company_access(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.app_has_company_access(target_company_id);
$$;

CREATE OR REPLACE FUNCTION public.allocate_company_counter(
  p_company_id UUID,
  p_counter_key TEXT
) RETURNS INTEGER
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.allocate_company_counter(p_company_id, p_counter_key);
$$;

CREATE OR REPLACE FUNCTION public.allocate_system_counter(
  p_counter_key TEXT,
  p_start_at INTEGER DEFAULT 1
) RETURNS INTEGER
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.allocate_system_counter(p_counter_key, p_start_at);
$$;

CREATE OR REPLACE FUNCTION public.increment_rate_limit_bucket(
  p_bucket_key VARCHAR(160),
  p_hashed_key VARCHAR(160),
  p_window_started_at TIMESTAMPTZ,
  p_expire_at TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.increment_rate_limit_bucket(p_bucket_key, p_hashed_key, p_window_started_at, p_expire_at);
$$;

CREATE OR REPLACE FUNCTION public.claim_tax_invoice_idempotency(
  p_company_id UUID,
  p_user_id TEXT,
  p_idempotency_hash VARCHAR(128),
  p_request_hash VARCHAR(128),
  p_expire_at TIMESTAMPTZ
) RETURNS TABLE (
  claim_status TEXT,
  result_payload JSONB
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT claim_status, result_payload
  FROM private.claim_tax_invoice_idempotency(
    p_company_id,
    p_user_id,
    p_idempotency_hash,
    p_request_hash,
    p_expire_at
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_inventory_movement(
  p_company_id UUID,
  p_part_id UUID,
  p_quantity NUMERIC,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_movement_type public.inventory_movement_type,
  p_created_by_membership_id UUID,
  p_job_id UUID DEFAULT NULL,
  p_document_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  movement_id UUID,
  from_quantity NUMERIC,
  to_quantity NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT movement_id, from_quantity, to_quantity
  FROM private.apply_inventory_movement(
    p_company_id,
    p_part_id,
    p_quantity,
    p_from_location_id,
    p_to_location_id,
    p_movement_type,
    p_created_by_membership_id,
    p_job_id,
    p_document_id,
    p_note,
    p_created_at
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_inventory_pick_batch(
  p_company_id UUID,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_created_by_membership_id UUID,
  p_picks JSONB,
  p_created_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT movement_id, part_id, part_no, quantity
  FROM private.apply_inventory_pick_batch(
    p_company_id,
    p_from_location_id,
    p_to_location_id,
    p_created_by_membership_id,
    p_picks,
    p_created_at
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_job_inventory_consumption_batch(
  p_company_id UUID,
  p_membership_id UUID,
  p_job_id UUID,
  p_created_by_membership_id UUID,
  p_parts JSONB,
  p_created_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT movement_id, part_id, part_no, quantity
  FROM private.apply_job_inventory_consumption_batch(
    p_company_id,
    p_membership_id,
    p_job_id,
    p_created_by_membership_id,
    p_parts,
    p_created_at
  );
$$;

CREATE OR REPLACE FUNCTION public.get_clients_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT NULL,
  p_after_client_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_clients_page(p_company_id, p_page_size, p_after_client_no, p_after_id, p_search);
$$;

CREATE OR REPLACE FUNCTION public.get_company_inventory_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT NULL,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_company_inventory_page(p_company_id, p_page_size, p_after_part_no, p_after_id, p_search);
$$;

CREATE OR REPLACE FUNCTION public.get_member_inventory_page(
  p_company_id UUID,
  p_target_uid TEXT,
  p_page_size INTEGER DEFAULT NULL,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_member_inventory_page(p_company_id, p_target_uid, p_page_size, p_after_part_no, p_after_id, p_search);
$$;

CREATE OR REPLACE FUNCTION public.redeem_company_invite(
  p_invite_code VARCHAR(80),
  p_uid TEXT,
  p_display_name VARCHAR(200) DEFAULT NULL,
  p_phone_number VARCHAR(40) DEFAULT NULL,
  p_email VARCHAR(320) DEFAULT NULL
) RETURNS TABLE (
  company_id UUID,
  public_company_id BIGINT,
  membership_id UUID,
  member_no INTEGER,
  role public.membership_role,
  display_name VARCHAR(200),
  joined_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT company_id, public_company_id, membership_id, member_no, role, display_name, joined_at
  FROM private.redeem_company_invite(p_invite_code, p_uid, p_display_name, p_phone_number, p_email);
$$;

CREATE OR REPLACE FUNCTION public.bump_company_sync_version(
  p_company_id UUID,
  p_field TEXT
) RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.bump_company_sync_version(p_company_id, p_field);
$$;

CREATE OR REPLACE FUNCTION private.get_inventory_counts(
  p_company_id UUID,
  p_membership_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH company_count AS (
    SELECT COUNT(*)::integer AS row_count
    FROM public.inventory_parts p
    WHERE p.company_id = p_company_id
      AND p.archived_at IS NULL
  ),
  member_location AS (
    SELECT loc.id
    FROM public.inventory_locations loc
    WHERE loc.company_id = p_company_id
      AND loc.location_type = 'member'
      AND loc.membership_id = p_membership_id
    LIMIT 1
  ),
  member_count AS (
    SELECT COUNT(*)::integer AS row_count
    FROM public.inventory_balances b
    INNER JOIN member_location loc ON loc.id = b.location_id
    INNER JOIN public.inventory_parts p
      ON p.id = b.part_id
     AND p.company_id = p_company_id
     AND p.archived_at IS NULL
  )
  SELECT jsonb_build_object(
    'inventoryParts', COALESCE((SELECT row_count FROM member_count), 0),
    'companyInventoryParts', COALESCE((SELECT row_count FROM company_count), 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_inventory_counts(
  p_company_id UUID,
  p_membership_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_inventory_counts(p_company_id, p_membership_id);
$$;

CREATE OR REPLACE FUNCTION private.cleanup_expired_operational_rows(
  p_now TIMESTAMPTZ DEFAULT NOW()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rate_limit_deleted INTEGER := 0;
  v_idempotency_deleted INTEGER := 0;
  v_document_tasks_deleted INTEGER := 0;
  v_notifications_deleted INTEGER := 0;
  v_contact_requests_deleted INTEGER := 0;
BEGIN
  DELETE FROM public.rate_limit_buckets
  WHERE expire_at < p_now;
  GET DIAGNOSTICS v_rate_limit_deleted = ROW_COUNT;

  DELETE FROM public.tax_invoice_idempotency
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now
    AND status <> 'approved';
  GET DIAGNOSTICS v_idempotency_deleted = ROW_COUNT;

  DELETE FROM public.document_tasks
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now
    AND status IN ('completed', 'failed');
  GET DIAGNOSTICS v_document_tasks_deleted = ROW_COUNT;

  DELETE FROM public.notification_deliveries
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now;
  GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;

  DELETE FROM public.contact_requests
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now;
  GET DIAGNOSTICS v_contact_requests_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'rateLimitBuckets', v_rate_limit_deleted,
    'taxInvoiceIdempotency', v_idempotency_deleted,
    'documentTasks', v_document_tasks_deleted,
    'notificationDeliveries', v_notifications_deleted,
    'contactRequests', v_contact_requests_deleted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_operational_rows(
  p_now TIMESTAMPTZ DEFAULT NOW()
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.cleanup_expired_operational_rows(p_now);
$$;

CREATE INDEX IF NOT EXISTS documents_company_visible_created_cursor_idx
  ON public.documents (company_id, created_at DESC, id DESC)
  WHERE document_type <> 305 OR tax_authority_status = 'approved';

CREATE INDEX IF NOT EXISTS documents_company_visible_document_date_cursor_idx
  ON public.documents (company_id, document_date DESC, id DESC)
  WHERE document_date IS NOT NULL
    AND (document_type <> 305 OR tax_authority_status = 'approved');

CREATE INDEX IF NOT EXISTS documents_company_visible_type_document_date_cursor_idx
  ON public.documents (company_id, document_type, document_date DESC, id DESC)
  WHERE document_date IS NOT NULL
    AND (document_type <> 305 OR tax_authority_status = 'approved');

CREATE INDEX IF NOT EXISTS tax_invoice_reservations_idempotency_lookup_idx
  ON public.tax_invoice_reservations (
    company_id,
    status,
    ((status_payload ->> 'idempotencyKey')),
    created_at DESC
  );

ALTER POLICY company_memberships_company_read_policy
  ON public.company_memberships
  USING (
    (SELECT private.app_is_dev())
    OR user_id = private.app_auth_uid()
    OR EXISTS (
      SELECT 1
      FROM public.company_memberships requester
      WHERE requester.company_id = company_memberships.company_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND requester.role = 'manager'
    )
  );

ALTER POLICY company_profiles_company_read_policy
  ON public.company_profiles
  USING (private.app_has_company_access(company_id));

ALTER POLICY company_subscriptions_company_read_policy
  ON public.company_subscriptions
  USING (private.app_has_company_access(company_id));

ALTER POLICY company_sync_state_company_read_policy
  ON public.company_sync_state
  USING (private.app_has_company_access(company_id));

ALTER POLICY clients_company_read_policy
  ON public.clients
  USING (private.app_has_company_access(company_id));

ALTER POLICY jobs_company_read_policy
  ON public.jobs
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.company_memberships requester
      INNER JOIN public.companies c ON c.id = requester.company_id
      WHERE requester.company_id = jobs.company_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND (
          requester.role = 'manager'
          OR (
            requester.role = 'user'
            AND (
              c.account_type = 'solo'
              OR jobs.assigned_membership_id = requester.id
            )
          )
          OR (
            requester.role = 'worker'
            AND jobs.assigned_membership_id = requester.id
          )
        )
    )
  );

ALTER POLICY job_attachments_company_read_policy
  ON public.job_attachments
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.jobs j
      INNER JOIN public.company_memberships requester
        ON requester.company_id = j.company_id
      INNER JOIN public.companies c ON c.id = requester.company_id
      WHERE j.id = job_attachments.job_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND (
          requester.role = 'manager'
          OR (
            requester.role = 'user'
            AND (
              c.account_type = 'solo'
              OR j.assigned_membership_id = requester.id
            )
          )
          OR (
            requester.role = 'worker'
            AND j.assigned_membership_id = requester.id
          )
        )
    )
  );

ALTER POLICY job_part_usages_company_read_policy
  ON public.job_part_usages
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.jobs j
      INNER JOIN public.company_memberships requester
        ON requester.company_id = j.company_id
      INNER JOIN public.companies c ON c.id = requester.company_id
      WHERE j.id = job_part_usages.job_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND (
          requester.role = 'manager'
          OR (
            requester.role = 'user'
            AND (
              c.account_type = 'solo'
              OR j.assigned_membership_id = requester.id
            )
          )
          OR (
            requester.role = 'worker'
            AND j.assigned_membership_id = requester.id
          )
        )
    )
  );

ALTER POLICY inventory_locations_company_read_policy
  ON public.inventory_locations
  USING (private.app_has_company_access(company_id));

ALTER POLICY inventory_parts_company_read_policy
  ON public.inventory_parts
  USING (private.app_has_company_access(company_id));

ALTER POLICY inventory_balances_company_read_policy
  ON public.inventory_balances
  USING (
    EXISTS (
      SELECT 1
      FROM public.inventory_locations loc
      WHERE loc.id = inventory_balances.location_id
        AND private.app_has_company_access(loc.company_id)
    )
  );

ALTER POLICY inventory_movements_company_read_policy
  ON public.inventory_movements
  USING (private.app_has_company_access(company_id));

ALTER POLICY documents_company_read_policy
  ON public.documents
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.company_memberships requester
      WHERE requester.company_id = documents.company_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND requester.role IN ('manager', 'user', 'basic')
        AND NOT (
          documents.document_type = 305
          AND documents.tax_authority_status <> 'approved'
        )
    )
  );

ALTER POLICY document_items_company_read_policy
  ON public.document_items
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.documents d
      INNER JOIN public.company_memberships requester
        ON requester.company_id = d.company_id
      WHERE d.id = document_items.document_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND requester.role IN ('manager', 'user', 'basic')
        AND NOT (
          d.document_type = 305
          AND d.tax_authority_status <> 'approved'
        )
    )
  );

ALTER POLICY document_job_links_company_read_policy
  ON public.document_job_links
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.documents d
      INNER JOIN public.company_memberships requester
        ON requester.company_id = d.company_id
      WHERE d.id = document_job_links.document_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND requester.role IN ('manager', 'user', 'basic')
        AND NOT (
          d.document_type = 305
          AND d.tax_authority_status <> 'approved'
        )
    )
  );

ALTER POLICY proposal_usage_company_read_policy
  ON public.proposal_usage
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.documents d
      INNER JOIN public.company_memberships requester
        ON requester.company_id = d.company_id
      WHERE d.id = proposal_usage.proposal_document_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND requester.role IN ('manager', 'user', 'basic')
        AND NOT (
          d.document_type = 305
          AND d.tax_authority_status <> 'approved'
        )
    )
  );

ALTER POLICY company_invites_company_read_policy
  ON public.company_invites
  USING (private.app_has_company_access(company_id));

ALTER POLICY document_tasks_company_read_policy
  ON public.document_tasks
  USING (private.app_has_company_access(company_id) OR user_id = private.app_auth_uid());

ALTER POLICY support_conversations_owner_read_policy
  ON public.support_conversations
  USING ((SELECT private.app_is_dev()) OR user_id = private.app_auth_uid());

ALTER POLICY support_messages_owner_read_policy
  ON public.support_messages
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.support_conversations c
      WHERE c.id = support_messages.conversation_id
        AND c.user_id = private.app_auth_uid()
    )
  );

DO $$
DECLARE
  private_signature TEXT;
  public_signature TEXT;
  has_anon BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_authenticated BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  has_service_role BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
BEGIN
  FOREACH private_signature IN ARRAY ARRAY[
    'private.app_auth_uid()',
    'private.app_is_dev()',
    'private.app_has_company_access(UUID)'
  ] LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || private_signature || ' FROM PUBLIC';
    IF has_authenticated THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || private_signature || ' TO authenticated';
    END IF;
    IF has_service_role THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || private_signature || ' TO service_role';
    END IF;
  END LOOP;

  FOREACH private_signature IN ARRAY ARRAY[
    'private.allocate_company_counter(UUID, TEXT)',
    'private.allocate_system_counter(TEXT, INTEGER)',
    'private.increment_rate_limit_bucket(VARCHAR, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ)',
    'private.claim_tax_invoice_idempotency(UUID, TEXT, VARCHAR, VARCHAR, TIMESTAMPTZ)',
    'private.apply_inventory_movement(UUID, UUID, NUMERIC, UUID, UUID, public.inventory_movement_type, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)',
    'private.apply_inventory_pick_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)',
    'private.apply_job_inventory_consumption_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)',
    'private.get_clients_page(UUID, INTEGER, INTEGER, UUID, TEXT)',
    'private.get_company_inventory_page(UUID, INTEGER, INTEGER, UUID, TEXT)',
    'private.get_member_inventory_page(UUID, TEXT, INTEGER, INTEGER, UUID, TEXT)',
    'private.get_inventory_counts(UUID, UUID)',
    'private.redeem_company_invite(VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR)',
    'private.bump_company_sync_version(UUID, TEXT)',
    'private.cleanup_expired_operational_rows(TIMESTAMPTZ)'
  ] LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || private_signature || ' FROM PUBLIC';
    IF has_anon THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || private_signature || ' FROM anon';
    END IF;
    IF has_authenticated THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || private_signature || ' FROM authenticated';
    END IF;
    IF has_service_role THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || private_signature || ' TO service_role';
    END IF;
  END LOOP;

  FOREACH public_signature IN ARRAY ARRAY[
    'public.app_is_dev()',
    'public.app_has_company_access(UUID)',
    'public.allocate_company_counter(UUID, TEXT)',
    'public.allocate_system_counter(TEXT, INTEGER)',
    'public.increment_rate_limit_bucket(VARCHAR, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ)',
    'public.claim_tax_invoice_idempotency(UUID, TEXT, VARCHAR, VARCHAR, TIMESTAMPTZ)',
    'public.apply_inventory_movement(UUID, UUID, NUMERIC, UUID, UUID, public.inventory_movement_type, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)',
    'public.apply_inventory_pick_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)',
    'public.apply_job_inventory_consumption_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)',
    'public.get_clients_page(UUID, INTEGER, INTEGER, UUID, TEXT)',
    'public.get_company_inventory_page(UUID, INTEGER, INTEGER, UUID, TEXT)',
    'public.get_member_inventory_page(UUID, TEXT, INTEGER, INTEGER, UUID, TEXT)',
    'public.get_inventory_counts(UUID, UUID)',
    'public.redeem_company_invite(VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR)',
    'public.bump_company_sync_version(UUID, TEXT)',
    'public.cleanup_expired_operational_rows(TIMESTAMPTZ)'
  ] LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || public_signature || ' FROM PUBLIC';
    IF has_anon THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || public_signature || ' FROM anon';
    END IF;
    IF has_authenticated THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || public_signature || ' FROM authenticated';
    END IF;
    IF has_service_role THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || public_signature || ' TO service_role';
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
