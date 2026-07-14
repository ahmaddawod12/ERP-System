-- Secure, versioned company-member mutations for the Node API.
--
-- New members join through the invitation flow. This surface deliberately
-- supports only membership-scoped edits and guarded disabling; it never creates
-- Auth users, accepts passwords, or hard-deletes historical membership rows.

ALTER TABLE public.company_memberships
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT company_memberships_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

CREATE INDEX company_memberships_company_member_version_idx
  ON public.company_memberships (company_id, member_no, entity_version);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.increment_company_membership_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER company_memberships_increment_entity_version
BEFORE UPDATE ON public.company_memberships
FOR EACH ROW
EXECUTE FUNCTION private.increment_company_membership_entity_version();--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.require_api_worker_mutation_access(
  p_company_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_is_dev BOOLEAN := false;
  v_team_enabled BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_company_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.companies AS company
    WHERE company.id = p_company_id
      AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'WORKER_COMPANY_NOT_FOUND';
  END IF;

  SELECT private.app_is_dev() INTO v_is_dev;
  IF NOT v_is_dev AND NOT EXISTS (
    SELECT 1
    FROM public.company_memberships AS requester
    WHERE requester.company_id = p_company_id
      AND requester.user_id = v_uid
      AND requester.status = 'active'
      AND requester.role = 'manager'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WORKER_MANAGER_REQUIRED';
  END IF;

  SELECT
    subscription.status IN ('active', 'trial')
    AND (
      subscription.expires_at IS NULL
      OR subscription.expires_at > pg_catalog.statement_timestamp()
    )
    AND CASE
      WHEN pg_catalog.jsonb_typeof(subscription.enabled_modules -> 'team') = 'boolean'
        THEN (subscription.enabled_modules ->> 'team')::BOOLEAN
      WHEN pg_catalog.jsonb_typeof(subscription.enabled_modules -> 'workers') = 'boolean'
        THEN (subscription.enabled_modules ->> 'workers')::BOOLEAN
      ELSE subscription.tier IN ('Team', 'Enterprise')
    END
  INTO v_team_enabled
  FROM public.company_subscriptions AS subscription
  WHERE subscription.company_id = p_company_id
  LIMIT 1;

  IF NOT v_is_dev AND NOT COALESCE(v_team_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WORKERS_MODULE_DISABLED';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.validate_api_worker_patch(
  p_patch JSONB
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_display_name TEXT;
  v_phone_number TEXT;
BEGIN
  IF p_patch IS NULL
     OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
     OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_PATCH_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS patch_key(key)
    WHERE patch_key.key NOT IN ('displayName', 'phoneNumber', 'role', 'status')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_PATCH_FIELDS_INVALID';
  END IF;

  IF p_patch ? 'displayName' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'displayName') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_DISPLAY_NAME_INVALID';
    END IF;
    v_display_name := p_patch ->> 'displayName';
    IF v_display_name IS NOT NULL AND (
      pg_catalog.btrim(v_display_name) = ''
      OR pg_catalog.char_length(pg_catalog.btrim(v_display_name)) > 200
      OR v_display_name ~ '[[:cntrl:]]'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_DISPLAY_NAME_INVALID';
    END IF;
  END IF;

  IF p_patch ? 'phoneNumber' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'phoneNumber') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_PHONE_INVALID';
    END IF;
    v_phone_number := p_patch ->> 'phoneNumber';
    IF v_phone_number IS NOT NULL AND (
      pg_catalog.btrim(v_phone_number) = ''
      OR pg_catalog.char_length(pg_catalog.btrim(v_phone_number)) > 40
      OR v_phone_number ~ '[[:cntrl:]]'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_PHONE_INVALID';
    END IF;
  END IF;

  IF p_patch ? 'role' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'role') <> 'string'
    OR p_patch ->> 'role' NOT IN ('worker', 'user', 'basic')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_ROLE_INVALID';
  END IF;
  IF p_patch ? 'status' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'status') <> 'string'
    OR p_patch ->> 'status' NOT IN ('active', 'disabled')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_STATUS_INVALID';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.assert_api_worker_can_be_disabled(
  p_company_id UUID,
  p_membership_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.jobs AS job
    WHERE job.company_id = p_company_id
      AND job.assigned_membership_id = p_membership_id
      AND job.status IN ('pending', 'waiting')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'WORKER_HAS_ACTIVE_JOBS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_locations AS location
    INNER JOIN public.inventory_balances AS balance
      ON balance.location_id = location.id
     AND balance.quantity_on_hand > 0
    WHERE location.company_id = p_company_id
      AND location.membership_id = p_membership_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'WORKER_HAS_INVENTORY';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.update_api_worker_membership(
  p_company_id UUID,
  p_member_no INTEGER,
  p_expected_entity_version BIGINT,
  p_patch JSONB,
  p_updated_at TIMESTAMPTZ
) RETURNS TABLE (
  member_no INTEGER,
  role TEXT,
  status TEXT,
  display_name TEXT,
  email TEXT,
  phone_number TEXT,
  entity_version BIGINT,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership public.company_memberships%ROWTYPE;
  v_email TEXT;
  v_updated_at TIMESTAMPTZ := COALESCE(p_updated_at, pg_catalog.clock_timestamp());
BEGIN
  PERFORM private.require_api_worker_mutation_access(p_company_id);
  PERFORM private.validate_api_worker_patch(p_patch);
  IF p_member_no IS NULL OR p_member_no < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_MEMBER_NO_INVALID';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_VERSION_INVALID';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.member_no = p_member_no
    AND membership.role IN ('worker', 'user', 'basic')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'WORKER_NOT_FOUND';
  END IF;
  IF v_membership.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'WORKER_ENTITY_VERSION_CONFLICT';
  END IF;
  IF p_patch ->> 'status' = 'disabled' AND v_membership.status <> 'disabled' THEN
    PERFORM private.assert_api_worker_can_be_disabled(p_company_id, v_membership.id);
  END IF;

  UPDATE public.company_memberships AS membership
  SET
    display_name = CASE WHEN p_patch ? 'displayName'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'displayName'), '')
      ELSE membership.display_name END,
    phone_number = CASE WHEN p_patch ? 'phoneNumber'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'phoneNumber'), '')
      ELSE membership.phone_number END,
    role = CASE WHEN p_patch ? 'role'
      THEN (p_patch ->> 'role')::public.membership_role
      ELSE membership.role END,
    status = CASE WHEN p_patch ? 'status'
      THEN (p_patch ->> 'status')::public.membership_status
      ELSE membership.status END,
    updated_at = v_updated_at
  WHERE membership.id = v_membership.id
  RETURNING membership.* INTO v_membership;

  SELECT app_user.email
  INTO v_email
  FROM public.app_users AS app_user
  WHERE app_user.id = v_membership.user_id;

  PERFORM private.bump_company_sync_version(p_company_id, 'workers_version');
  RETURN QUERY SELECT
    v_membership.member_no,
    v_membership.role::TEXT,
    v_membership.status::TEXT,
    v_membership.display_name::TEXT,
    v_email,
    v_membership.phone_number::TEXT,
    v_membership.entity_version,
    v_membership.joined_at,
    v_membership.created_at,
    v_membership.updated_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.disable_api_worker_membership(
  p_company_id UUID,
  p_member_no INTEGER,
  p_expected_entity_version BIGINT,
  p_disabled_at TIMESTAMPTZ
) RETURNS TABLE (
  member_no INTEGER,
  role TEXT,
  status TEXT,
  display_name TEXT,
  email TEXT,
  phone_number TEXT,
  entity_version BIGINT,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT *
  FROM private.update_api_worker_membership(
    p_company_id,
    p_member_no,
    p_expected_entity_version,
    '{"status":"disabled"}'::JSONB,
    p_disabled_at
  );
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.increment_company_membership_entity_version()
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.require_api_worker_mutation_access(UUID)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.validate_api_worker_patch(JSONB)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.assert_api_worker_can_be_disabled(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.update_api_worker_membership(UUID, INTEGER, BIGINT, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.disable_api_worker_membership(UUID, INTEGER, BIGINT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.update_api_worker_membership(UUID, INTEGER, BIGINT, JSONB, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.disable_api_worker_membership(UUID, INTEGER, BIGINT, TIMESTAMPTZ)
TO smart_job_api;
