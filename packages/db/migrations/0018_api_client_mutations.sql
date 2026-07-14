-- Secure client master-data mutations for the Node API.
--
-- The API runtime receives only EXECUTE on the three entrypoints below. Caller
-- identity, tenant authority, module entitlement, membership role, sequential
-- client numbers, optimistic concurrency, reference-safe removal, and sync
-- version changes remain inside one database transaction.

ALTER TABLE public.clients
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT clients_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

CREATE INDEX clients_company_status_created_cursor_idx
  ON public.clients (company_id, status, created_at DESC, id DESC);--> statement-breakpoint

CREATE INDEX jobs_company_client_reference_idx
  ON public.jobs (company_id, client_id)
  WHERE client_id IS NOT NULL;--> statement-breakpoint

CREATE INDEX documents_company_client_reference_idx
  ON public.documents (company_id, client_id)
  WHERE client_id IS NOT NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.increment_client_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER clients_increment_entity_version
BEFORE UPDATE ON public.clients
FOR EACH ROW
EXECUTE FUNCTION private.increment_client_entity_version();--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.require_api_client_mutation_access(
  p_company_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_membership_id UUID;
  v_clients_enabled BOOLEAN := false;
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
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CLIENT_COMPANY_NOT_FOUND';
  END IF;

  SELECT entitlement.clients_enabled
  INTO v_clients_enabled
  FROM private.get_company_module_entitlements(p_company_id) AS entitlement;
  IF NOT COALESCE(v_clients_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CLIENTS_MODULE_DISABLED';
  END IF;

  IF private.app_is_dev() THEN
    RETURN NULL;
  END IF;

  SELECT membership.id
  INTO v_membership_id
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid
    AND membership.status = 'active'
    AND membership.role IN ('manager', 'user', 'basic')
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CLIENT_MUTATION_FORBIDDEN';
  END IF;
  RETURN v_membership_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.validate_api_client_payload(
  p_payload JSONB,
  p_require_name BOOLEAN,
  p_allow_status BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_key TEXT;
  v_value TEXT;
  v_max_length INTEGER;
BEGIN
  IF p_payload IS NULL
     OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
     OR p_payload = '{}'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_PAYLOAD_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_payload) AS payload_key(key)
    WHERE payload_key.key NOT IN (
      'name', 'phone', 'email', 'address', 'city', 'vatNumber', 'notes', 'status'
    )
       OR (payload_key.key = 'status' AND NOT p_allow_status)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_PAYLOAD_FIELDS_INVALID';
  END IF;
  IF p_require_name AND NOT (p_payload ? 'name') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_NAME_REQUIRED';
  END IF;

  IF p_payload ? 'name' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'name') <> 'string'
       OR pg_catalog.btrim(p_payload ->> 'name') = ''
       OR pg_catalog.char_length(pg_catalog.btrim(p_payload ->> 'name')) > 240
       OR (p_payload ->> 'name') ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_NAME_INVALID';
    END IF;
  END IF;

  FOR v_key, v_max_length IN
    SELECT * FROM (VALUES
      ('phone', 40),
      ('email', 320),
      ('address', 500),
      ('city', 120),
      ('vatNumber', 32),
      ('notes', 2000)
    ) AS allowed_field(key, max_length)
  LOOP
    IF p_payload ? v_key THEN
      IF pg_catalog.jsonb_typeof(p_payload -> v_key) NOT IN ('string', 'null') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_FIELD_INVALID';
      END IF;
      v_value := p_payload ->> v_key;
      IF v_value IS NOT NULL
         AND (
           pg_catalog.btrim(v_value) = ''
           OR pg_catalog.char_length(pg_catalog.btrim(v_value)) > v_max_length
         ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_FIELD_INVALID';
      END IF;
      IF v_value IS NOT NULL
         AND v_key <> 'notes'
         AND v_value ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_FIELD_INVALID';
      END IF;
    END IF;
  END LOOP;

  IF p_payload ->> 'email' IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(p_payload ->> 'email'))
       !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_EMAIL_INVALID';
  END IF;
  IF p_allow_status AND p_payload ? 'status' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'status') <> 'string'
       OR p_payload ->> 'status' NOT IN ('active', 'archived') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_STATUS_INVALID';
    END IF;
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_client(
  p_company_id UUID,
  p_payload JSONB,
  p_created_at TIMESTAMPTZ
) RETURNS TABLE (
  client_id UUID,
  client_no INTEGER,
  status TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  vat_number TEXT,
  notes TEXT,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_client_no INTEGER;
  v_client public.clients%ROWTYPE;
  v_created_at TIMESTAMPTZ := COALESCE(p_created_at, pg_catalog.clock_timestamp());
BEGIN
  v_membership_id := private.require_api_client_mutation_access(p_company_id);
  PERFORM private.validate_api_client_payload(p_payload, true, false);
  v_client_no := private.allocate_company_counter(p_company_id, 'client_no');

  INSERT INTO public.clients (
    company_id,
    client_no,
    status,
    name,
    phone,
    email,
    address,
    city,
    vat_number,
    notes,
    created_by_membership_id,
    created_at,
    updated_at
  ) VALUES (
    p_company_id,
    v_client_no,
    'active',
    pg_catalog.btrim(p_payload ->> 'name'),
    NULLIF(pg_catalog.btrim(p_payload ->> 'phone'), ''),
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_payload ->> 'email')), ''),
    NULLIF(pg_catalog.btrim(p_payload ->> 'address'), ''),
    NULLIF(pg_catalog.btrim(p_payload ->> 'city'), ''),
    NULLIF(pg_catalog.btrim(p_payload ->> 'vatNumber'), ''),
    NULLIF(pg_catalog.btrim(p_payload ->> 'notes'), ''),
    v_membership_id,
    v_created_at,
    v_created_at
  )
  RETURNING * INTO v_client;

  PERFORM private.bump_company_sync_version(p_company_id, 'clients_version');

  RETURN QUERY SELECT
    v_client.id,
    v_client.client_no,
    v_client.status::TEXT,
    v_client.name::TEXT,
    v_client.phone::TEXT,
    v_client.email::TEXT,
    v_client.address::TEXT,
    v_client.city::TEXT,
    v_client.vat_number::TEXT,
    v_client.notes::TEXT,
    v_client.entity_version,
    v_client.created_at,
    v_client.updated_at,
    v_client.archived_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.update_api_client(
  p_company_id UUID,
  p_client_id UUID,
  p_expected_entity_version BIGINT,
  p_patch JSONB,
  p_updated_at TIMESTAMPTZ
) RETURNS TABLE (
  client_id UUID,
  client_no INTEGER,
  status TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  vat_number TEXT,
  notes TEXT,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_updated_at TIMESTAMPTZ := COALESCE(p_updated_at, pg_catalog.clock_timestamp());
BEGIN
  PERFORM private.require_api_client_mutation_access(p_company_id);
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_ID_INVALID';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_VERSION_INVALID';
  END IF;
  PERFORM private.validate_api_client_payload(p_patch, false, true);

  UPDATE public.clients AS client
  SET
    name = CASE WHEN p_patch ? 'name'
      THEN pg_catalog.btrim(p_patch ->> 'name') ELSE client.name END,
    phone = CASE WHEN p_patch ? 'phone'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'phone'), '') ELSE client.phone END,
    email = CASE WHEN p_patch ? 'email'
      THEN NULLIF(pg_catalog.lower(pg_catalog.btrim(p_patch ->> 'email')), '') ELSE client.email END,
    address = CASE WHEN p_patch ? 'address'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'address'), '') ELSE client.address END,
    city = CASE WHEN p_patch ? 'city'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'city'), '') ELSE client.city END,
    vat_number = CASE WHEN p_patch ? 'vatNumber'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'vatNumber'), '') ELSE client.vat_number END,
    notes = CASE WHEN p_patch ? 'notes'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'notes'), '') ELSE client.notes END,
    status = CASE WHEN p_patch ? 'status'
      THEN (p_patch ->> 'status')::public.client_status ELSE client.status END,
    archived_at = CASE
      WHEN p_patch ->> 'status' = 'active' THEN NULL
      WHEN p_patch ->> 'status' = 'archived' THEN COALESCE(client.archived_at, v_updated_at)
      ELSE client.archived_at
    END,
    updated_at = v_updated_at
  WHERE client.company_id = p_company_id
    AND client.id = p_client_id
    AND client.entity_version = p_expected_entity_version
  RETURNING client.* INTO v_client;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.clients AS existing_client
      WHERE existing_client.company_id = p_company_id
        AND existing_client.id = p_client_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'CLIENT_ENTITY_VERSION_CONFLICT';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CLIENT_NOT_FOUND';
  END IF;

  PERFORM private.bump_company_sync_version(p_company_id, 'clients_version');

  RETURN QUERY SELECT
    v_client.id,
    v_client.client_no,
    v_client.status::TEXT,
    v_client.name::TEXT,
    v_client.phone::TEXT,
    v_client.email::TEXT,
    v_client.address::TEXT,
    v_client.city::TEXT,
    v_client.vat_number::TEXT,
    v_client.notes::TEXT,
    v_client.entity_version,
    v_client.created_at,
    v_client.updated_at,
    v_client.archived_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.delete_or_archive_api_client(
  p_company_id UUID,
  p_client_id UUID,
  p_expected_entity_version BIGINT,
  p_removed_at TIMESTAMPTZ
) RETURNS TABLE (
  client_id UUID,
  client_no INTEGER,
  disposition TEXT,
  entity_version BIGINT,
  archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_removed_at TIMESTAMPTZ := COALESCE(p_removed_at, pg_catalog.clock_timestamp());
  v_referenced BOOLEAN;
BEGIN
  PERFORM private.require_api_client_mutation_access(p_company_id);
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_ID_INVALID';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_VERSION_INVALID';
  END IF;

  SELECT client.*
  INTO v_client
  FROM public.clients AS client
  WHERE client.company_id = p_company_id
    AND client.id = p_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CLIENT_NOT_FOUND';
  END IF;
  IF v_client.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'CLIENT_ENTITY_VERSION_CONFLICT';
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.jobs AS job
      WHERE job.company_id = p_company_id
        AND job.client_id = p_client_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.documents AS document
      WHERE document.company_id = p_company_id
        AND document.client_id = p_client_id
    )
  INTO v_referenced;

  IF v_referenced THEN
    UPDATE public.clients AS client
    SET
      status = 'archived',
      archived_at = COALESCE(client.archived_at, v_removed_at),
      updated_at = v_removed_at
    WHERE client.id = p_client_id
      AND client.company_id = p_company_id
    RETURNING client.* INTO v_client;

    client_id := v_client.id;
    client_no := v_client.client_no;
    disposition := 'archived';
    entity_version := v_client.entity_version;
    archived_at := v_client.archived_at;
  ELSE
    DELETE FROM public.clients AS client
    WHERE client.id = p_client_id
      AND client.company_id = p_company_id;

    client_id := v_client.id;
    client_no := v_client.client_no;
    disposition := 'deleted';
    entity_version := NULL;
    archived_at := NULL;
  END IF;

  PERFORM private.bump_company_sync_version(p_company_id, 'clients_version');
  RETURN NEXT;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.increment_client_entity_version()
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.require_api_client_mutation_access(UUID)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.validate_api_client_payload(JSONB, BOOLEAN, BOOLEAN)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.create_api_client(UUID, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.update_api_client(UUID, UUID, BIGINT, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.delete_or_archive_api_client(UUID, UUID, BIGINT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.create_api_client(UUID, JSONB, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.update_api_client(UUID, UUID, BIGINT, JSONB, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.delete_or_archive_api_client(UUID, UUID, BIGINT, TIMESTAMPTZ)
TO smart_job_api;
