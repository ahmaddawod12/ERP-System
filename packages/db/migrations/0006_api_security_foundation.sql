-- Stage 2 API security foundation.
--
-- The Cloud Run API connects with a dedicated runtime role. It sets the verified
-- Supabase user id and bounded transaction timeouts before any tenant-scoped SQL.
-- Secrets remain encrypted by the API; Postgres stores only ciphertext and hashes.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smart_job_api') THEN
    CREATE ROLE smart_job_api
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END;
$$;

ALTER ROLE smart_job_api SET search_path = pg_catalog, public;
ALTER ROLE smart_job_api SET statement_timeout = '12s';
ALTER ROLE smart_job_api SET lock_timeout = '3s';
ALTER ROLE smart_job_api SET idle_in_transaction_session_timeout = '15s';

GRANT CONNECT ON DATABASE postgres TO smart_job_api;
GRANT USAGE ON SCHEMA public, private TO smart_job_api;
REVOKE CREATE ON SCHEMA public, private FROM smart_job_api;

-- PostgreSQL grants TEMPORARY to PUBLIC by default, and privileges inherited
-- through PUBLIC cannot be revoked from only one role. The API never needs temp
-- objects, so remove the ambient grant for this database. Database owners and
-- roles with an explicit TEMPORARY grant retain it.
DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC',
    pg_catalog.current_database()
  );
END;
$$;

-- The migration owner can assume the runtime role for local integration tests and
-- production diagnostics. This does not add capabilities to the migration owner.
GRANT smart_job_api TO postgres;

ALTER TABLE public.jobs
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT jobs_entity_version_positive_check CHECK (entity_version > 0);

CREATE OR REPLACE FUNCTION private.increment_job_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER jobs_increment_entity_version
BEFORE UPDATE ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION private.increment_job_entity_version();

CREATE TABLE private.web_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash BYTEA NOT NULL,
  csrf_token_hash BYTEA NOT NULL,
  user_id UUID NOT NULL,
  supabase_session_id UUID NOT NULL,
  credentials_ciphertext BYTEA NOT NULL,
  credentials_iv BYTEA NOT NULL,
  credentials_auth_tag BYTEA NOT NULL,
  encryption_key_version TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  last_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  CONSTRAINT web_sessions_token_hash_length_check
    CHECK (octet_length(session_token_hash) = 32),
  CONSTRAINT web_sessions_csrf_hash_length_check
    CHECK (octet_length(csrf_token_hash) = 32),
  CONSTRAINT web_sessions_credentials_present_check
    CHECK (octet_length(credentials_ciphertext) > 0),
  CONSTRAINT web_sessions_credentials_iv_length_check
    CHECK (octet_length(credentials_iv) = 12),
  CONSTRAINT web_sessions_credentials_auth_tag_length_check
    CHECK (octet_length(credentials_auth_tag) = 16),
  CONSTRAINT web_sessions_key_version_present_check
    CHECK (btrim(encryption_key_version) <> ''),
  CONSTRAINT web_sessions_absolute_lifetime_check
    CHECK (
      absolute_expires_at > created_at
      AND absolute_expires_at <= created_at + interval '12 hours'
    ),
  CONSTRAINT web_sessions_valid_revocation_check
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX web_sessions_token_hash_unique
  ON private.web_sessions (session_token_hash);
CREATE INDEX web_sessions_active_user_expiry_idx
  ON private.web_sessions (user_id, absolute_expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX web_sessions_expiry_idx
  ON private.web_sessions (absolute_expires_at);
CREATE INDEX web_sessions_last_company_idx
  ON private.web_sessions (last_company_id);

CREATE TABLE private.api_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  operation VARCHAR(128) NOT NULL,
  idempotency_key_hash BYTEA NOT NULL,
  request_hash BYTEA NOT NULL,
  response_status SMALLINT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT api_idempotency_key_hash_length_check
    CHECK (octet_length(idempotency_key_hash) = 32),
  CONSTRAINT api_idempotency_request_hash_length_check
    CHECK (octet_length(request_hash) = 32),
  CONSTRAINT api_idempotency_operation_present_check
    CHECK (btrim(operation) <> ''),
  CONSTRAINT api_idempotency_valid_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT api_idempotency_completed_response_check
    CHECK (
      (
        completed_at IS NULL
        AND response_status IS NULL
        AND response_body IS NULL
      )
      OR (
        completed_at IS NOT NULL
        AND response_status BETWEEN 100 AND 599
        AND response_body IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX api_idempotency_tenant_key_unique
  ON private.api_idempotency (
    user_id,
    company_id,
    operation,
    idempotency_key_hash
  )
  WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX api_idempotency_global_key_unique
  ON private.api_idempotency (user_id, operation, idempotency_key_hash)
  WHERE company_id IS NULL;
CREATE INDEX api_idempotency_expiry_idx
  ON private.api_idempotency (expires_at);

CREATE TABLE private.file_upload_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  purpose VARCHAR(64) NOT NULL,
  target_job_id UUID REFERENCES public.jobs(id) ON DELETE RESTRICT,
  bucket_id TEXT NOT NULL,
  object_prefix TEXT NOT NULL,
  expected_manifest JSONB NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  cleanup_lease_expires_at TIMESTAMPTZ,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  last_cleanup_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT file_upload_sessions_purpose_check
    CHECK (purpose IN ('job.create_finished', 'job.complete_assigned')),
  CONSTRAINT file_upload_sessions_status_check
    CHECK (
      status IN (
        'pending',
        'consumed',
        'cleanup_pending',
        'cleanup_claimed',
        'cleanup_complete'
      )
    ),
  CONSTRAINT file_upload_sessions_manifest_shape_check
    CHECK (
      jsonb_typeof(expected_manifest) = 'array'
      AND jsonb_array_length(expected_manifest) BETWEEN 1 AND 20
    ),
  CONSTRAINT file_upload_sessions_valid_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT file_upload_sessions_completion_target_check
    CHECK (purpose <> 'job.complete_assigned' OR target_job_id IS NOT NULL),
  CONSTRAINT file_upload_sessions_consumption_state_check
    CHECK (
      (
        status = 'consumed'
        AND consumed_at IS NOT NULL
        AND consumed_by_job_id IS NOT NULL
      )
      OR (
        status <> 'consumed'
        AND consumed_at IS NULL
        AND consumed_by_job_id IS NULL
      )
    ),
  CONSTRAINT file_upload_sessions_cleanup_attempts_non_negative_check
    CHECK (cleanup_attempts >= 0),
  CONSTRAINT file_upload_sessions_bucket_present_check
    CHECK (btrim(bucket_id) <> ''),
  CONSTRAINT file_upload_sessions_prefix_present_check
    CHECK (btrim(object_prefix) <> '')
);

CREATE INDEX file_upload_sessions_pending_owner_expiry_idx
  ON private.file_upload_sessions (user_id, company_id, expires_at)
  WHERE status = 'pending';
CREATE INDEX file_upload_sessions_cleanup_queue_idx
  ON private.file_upload_sessions (status, cleanup_lease_expires_at, expires_at);
CREATE INDEX file_upload_sessions_target_job_idx
  ON private.file_upload_sessions (company_id, target_job_id)
  WHERE target_job_id IS NOT NULL;

ALTER TABLE private.api_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.api_idempotency FORCE ROW LEVEL SECURITY;
ALTER TABLE private.file_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.file_upload_sessions FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.set_api_request_context(
  p_user_id UUID,
  p_statement_timeout_ms INTEGER DEFAULT 12000,
  p_lock_timeout_ms INTEGER DEFAULT 3000,
  p_idle_transaction_timeout_ms INTEGER DEFAULT 15000
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'api_context_user_required';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM pg_catalog.set_config(
    'statement_timeout',
    LEAST(GREATEST(COALESCE(p_statement_timeout_ms, 12000), 1000), 12000)::text || 'ms',
    true
  );
  PERFORM pg_catalog.set_config(
    'lock_timeout',
    LEAST(GREATEST(COALESCE(p_lock_timeout_ms, 3000), 250), 3000)::text || 'ms',
    true
  );
  PERFORM pg_catalog.set_config(
    'idle_in_transaction_session_timeout',
    LEAST(GREATEST(COALESCE(p_idle_transaction_timeout_ms, 15000), 1000), 15000)::text || 'ms',
    true
  );
END;
$$;

-- The legacy membership policy queried company_memberships from inside its own
-- policy, which recursed for every non-bypass role. Keep the same visibility rule
-- behind a SECURITY DEFINER helper so policy evaluation never re-enters itself.
CREATE OR REPLACE FUNCTION private.app_is_company_manager(
  target_company_id UUID
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
      WHERE membership.company_id = target_company_id
        AND membership.user_id = private.app_auth_uid()
        AND membership.status = 'active'
        AND membership.role = 'manager'
    );
$$;

ALTER POLICY company_memberships_company_read_policy
ON public.company_memberships
USING (
  user_id = private.app_auth_uid()
  OR private.app_is_company_manager(company_id)
);

CREATE POLICY api_idempotency_owner_policy
ON private.api_idempotency
FOR ALL
TO smart_job_api
USING (
  user_id::text = private.app_auth_uid()
  AND (company_id IS NULL OR private.app_has_company_access(company_id))
)
WITH CHECK (
  user_id::text = private.app_auth_uid()
  AND (company_id IS NULL OR private.app_has_company_access(company_id))
);

CREATE POLICY file_upload_sessions_owner_policy
ON private.file_upload_sessions
FOR ALL
TO smart_job_api
USING (
  user_id::text = private.app_auth_uid()
  AND private.app_has_company_access(company_id)
)
WITH CHECK (
  user_id::text = private.app_auth_uid()
  AND private.app_has_company_access(company_id)
);

CREATE POLICY app_users_api_self_read
ON public.app_users
FOR SELECT
TO smart_job_api
USING (id = private.app_auth_uid() OR private.app_is_dev());

CREATE POLICY companies_api_membership_read
ON public.companies
FOR SELECT
TO smart_job_api
USING (private.app_has_company_access(id));

-- API-owned private state. Web sessions intentionally do not use RLS because an
-- opaque session token must be resolved before a user context exists.
GRANT SELECT, INSERT, UPDATE, DELETE ON private.web_sessions TO smart_job_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON private.api_idempotency TO smart_job_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON private.file_upload_sessions TO smart_job_api;

GRANT SELECT ON
  public.app_users,
  public.companies,
  public.company_profiles,
  public.company_subscriptions,
  public.company_sync_state,
  public.company_memberships,
  public.clients,
  public.jobs,
  public.job_attachments,
  public.job_part_usages,
  public.inventory_locations,
  public.inventory_parts,
  public.inventory_balances,
  public.inventory_movements,
  public.documents,
  public.document_items,
  public.document_job_links,
  public.proposal_usage,
  public.company_invites,
  public.document_tasks,
  public.support_conversations,
  public.support_messages
TO smart_job_api;

-- The runtime role never calls public compatibility RPCs. Revoke ambient PUBLIC
-- execution so its effective privileges are only the private functions granted below.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM smart_job_api;

REVOKE EXECUTE ON FUNCTION private.increment_job_entity_version() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.set_api_request_context(UUID, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.app_is_company_manager(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.set_api_request_context(UUID, INTEGER, INTEGER, INTEGER) TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.app_auth_uid() TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.app_is_dev() TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.app_has_company_access(UUID) TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.app_is_company_manager(UUID) TO smart_job_api;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION private.app_is_company_manager(UUID) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION private.app_is_company_manager(UUID) TO service_role;
  END IF;
END;
$$;

-- The completion RPC reaches these legacy inventory/sync helpers. They were
-- originally SECURITY DEFINER functions with search_path=public and unqualified
-- relations. Harden the complete call chain before exposing it to smart_job_api,
-- so a session-local temporary relation cannot shadow an ERP table.
CREATE OR REPLACE FUNCTION private.apply_inventory_movement(
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
  p_created_at TIMESTAMPTZ DEFAULT pg_catalog.now()
) RETURNS TABLE (
  movement_id UUID,
  from_quantity NUMERIC,
  to_quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from_quantity NUMERIC := NULL;
  v_to_quantity NUMERIC := NULL;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'inventory_invalid_quantity';
  END IF;

  IF p_from_location_id IS NULL AND p_to_location_id IS NULL THEN
    RAISE EXCEPTION 'inventory_missing_location';
  END IF;

  IF p_from_location_id IS NOT NULL THEN
    INSERT INTO public.inventory_balances AS balance (
      location_id,
      part_id,
      quantity_on_hand,
      updated_at
    ) VALUES (
      p_from_location_id,
      p_part_id,
      0,
      p_created_at
    )
    ON CONFLICT (location_id, part_id) DO NOTHING;

    UPDATE public.inventory_balances AS balance
    SET quantity_on_hand = balance.quantity_on_hand - p_quantity,
        updated_at = p_created_at
    WHERE balance.location_id = p_from_location_id
      AND balance.part_id = p_part_id
      AND balance.quantity_on_hand >= p_quantity
    RETURNING balance.quantity_on_hand INTO v_from_quantity;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'inventory_insufficient_stock';
    END IF;
  END IF;

  IF p_to_location_id IS NOT NULL THEN
    INSERT INTO public.inventory_balances AS balance (
      location_id,
      part_id,
      quantity_on_hand,
      updated_at
    ) VALUES (
      p_to_location_id,
      p_part_id,
      p_quantity,
      p_created_at
    )
    ON CONFLICT (location_id, part_id) DO UPDATE
      SET quantity_on_hand = balance.quantity_on_hand + EXCLUDED.quantity_on_hand,
          updated_at = EXCLUDED.updated_at
    RETURNING balance.quantity_on_hand INTO v_to_quantity;
  END IF;

  INSERT INTO public.inventory_movements AS movement (
    company_id,
    part_id,
    quantity,
    from_location_id,
    to_location_id,
    movement_type,
    job_id,
    document_id,
    created_by_membership_id,
    note,
    created_at
  ) VALUES (
    p_company_id,
    p_part_id,
    p_quantity,
    p_from_location_id,
    p_to_location_id,
    p_movement_type,
    p_job_id,
    p_document_id,
    p_created_by_membership_id,
    p_note,
    p_created_at
  ) RETURNING movement.id INTO movement_id;

  from_quantity := v_from_quantity;
  to_quantity := v_to_quantity;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION private.apply_job_inventory_consumption_batch(
  p_company_id UUID,
  p_membership_id UUID,
  p_job_id UUID,
  p_created_by_membership_id UUID,
  p_parts JSONB,
  p_created_at TIMESTAMPTZ DEFAULT pg_catalog.now()
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from_location_id UUID;
  v_consumed_location_id UUID;
  v_pick RECORD;
  v_part RECORD;
  v_movement RECORD;
BEGIN
  IF p_parts IS NULL
    OR pg_catalog.jsonb_typeof(p_parts) <> 'array'
    OR pg_catalog.jsonb_array_length(p_parts) = 0 THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.jobs AS job
    WHERE job.id = p_job_id
      AND job.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'inventory_job_not_found';
  END IF;

  SELECT location.id
  INTO v_from_location_id
  FROM public.inventory_locations AS location
  WHERE location.company_id = p_company_id
    AND location.location_type = 'member'
    AND location.membership_id = p_membership_id
  LIMIT 1;

  IF v_from_location_id IS NULL THEN
    RAISE EXCEPTION 'inventory_member_location_missing';
  END IF;

  INSERT INTO public.inventory_locations AS location (
    company_id,
    location_type,
    membership_id,
    name,
    created_at
  ) VALUES (
    p_company_id,
    'consumed',
    NULL,
    'Consumed Inventory',
    p_created_at
  )
  ON CONFLICT DO NOTHING;

  SELECT location.id
  INTO v_consumed_location_id
  FROM public.inventory_locations AS location
  WHERE location.company_id = p_company_id
    AND location.location_type = 'consumed'
    AND location.membership_id IS NULL
  LIMIT 1;

  IF v_consumed_location_id IS NULL THEN
    RAISE EXCEPTION 'inventory_consumed_location_missing';
  END IF;

  FOR v_pick IN
    SELECT parsed_part.*
    FROM pg_catalog.jsonb_to_recordset(p_parts) AS parsed_part(
      part_id UUID,
      part_no INTEGER,
      quantity NUMERIC
    )
  LOOP
    IF v_pick.part_id IS NULL OR v_pick.quantity IS NULL OR v_pick.quantity <= 0 THEN
      RAISE EXCEPTION 'inventory_invalid_consumption';
    END IF;

    SELECT inventory_part.id, inventory_part.part_no
    INTO v_part
    FROM public.inventory_parts AS inventory_part
    WHERE inventory_part.id = v_pick.part_id
      AND inventory_part.company_id = p_company_id
      AND inventory_part.archived_at IS NULL
    LIMIT 1;

    IF v_part.id IS NULL THEN
      RAISE EXCEPTION 'inventory_part_not_found';
    END IF;

    SELECT movement.*
    INTO v_movement
    FROM private.apply_inventory_movement(
      p_company_id,
      v_part.id,
      v_pick.quantity,
      v_from_location_id,
      v_consumed_location_id,
      'job_consumption'::public.inventory_movement_type,
      p_created_by_membership_id,
      p_job_id,
      NULL,
      'Consumed for job #' || COALESCE(v_pick.part_no::text, v_part.part_no::text, ''),
      p_created_at
    ) AS movement;

    movement_id := v_movement.movement_id;
    part_id := v_part.id;
    part_no := v_part.part_no;
    quantity := v_pick.quantity;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION private.bump_company_sync_version(
  p_company_id UUID,
  p_field TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_field NOT IN (
    'jobs_version',
    'documents_version',
    'clients_version',
    'workers_version',
    'company_inventory_version'
  ) THEN
    RAISE EXCEPTION 'Invalid sync version field: %', p_field;
  END IF;

  INSERT INTO public.company_sync_state AS sync_state (
    company_id,
    jobs_version,
    documents_version,
    clients_version,
    workers_version,
    company_inventory_version,
    updated_at
  ) VALUES (
    p_company_id,
    CASE WHEN p_field = 'jobs_version' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'documents_version' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'clients_version' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'workers_version' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'company_inventory_version' THEN 1 ELSE 0 END,
    pg_catalog.now()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    jobs_version = CASE WHEN p_field = 'jobs_version'
      THEN sync_state.jobs_version + 1 ELSE sync_state.jobs_version END,
    documents_version = CASE WHEN p_field = 'documents_version'
      THEN sync_state.documents_version + 1 ELSE sync_state.documents_version END,
    clients_version = CASE WHEN p_field = 'clients_version'
      THEN sync_state.clients_version + 1 ELSE sync_state.clients_version END,
    workers_version = CASE WHEN p_field = 'workers_version'
      THEN sync_state.workers_version + 1 ELSE sync_state.workers_version END,
    company_inventory_version = CASE WHEN p_field = 'company_inventory_version'
      THEN sync_state.company_inventory_version + 1
      ELSE sync_state.company_inventory_version END,
    updated_at = pg_catalog.now();
END;
$$;

REVOKE EXECUTE ON FUNCTION private.apply_inventory_movement(
  UUID,
  UUID,
  NUMERIC,
  UUID,
  UUID,
  public.inventory_movement_type,
  UUID,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, smart_job_api;
REVOKE EXECUTE ON FUNCTION private.apply_job_inventory_consumption_batch(
  UUID,
  UUID,
  UUID,
  UUID,
  JSONB,
  TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, smart_job_api;
REVOKE EXECUTE ON FUNCTION private.bump_company_sync_version(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, smart_job_api;
GRANT EXECUTE ON FUNCTION private.apply_inventory_movement(
  UUID,
  UUID,
  NUMERIC,
  UUID,
  UUID,
  public.inventory_movement_type,
  UUID,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION private.apply_job_inventory_consumption_batch(
  UUID,
  UUID,
  UUID,
  UUID,
  JSONB,
  TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION private.bump_company_sync_version(UUID, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION private.get_company_module_entitlements(
  p_company_id UUID
) RETURNS TABLE (
  jobs_enabled BOOLEAN,
  clients_enabled BOOLEAN,
  inventory_enabled BOOLEAN,
  documents_enabled BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH subscription AS (
    SELECT
      company_subscription.tier::text AS tier,
      company_subscription.status::text AS status,
      company_subscription.enabled_modules,
      company_subscription.expires_at
    FROM public.company_subscriptions AS company_subscription
    WHERE company_subscription.company_id = p_company_id
    LIMIT 1
  ),
  entitlement_context AS (
    SELECT
      private.app_is_dev() AS is_dev,
      COALESCE(
        subscription.status IN ('active', 'trial')
        AND (
          subscription.expires_at IS NULL
          OR subscription.expires_at > pg_catalog.statement_timestamp()
        ),
        false
      ) AS subscription_active,
      subscription.tier,
      COALESCE(subscription.enabled_modules, '{}'::jsonb) AS enabled_modules
    FROM (SELECT 1) AS seed
    LEFT JOIN subscription ON true
  )
  SELECT
    entitlement_context.is_dev OR (
      entitlement_context.subscription_active
      AND CASE
        -- `solojob` is the canonical client module. `jobs` remains a
        -- transition-compatible override for registrations created by Edge.
        WHEN pg_catalog.jsonb_typeof(
          entitlement_context.enabled_modules -> 'solojob'
        ) = 'boolean'
          THEN (entitlement_context.enabled_modules ->> 'solojob')::boolean
        WHEN pg_catalog.jsonb_typeof(
          entitlement_context.enabled_modules -> 'jobs'
        ) = 'boolean'
          THEN (entitlement_context.enabled_modules ->> 'jobs')::boolean
        ELSE entitlement_context.tier IN ('Solo', 'Team', 'Enterprise')
      END
    ) AS jobs_enabled,
    entitlement_context.is_dev OR (
      entitlement_context.subscription_active
      AND CASE
        WHEN pg_catalog.jsonb_typeof(
          entitlement_context.enabled_modules -> 'clients'
        ) = 'boolean'
          THEN (entitlement_context.enabled_modules ->> 'clients')::boolean
        ELSE entitlement_context.tier IN ('Basic', 'Solo', 'Team', 'Enterprise')
      END
    ) AS clients_enabled,
    entitlement_context.is_dev OR (
      entitlement_context.subscription_active
      AND CASE
        WHEN pg_catalog.jsonb_typeof(
          entitlement_context.enabled_modules -> 'inventory'
        ) = 'boolean'
          THEN (entitlement_context.enabled_modules ->> 'inventory')::boolean
        ELSE entitlement_context.tier IN ('Solo', 'Team', 'Enterprise')
      END
    ) AS inventory_enabled,
    entitlement_context.is_dev OR (
      entitlement_context.subscription_active
      AND CASE
        WHEN pg_catalog.jsonb_typeof(
          entitlement_context.enabled_modules -> 'documents'
        ) = 'boolean'
          THEN (entitlement_context.enabled_modules ->> 'documents')::boolean
        ELSE entitlement_context.tier IN ('Basic', 'Solo', 'Team', 'Enterprise')
      END
    ) AS documents_enabled
  FROM entitlement_context;
$$;

REVOKE EXECUTE ON FUNCTION private.get_company_module_entitlements(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_company_module_entitlements(UUID)
  TO smart_job_api, service_role;

CREATE OR REPLACE FUNCTION private.complete_job_with_details(
  p_company_id UUID,
  p_job_id UUID,
  p_expected_entity_version BIGINT,
  p_details JSONB DEFAULT '{}'::jsonb,
  p_parts JSONB DEFAULT NULL,
  p_upload_session_id UUID DEFAULT NULL,
  p_completed_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status public.job_status,
  entity_version BIGINT,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_uid_text TEXT := private.app_auth_uid();
  v_details JSONB := COALESCE(p_details, '{}'::jsonb);
  v_job public.jobs%ROWTYPE;
  v_membership public.company_memberships%ROWTYPE;
  v_upload private.file_upload_sessions%ROWTYPE;
  v_is_dev BOOLEAN := false;
  v_jobs_enabled BOOLEAN := false;
  v_consumer_membership_id UUID;
  v_consumption_parts JSONB := '[]'::jsonb;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'AUTH_CONTEXT_REQUIRED';
  END IF;

  BEGIN
    v_uid := v_uid_text::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING
        ERRCODE = '28000',
        MESSAGE = 'AUTH_CONTEXT_INVALID';
  END;

  IF p_company_id IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMPANY_AND_JOB_REQUIRED';
  END IF;

  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ENTITY_VERSION_INVALID';
  END IF;

  IF p_completed_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMPLETED_AT_REQUIRED';
  END IF;

  SELECT private.app_is_dev()
  INTO v_is_dev;

  SELECT j.*
  INTO v_job
  FROM public.jobs j
  WHERE j.id = p_job_id
    AND j.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'JOB_NOT_FOUND';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM public.company_memberships membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid::text
    AND membership.status = 'active'
  ORDER BY membership.joined_at, membership.created_at, membership.id
  LIMIT 1;

  IF NOT FOUND AND NOT v_is_dev THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMPANY_MEMBERSHIP_REQUIRED';
  END IF;

  IF NOT v_is_dev THEN
    IF v_membership.role = 'basic' THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'JOB_COMPLETION_FORBIDDEN';
    END IF;

    IF v_membership.role IN ('worker', 'user')
      AND v_job.assigned_membership_id IS DISTINCT FROM v_membership.id THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'JOB_NOT_ASSIGNED_TO_VIEWER';
    END IF;
  END IF;

  SELECT entitlement.jobs_enabled
  INTO v_jobs_enabled
  FROM private.get_company_module_entitlements(p_company_id) AS entitlement;

  IF NOT COALESCE(v_jobs_enabled, false) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'JOBS_MODULE_DISABLED';
  END IF;

  IF v_job.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'ENTITY_VERSION_CONFLICT',
      DETAIL = format(
        'expected=%s actual=%s',
        p_expected_entity_version,
        v_job.entity_version
      );
  END IF;

  IF v_job.status NOT IN ('pending', 'waiting') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'JOB_NOT_COMPLETABLE';
  END IF;

  IF jsonb_typeof(v_details) <> 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'JOB_DETAILS_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(v_details) AS detail_key(key)
    WHERE detail_key.key <> ALL (
      ARRAY['timeFrom', 'timeTo', 'signingPerson', 'travelDistance']::text[]
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'JOB_DETAILS_UNKNOWN_FIELD';
  END IF;

  IF v_details ? 'timeFrom'
    AND jsonb_typeof(v_details -> 'timeFrom') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_FROM_INVALID';
  END IF;
  IF v_details ? 'timeTo'
    AND jsonb_typeof(v_details -> 'timeTo') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_TO_INVALID';
  END IF;
  IF v_details ? 'signingPerson'
    AND jsonb_typeof(v_details -> 'signingPerson') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SIGNING_PERSON_INVALID';
  END IF;
  IF v_details ? 'travelDistance'
    AND jsonb_typeof(v_details -> 'travelDistance') NOT IN ('number', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRAVEL_DISTANCE_INVALID';
  END IF;

  IF COALESCE(v_details ->> 'timeFrom', '') <> ''
    AND (v_details ->> 'timeFrom') !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_FROM_INVALID';
  END IF;
  IF COALESCE(v_details ->> 'timeTo', '') <> ''
    AND (v_details ->> 'timeTo') !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_TO_INVALID';
  END IF;
  IF COALESCE(v_details ->> 'timeFrom', '') <> ''
    AND COALESCE(v_details ->> 'timeTo', '') <> ''
    AND (v_details ->> 'timeTo')::time < (v_details ->> 'timeFrom')::time THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_RANGE_INVALID';
  END IF;
  IF jsonb_typeof(v_details -> 'signingPerson') = 'string'
    AND (
      char_length(btrim(v_details ->> 'signingPerson')) < 1
      OR char_length(v_details ->> 'signingPerson') > 200
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SIGNING_PERSON_INVALID';
  END IF;
  IF jsonb_typeof(v_details -> 'travelDistance') = 'number'
    AND (v_details ->> 'travelDistance')::numeric < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRAVEL_DISTANCE_INVALID';
  END IF;

  IF p_parts IS NOT NULL THEN
    IF jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) > 500 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PARTS_INVALID';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_parts) AS part(item)
      WHERE jsonb_typeof(part.item) <> 'object'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PART_INVALID';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_parts) AS part(item)
      WHERE NOT (part.item ? 'partId' AND part.item ? 'quantity')
        OR EXISTS (
          SELECT 1
          FROM jsonb_object_keys(part.item) AS field(key)
          WHERE field.key <> ALL (ARRAY['partId', 'quantity']::text[])
        )
        OR jsonb_typeof(part.item -> 'partId') <> 'number'
        OR jsonb_typeof(part.item -> 'quantity') <> 'number'
        OR (part.item ->> 'partId') !~ '^[1-9][0-9]*$'
        OR (part.item ->> 'partId')::numeric > 2147483647
        OR (part.item ->> 'quantity')::numeric <= 0
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PART_INVALID';
    END IF;

    IF (
      SELECT count(*)
      FROM jsonb_array_elements(p_parts)
    ) <> (
      SELECT count(DISTINCT (part.item ->> 'partId')::integer)
      FROM jsonb_array_elements(p_parts) AS part(item)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PART_DUPLICATE';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_parts) AS part(item)
      LEFT JOIN public.inventory_parts inventory_part
        ON inventory_part.company_id = p_company_id
       AND inventory_part.part_no = (part.item ->> 'partId')::integer
       AND inventory_part.active
       AND inventory_part.archived_at IS NULL
      WHERE inventory_part.id IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
    END IF;

    DELETE FROM public.job_part_usages AS usage_to_replace
    WHERE usage_to_replace.job_id = p_job_id;

    INSERT INTO public.job_part_usages (
      job_id,
      inventory_part_id,
      part_name_snapshot,
      quantity,
      created_at
    )
    SELECT
      p_job_id,
      inventory_part.id,
      inventory_part.name,
      (part.item ->> 'quantity')::numeric,
      p_completed_at
    FROM jsonb_array_elements(p_parts) AS part(item)
    INNER JOIN public.inventory_parts inventory_part
      ON inventory_part.company_id = p_company_id
     AND inventory_part.part_no = (part.item ->> 'partId')::integer
     AND inventory_part.active
     AND inventory_part.archived_at IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.job_part_usages usage
    LEFT JOIN public.inventory_parts inventory_part
      ON inventory_part.id = usage.inventory_part_id
     AND inventory_part.company_id = p_company_id
     AND inventory_part.active
     AND inventory_part.archived_at IS NULL
    WHERE usage.job_id = p_job_id
      AND inventory_part.id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'part_id', inventory_part.id,
        'part_no', inventory_part.part_no,
        'quantity', usage.quantity
      )
      ORDER BY inventory_part.part_no, inventory_part.id
    ),
    '[]'::jsonb
  )
  INTO v_consumption_parts
  FROM public.job_part_usages usage
  INNER JOIN public.inventory_parts inventory_part
    ON inventory_part.id = usage.inventory_part_id
   AND inventory_part.company_id = p_company_id
   AND inventory_part.active
   AND inventory_part.archived_at IS NULL
  WHERE usage.job_id = p_job_id;

  IF p_upload_session_id IS NOT NULL THEN
    SELECT upload_session.*
    INTO v_upload
    FROM private.file_upload_sessions upload_session
    WHERE upload_session.id = p_upload_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPLOAD_SESSION_NOT_FOUND';
    END IF;
    IF v_upload.user_id <> v_uid
      OR v_upload.company_id <> p_company_id
      OR v_upload.purpose <> 'job.complete_assigned'
      OR v_upload.target_job_id IS DISTINCT FROM p_job_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPLOAD_SESSION_FORBIDDEN';
    END IF;
    IF v_upload.status <> 'pending' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_ALREADY_CONSUMED';
    END IF;
    IF v_upload.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_EXPIRED';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
      WHERE jsonb_typeof(attachment.item) <> 'object'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_INVALID';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
      WHERE NOT (
        attachment.item ? 'attachmentId'
        AND attachment.item ? 'kind'
        AND attachment.item ? 'fileName'
        AND attachment.item ? 'mimeType'
        AND attachment.item ? 'sizeBytes'
        AND attachment.item ? 'sha256'
        AND attachment.item ? 'objectPath'
      )
        OR EXISTS (
          SELECT 1
          FROM jsonb_object_keys(attachment.item) AS field(key)
          WHERE field.key <> ALL (
            ARRAY[
              'attachmentId',
              'kind',
              'fileName',
              'mimeType',
              'sizeBytes',
              'sha256',
              'objectPath'
            ]::text[]
          )
        )
        OR jsonb_typeof(attachment.item -> 'attachmentId') <> 'string'
        OR (attachment.item ->> 'attachmentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR jsonb_typeof(attachment.item -> 'kind') <> 'string'
        OR (attachment.item ->> 'kind') NOT IN ('photo', 'signature')
        OR jsonb_typeof(attachment.item -> 'fileName') <> 'string'
        OR char_length(btrim(attachment.item ->> 'fileName')) NOT BETWEEN 1 AND 255
        OR jsonb_typeof(attachment.item -> 'mimeType') <> 'string'
        OR char_length(btrim(attachment.item ->> 'mimeType')) NOT BETWEEN 1 AND 255
        OR jsonb_typeof(attachment.item -> 'sizeBytes') <> 'number'
        OR (attachment.item ->> 'sizeBytes')::numeric <= 0
        OR trunc((attachment.item ->> 'sizeBytes')::numeric) <> (attachment.item ->> 'sizeBytes')::numeric
        OR jsonb_typeof(attachment.item -> 'sha256') <> 'string'
        OR (attachment.item ->> 'sha256') !~* '^[0-9a-f]{64}$'
        OR jsonb_typeof(attachment.item -> 'objectPath') <> 'string'
        OR char_length(attachment.item ->> 'objectPath') NOT BETWEEN 1 AND 1024
        OR left(
          attachment.item ->> 'objectPath',
          char_length(v_upload.object_prefix) + 1
        ) <> v_upload.object_prefix || '/'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_INVALID';
    END IF;

    IF (
      SELECT count(*)
      FROM jsonb_array_elements(v_upload.expected_manifest)
    ) <> (
      SELECT count(DISTINCT attachment.item ->> 'attachmentId')
      FROM jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
    ) OR (
      SELECT count(*)
      FROM jsonb_array_elements(v_upload.expected_manifest)
    ) <> (
      SELECT count(DISTINCT attachment.item ->> 'objectPath')
      FROM jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_DUPLICATE';
    END IF;

    INSERT INTO public.job_attachments (
      id,
      job_id,
      storage_path,
      kind,
      uploaded_by_user_id,
      created_at
    )
    SELECT
      (attachment.item ->> 'attachmentId')::uuid,
      p_job_id,
      attachment.item ->> 'objectPath',
      (attachment.item ->> 'kind')::public.job_attachment_kind,
      v_uid::text,
      p_completed_at
    FROM jsonb_array_elements(v_upload.expected_manifest) AS attachment(item);

    UPDATE private.file_upload_sessions
    SET status = 'consumed',
        consumed_at = p_completed_at,
        consumed_by_job_id = p_job_id,
        updated_at = p_completed_at
    WHERE id = p_upload_session_id;
  END IF;

  UPDATE public.jobs
  SET status = 'finished',
      accepted_by_user_id = v_uid_text,
      accepted_at = p_completed_at,
      finished_at = p_completed_at,
      meta = COALESCE(meta, '{}'::jsonb) || v_details,
      updated_at = p_completed_at
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  IF jsonb_array_length(v_consumption_parts) > 0 THEN
    v_consumer_membership_id := COALESCE(
      v_job.assigned_membership_id,
      v_membership.id
    );

    IF v_consumer_membership_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'INVENTORY_CONSUMER_MEMBERSHIP_REQUIRED';
    END IF;

    PERFORM 1
    FROM private.apply_job_inventory_consumption_batch(
      p_company_id,
      v_consumer_membership_id,
      p_job_id,
      COALESCE(v_membership.id, v_job.created_by_membership_id),
      v_consumption_parts,
      p_completed_at
    );

    PERFORM private.bump_company_sync_version(
      p_company_id,
      'company_inventory_version'
    );
  END IF;

  PERFORM private.bump_company_sync_version(p_company_id, 'jobs_version');

  RETURN QUERY
  SELECT
    v_job.id,
    v_job.job_no,
    v_job.status,
    v_job.entity_version,
    v_job.finished_at,
    v_job.updated_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.complete_job_with_details(
  UUID,
  UUID,
  BIGINT,
  JSONB,
  JSONB,
  UUID,
  TIMESTAMPTZ
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.complete_job_with_details(
  UUID,
  UUID,
  BIGINT,
  JSONB,
  JSONB,
  UUID,
  TIMESTAMPTZ
) TO smart_job_api;

CREATE OR REPLACE FUNCTION private.cleanup_expired_operational_rows(
  p_now TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rate_limit_deleted INTEGER := 0;
  v_tax_idempotency_deleted INTEGER := 0;
  v_document_tasks_deleted INTEGER := 0;
  v_notifications_deleted INTEGER := 0;
  v_contact_requests_deleted INTEGER := 0;
  v_web_sessions_deleted INTEGER := 0;
  v_api_idempotency_deleted INTEGER := 0;
  v_upload_sessions_queued INTEGER := 0;
  v_upload_leases_requeued INTEGER := 0;
  v_upload_sessions_deleted INTEGER := 0;
BEGIN
  DELETE FROM public.rate_limit_buckets
  WHERE expire_at < p_now;
  GET DIAGNOSTICS v_rate_limit_deleted = ROW_COUNT;

  DELETE FROM public.tax_invoice_idempotency
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now
    AND status <> 'approved';
  GET DIAGNOSTICS v_tax_idempotency_deleted = ROW_COUNT;

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

  DELETE FROM private.web_sessions
  WHERE absolute_expires_at < p_now
    OR (revoked_at IS NOT NULL AND revoked_at < p_now - interval '7 days');
  GET DIAGNOSTICS v_web_sessions_deleted = ROW_COUNT;

  DELETE FROM private.api_idempotency
  WHERE expires_at < p_now;
  GET DIAGNOSTICS v_api_idempotency_deleted = ROW_COUNT;

  UPDATE private.file_upload_sessions
  SET status = 'cleanup_pending',
      cleanup_lease_expires_at = NULL,
      updated_at = p_now
  WHERE status = 'pending'
    AND expires_at < p_now;
  GET DIAGNOSTICS v_upload_sessions_queued = ROW_COUNT;

  UPDATE private.file_upload_sessions
  SET status = 'cleanup_pending',
      cleanup_lease_expires_at = NULL,
      updated_at = p_now
  WHERE status = 'cleanup_claimed'
    AND cleanup_lease_expires_at < p_now;
  GET DIAGNOSTICS v_upload_leases_requeued = ROW_COUNT;
  v_upload_sessions_queued := v_upload_sessions_queued + v_upload_leases_requeued;

  -- Object deletion is performed by the maintenance worker first. Only rows that
  -- reached cleanup_complete are removed here; pending manifests are never lost.
  DELETE FROM private.file_upload_sessions
  WHERE status = 'cleanup_complete'
    AND updated_at < p_now - interval '7 days';
  GET DIAGNOSTICS v_upload_sessions_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'rateLimitBuckets', v_rate_limit_deleted,
    'taxInvoiceIdempotency', v_tax_idempotency_deleted,
    'documentTasks', v_document_tasks_deleted,
    'notificationDeliveries', v_notifications_deleted,
    'contactRequests', v_contact_requests_deleted,
    'webSessions', v_web_sessions_deleted,
    'apiIdempotency', v_api_idempotency_deleted,
    'uploadSessionsQueued', v_upload_sessions_queued,
    'uploadSessionsDeleted', v_upload_sessions_deleted
  );
END;
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
  SELECT private.get_clients_page(
    p_company_id,
    LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200),
    p_after_client_no,
    p_after_id,
    p_search
  );
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
  SELECT private.get_company_inventory_page(
    p_company_id,
    LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200),
    p_after_part_no,
    p_after_id,
    p_search
  );
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
  SELECT private.get_member_inventory_page(
    p_company_id,
    p_target_uid,
    LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200),
    p_after_part_no,
    p_after_id,
    p_search
  );
$$;

-- Migrations 0003 and 0004 created these functions after the earlier privilege
-- sweep. Repair them explicitly: Edge compatibility is service-role-only and the
-- new runtime role gets no access to payload-trusting legacy implementations.
DO $$
DECLARE
  function_record RECORD;
  has_anon BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_authenticated BOOLEAN := EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'
  );
  has_service_role BOOLEAN := EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'service_role'
  );
  function_identity TEXT;
BEGIN
  FOR function_record IN
    SELECT
      namespace.nspname AS schema_name,
      procedure.proname AS function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS arguments
    FROM pg_catalog.pg_proc procedure
    INNER JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname IN ('public', 'private')
      AND procedure.proname IN (
        'create_job_with_details',
        'register_business_account'
      )
  LOOP
    function_identity := format(
      '%I.%I(%s)',
      function_record.schema_name,
      function_record.function_name,
      function_record.arguments
    );

    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || function_identity || ' FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || function_identity || ' FROM smart_job_api';
    IF has_anon THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || function_identity || ' FROM anon';
    END IF;
    IF has_authenticated THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || function_identity || ' FROM authenticated';
    END IF;
    IF has_service_role THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || function_identity || ' TO service_role';
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.app_auth_uid() FROM PUBLIC, anon, authenticated, smart_job_api;
REVOKE EXECUTE ON FUNCTION public.prevent_company_profile_vat_update() FROM PUBLIC, anon, authenticated, smart_job_api;
REVOKE EXECUTE ON FUNCTION public.prevent_document_number_mutation() FROM PUBLIC, anon, authenticated, smart_job_api;
REVOKE EXECUTE ON FUNCTION private.cleanup_expired_operational_rows(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, smart_job_api;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
