-- Secure, versioned job metadata, acceptance, and deletion mutations for the
-- Node API. Job completion with field details remains owned by
-- private.complete_job_with_details(...).

CREATE OR REPLACE FUNCTION private.require_api_job_mutation_actor(
  p_company_id UUID
) RETURNS TABLE (
  actor_user_id TEXT,
  actor_membership_id UUID,
  actor_role TEXT,
  actor_is_dev BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_membership public.company_memberships%ROWTYPE;
  v_is_dev BOOLEAN := false;
  v_jobs_enabled BOOLEAN := false;
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
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'JOB_COMPANY_NOT_FOUND';
  END IF;

  SELECT private.app_is_dev() INTO v_is_dev;
  SELECT membership.*
  INTO v_membership
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid
    AND membership.status = 'active'
  ORDER BY membership.joined_at, membership.created_at, membership.id
  LIMIT 1;

  IF v_membership.id IS NULL AND NOT v_is_dev THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'COMPANY_MEMBERSHIP_REQUIRED';
  END IF;

  SELECT entitlement.jobs_enabled
  INTO v_jobs_enabled
  FROM private.get_company_module_entitlements(p_company_id) AS entitlement;
  IF NOT COALESCE(v_jobs_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOBS_MODULE_DISABLED';
  END IF;

  actor_user_id := v_uid;
  actor_membership_id := v_membership.id;
  actor_role := CASE WHEN v_is_dev THEN 'dev' ELSE v_membership.role::TEXT END;
  actor_is_dev := v_is_dev;
  IF actor_role NOT IN ('manager', 'worker', 'user', 'dev') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOB_MUTATION_FORBIDDEN';
  END IF;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.validate_api_job_patch(
  p_patch JSONB
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_patch IS NULL
     OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
     OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PATCH_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS patch_key(key)
    WHERE patch_key.key NOT IN (
      'title',
      'description',
      'notes',
      'location',
      'address',
      'category',
      'priority',
      'dueAt',
      'clientId',
      'assigneeMemberNo',
      'status'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PATCH_FIELDS_INVALID';
  END IF;

  IF p_patch ? 'title' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'title') <> 'string'
    OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'title')) NOT BETWEEN 1 AND 200
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_TITLE_INVALID';
  END IF;
  IF p_patch ? 'description' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'description') NOT IN ('string', 'null')
    OR pg_catalog.char_length(p_patch ->> 'description') > 10000
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DESCRIPTION_INVALID';
  END IF;
  IF p_patch ? 'notes' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'notes') NOT IN ('string', 'null')
    OR pg_catalog.char_length(p_patch ->> 'notes') > 10000
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_NOTES_INVALID';
  END IF;
  IF p_patch ? 'location' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'location') NOT IN ('string', 'null')
    OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'location')) > 240
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_LOCATION_INVALID';
  END IF;
  IF p_patch ? 'address' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'address') NOT IN ('string', 'null')
    OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'address')) > 500
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_ADDRESS_INVALID';
  END IF;
  IF p_patch ? 'category' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'category') NOT IN ('string', 'null')
    OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'category')) > 120
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_CATEGORY_INVALID';
  END IF;
  IF p_patch ? 'priority' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'priority') NOT IN ('string', 'null')
    OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'priority')) > 40
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PRIORITY_INVALID';
  END IF;
  IF p_patch ? 'dueAt' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'dueAt') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DUE_AT_INVALID';
    END IF;
    IF pg_catalog.jsonb_typeof(p_patch -> 'dueAt') = 'string' THEN
      BEGIN
        PERFORM (p_patch ->> 'dueAt')::TIMESTAMPTZ;
      EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DUE_AT_INVALID';
      END;
    END IF;
  END IF;
  IF p_patch ? 'clientId' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'clientId') NOT IN ('string', 'null')
    OR (
      pg_catalog.jsonb_typeof(p_patch -> 'clientId') = 'string'
      AND (p_patch ->> 'clientId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_ID_INVALID';
  END IF;
  IF p_patch ? 'assigneeMemberNo' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'assigneeMemberNo') NOT IN ('number', 'null')
    OR (
      pg_catalog.jsonb_typeof(p_patch -> 'assigneeMemberNo') = 'number'
      AND (
        (p_patch ->> 'assigneeMemberNo') !~ '^[1-9][0-9]*$'
        OR (p_patch ->> 'assigneeMemberNo')::NUMERIC > 2147483647
      )
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ASSIGNEE_MEMBER_NO_INVALID';
  END IF;
  IF p_patch ? 'status' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'status') <> 'string'
    OR p_patch ->> 'status' NOT IN ('pending', 'waiting', 'denied')
  ) THEN
    IF p_patch ->> 'status' = 'finished' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DIRECT_FINISH_FORBIDDEN';
    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_STATUS_INVALID';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.get_api_job_mutation_result(
  p_company_id UUID,
  p_job_id UUID
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status TEXT,
  title TEXT,
  description TEXT,
  notes TEXT,
  location TEXT,
  address TEXT,
  category TEXT,
  priority TEXT,
  due_at TIMESTAMPTZ,
  client_id UUID,
  client_name TEXT,
  client_phone TEXT,
  assignee_member_no INTEGER,
  assignee_display_name TEXT,
  creator_uid UUID,
  creator_member_no INTEGER,
  creator_display_name TEXT,
  is_certificate BOOLEAN,
  meta JSONB,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    job.id,
    job.job_no,
    job.status::TEXT,
    COALESCE(job.title, ''),
    COALESCE(job.description, ''),
    job.notes,
    job.location,
    job.address,
    job.category,
    job.priority,
    job.due_at,
    job.client_id,
    job.client_name_snapshot,
    job.client_phone_snapshot,
    assignee.member_no,
    COALESCE(
      NULLIF(pg_catalog.btrim(assignee.display_name), ''),
      NULLIF(pg_catalog.btrim(assignee_user.display_name), ''),
      job.assigned_member_name_snapshot
    ),
    CASE
      WHEN creator.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN creator.user_id::UUID
      ELSE NULL
    END,
    creator.member_no,
    COALESCE(
      NULLIF(pg_catalog.btrim(creator.display_name), ''),
      NULLIF(pg_catalog.btrim(creator_user.display_name), ''),
      job.created_by_name_snapshot
    ),
    job.is_cert,
    job.meta,
    job.entity_version,
    job.created_at,
    job.updated_at,
    job.finished_at,
    job.denied_at
  FROM public.jobs AS job
  LEFT JOIN public.company_memberships AS assignee
    ON assignee.id = job.assigned_membership_id
   AND assignee.company_id = job.company_id
  LEFT JOIN public.app_users AS assignee_user
    ON assignee_user.id = assignee.user_id
  LEFT JOIN public.company_memberships AS creator
    ON creator.id = job.created_by_membership_id
   AND creator.company_id = job.company_id
  LEFT JOIN public.app_users AS creator_user
    ON creator_user.id = creator.user_id
  WHERE job.company_id = p_company_id
    AND job.id = p_job_id;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.update_api_job(
  p_company_id UUID,
  p_job_id UUID,
  p_expected_entity_version BIGINT,
  p_patch JSONB,
  p_updated_at TIMESTAMPTZ
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status TEXT,
  title TEXT,
  description TEXT,
  notes TEXT,
  location TEXT,
  address TEXT,
  category TEXT,
  priority TEXT,
  due_at TIMESTAMPTZ,
  client_id UUID,
  client_name TEXT,
  client_phone TEXT,
  assignee_member_no INTEGER,
  assignee_display_name TEXT,
  creator_uid UUID,
  creator_member_no INTEGER,
  creator_display_name TEXT,
  is_certificate BOOLEAN,
  meta JSONB,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_assignee public.company_memberships%ROWTYPE;
  v_actor_user_id TEXT;
  v_actor_membership_id UUID;
  v_actor_role TEXT;
  v_updated_at TIMESTAMPTZ := COALESCE(p_updated_at, pg_catalog.clock_timestamp());
BEGIN
  IF p_company_id IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_AND_JOB_REQUIRED';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ENTITY_VERSION_INVALID';
  END IF;
  PERFORM private.validate_api_job_patch(p_patch);

  SELECT
    actor.actor_user_id,
    actor.actor_membership_id,
    actor.actor_role
  INTO v_actor_user_id, v_actor_membership_id, v_actor_role
  FROM private.require_api_job_mutation_actor(p_company_id) AS actor;

  SELECT job.*
  INTO v_job
  FROM public.jobs AS job
  WHERE job.company_id = p_company_id
    AND job.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'JOB_NOT_FOUND';
  END IF;
  IF v_job.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ENTITY_VERSION_CONFLICT';
  END IF;

  IF v_actor_role IN ('worker', 'user') THEN
    IF v_job.assigned_membership_id IS DISTINCT FROM v_actor_membership_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOB_NOT_ASSIGNED_TO_VIEWER';
    END IF;
    IF p_patch ? 'clientId' OR p_patch ? 'assigneeMemberNo' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOB_CLIENT_ASSIGNEE_CHANGE_FORBIDDEN';
    END IF;
  END IF;

  IF v_job.status = 'finished' AND p_patch ? 'status' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_FINISHED_STATUS_LOCKED';
  END IF;

  IF p_patch ? 'clientId' AND pg_catalog.jsonb_typeof(p_patch -> 'clientId') <> 'null' THEN
    SELECT client.*
    INTO v_client
    FROM public.clients AS client
    WHERE client.company_id = p_company_id
      AND client.id = (p_patch ->> 'clientId')::UUID
      AND client.status = 'active'
    LIMIT 1;
    IF v_client.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CLIENT_NOT_FOUND';
    END IF;
  END IF;

  IF p_patch ? 'assigneeMemberNo'
     AND pg_catalog.jsonb_typeof(p_patch -> 'assigneeMemberNo') <> 'null' THEN
    SELECT membership.*
    INTO v_assignee
    FROM public.company_memberships AS membership
    WHERE membership.company_id = p_company_id
      AND membership.member_no = (p_patch ->> 'assigneeMemberNo')::INTEGER
      AND membership.status = 'active'
    LIMIT 1;
    IF v_assignee.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ASSIGNEE_NOT_FOUND';
    END IF;
  END IF;

  UPDATE public.jobs AS job
  SET
    title = CASE WHEN p_patch ? 'title'
      THEN pg_catalog.btrim(p_patch ->> 'title') ELSE job.title END,
    description = CASE WHEN p_patch ? 'description'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'description'), '') ELSE job.description END,
    notes = CASE WHEN p_patch ? 'notes'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'notes'), '') ELSE job.notes END,
    location = CASE WHEN p_patch ? 'location'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'location'), '') ELSE job.location END,
    address = CASE WHEN p_patch ? 'address'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'address'), '') ELSE job.address END,
    category = CASE WHEN p_patch ? 'category'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'category'), '') ELSE job.category END,
    priority = CASE WHEN p_patch ? 'priority'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'priority'), '') ELSE job.priority END,
    due_at = CASE WHEN p_patch ? 'dueAt'
      THEN (p_patch ->> 'dueAt')::TIMESTAMPTZ ELSE job.due_at END,
    client_id = CASE WHEN p_patch ? 'clientId' THEN v_client.id ELSE job.client_id END,
    client_name_snapshot = CASE WHEN p_patch ? 'clientId'
      THEN v_client.name ELSE job.client_name_snapshot END,
    client_phone_snapshot = CASE WHEN p_patch ? 'clientId'
      THEN v_client.phone ELSE job.client_phone_snapshot END,
    assigned_membership_id = CASE WHEN p_patch ? 'assigneeMemberNo'
      THEN v_assignee.id ELSE job.assigned_membership_id END,
    assigned_member_name_snapshot = CASE WHEN p_patch ? 'assigneeMemberNo'
      THEN v_assignee.display_name ELSE job.assigned_member_name_snapshot END,
    status = CASE WHEN p_patch ? 'status'
      THEN (p_patch ->> 'status')::public.job_status ELSE job.status END,
    denied_at = CASE
      WHEN NOT (p_patch ? 'status') THEN job.denied_at
      WHEN p_patch ->> 'status' = 'denied' AND job.status = 'denied' THEN job.denied_at
      WHEN p_patch ->> 'status' = 'denied' THEN v_updated_at
      ELSE NULL
    END,
    denied_by_user_id = CASE
      WHEN NOT (p_patch ? 'status') THEN job.denied_by_user_id
      WHEN p_patch ->> 'status' = 'denied' AND job.status = 'denied' THEN job.denied_by_user_id
      WHEN p_patch ->> 'status' = 'denied' THEN v_actor_user_id
      ELSE NULL
    END,
    updated_at = v_updated_at
  WHERE job.id = p_job_id
    AND job.company_id = p_company_id
  RETURNING job.* INTO v_job;

  PERFORM private.bump_company_sync_version(p_company_id, 'jobs_version');
  RETURN QUERY
  SELECT result.*
  FROM private.get_api_job_mutation_result(p_company_id, p_job_id) AS result;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.accept_api_job(
  p_company_id UUID,
  p_job_id UUID,
  p_expected_entity_version BIGINT,
  p_accepted_at TIMESTAMPTZ
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status TEXT,
  title TEXT,
  description TEXT,
  notes TEXT,
  location TEXT,
  address TEXT,
  category TEXT,
  priority TEXT,
  due_at TIMESTAMPTZ,
  client_id UUID,
  client_name TEXT,
  client_phone TEXT,
  assignee_member_no INTEGER,
  assignee_display_name TEXT,
  creator_uid UUID,
  creator_member_no INTEGER,
  creator_display_name TEXT,
  is_certificate BOOLEAN,
  meta JSONB,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_actor_user_id TEXT;
  v_actor_role TEXT;
  v_accepted_at TIMESTAMPTZ := COALESCE(p_accepted_at, pg_catalog.clock_timestamp());
BEGIN
  IF p_company_id IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_AND_JOB_REQUIRED';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ENTITY_VERSION_INVALID';
  END IF;

  SELECT
    actor.actor_user_id,
    actor.actor_role
  INTO v_actor_user_id, v_actor_role
  FROM private.require_api_job_mutation_actor(p_company_id) AS actor;
  IF v_actor_role NOT IN ('manager', 'dev') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOB_ACCEPT_FORBIDDEN';
  END IF;

  SELECT job.*
  INTO v_job
  FROM public.jobs AS job
  WHERE job.company_id = p_company_id
    AND job.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'JOB_NOT_FOUND';
  END IF;
  IF v_job.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ENTITY_VERSION_CONFLICT';
  END IF;
  IF v_job.status NOT IN ('pending', 'waiting') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_NOT_ACCEPTABLE';
  END IF;

  UPDATE public.jobs AS job
  SET
    status = 'finished',
    accepted_by_user_id = v_actor_user_id,
    accepted_at = v_accepted_at,
    finished_at = v_accepted_at,
    denied_at = NULL,
    denied_by_user_id = NULL,
    updated_at = v_accepted_at
  WHERE job.id = p_job_id
    AND job.company_id = p_company_id
  RETURNING job.* INTO v_job;

  PERFORM private.bump_company_sync_version(p_company_id, 'jobs_version');
  RETURN QUERY
  SELECT result.*
  FROM private.get_api_job_mutation_result(p_company_id, p_job_id) AS result;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.delete_api_job(
  p_company_id UUID,
  p_job_id UUID,
  p_expected_entity_version BIGINT
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  deleted BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_actor_membership_id UUID;
  v_actor_role TEXT;
BEGIN
  IF p_company_id IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_AND_JOB_REQUIRED';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ENTITY_VERSION_INVALID';
  END IF;

  SELECT
    actor.actor_membership_id,
    actor.actor_role
  INTO v_actor_membership_id, v_actor_role
  FROM private.require_api_job_mutation_actor(p_company_id) AS actor;

  SELECT job.*
  INTO v_job
  FROM public.jobs AS job
  WHERE job.company_id = p_company_id
    AND job.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'JOB_NOT_FOUND';
  END IF;
  IF v_job.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ENTITY_VERSION_CONFLICT';
  END IF;
  IF v_job.is_cert THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'JOB_CERTIFICATE_LOCKED';
  END IF;
  IF v_job.status IN ('pending', 'waiting') AND v_actor_role NOT IN ('manager', 'dev') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOB_PENDING_DELETE_FORBIDDEN';
  END IF;
  IF v_actor_role IN ('worker', 'user')
     AND v_job.assigned_membership_id IS DISTINCT FROM v_actor_membership_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOB_NOT_ASSIGNED_TO_VIEWER';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.document_job_links AS document_link
    WHERE document_link.job_id = p_job_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'JOB_HAS_LINKED_DOCUMENTS';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.inventory_movements AS movement
    WHERE movement.company_id = p_company_id
      AND movement.job_id = p_job_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'JOB_HAS_INVENTORY_MOVEMENTS';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.job_attachments AS attachment
    WHERE attachment.job_id = p_job_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'JOB_HAS_ATTACHMENTS';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM private.file_upload_sessions AS upload_session
    WHERE upload_session.target_job_id = p_job_id
       OR upload_session.consumed_by_job_id = p_job_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'JOB_HAS_UPLOAD_SESSION';
  END IF;

  DELETE FROM public.jobs AS job
  WHERE job.id = p_job_id
    AND job.company_id = p_company_id;
  PERFORM private.bump_company_sync_version(p_company_id, 'jobs_version');

  job_id := v_job.id;
  job_no := v_job.job_no;
  deleted := true;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.require_api_job_mutation_actor(UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.validate_api_job_patch(JSONB)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.get_api_job_mutation_result(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.update_api_job(UUID, UUID, BIGINT, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.accept_api_job(UUID, UUID, BIGINT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.delete_api_job(UUID, UUID, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.update_api_job(UUID, UUID, BIGINT, JSONB, TIMESTAMPTZ)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.accept_api_job(UUID, UUID, BIGINT, TIMESTAMPTZ)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.delete_api_job(UUID, UUID, BIGINT)
  TO smart_job_api;
