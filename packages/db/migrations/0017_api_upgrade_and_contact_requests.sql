-- Upgrade and contact request APIs for the Node runtime.
--
-- Upgrade authority, current tier, requester role, and application of approved
-- modules are derived in SQL. Anonymous contact writes use one non-user request
-- context only for idempotency isolation and can write through a narrow function.

ALTER TABLE public.upgrade_requests
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE public.upgrade_requests
  ADD CONSTRAINT upgrade_requests_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.increment_upgrade_request_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER upgrade_requests_increment_entity_version
BEFORE UPDATE ON public.upgrade_requests
FOR EACH ROW
EXECUTE FUNCTION private.increment_upgrade_request_entity_version();--> statement-breakpoint

CREATE INDEX upgrade_requests_cursor_idx
  ON public.upgrade_requests (created_at DESC, id DESC);--> statement-breakpoint
CREATE INDEX upgrade_requests_status_cursor_idx
  ON public.upgrade_requests (status, created_at DESC, id DESC);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.api_enabled_modules_for_tier(
  p_tier public.subscription_tier
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'team', p_tier IN (
      'Team'::public.subscription_tier,
      'Enterprise'::public.subscription_tier
    ),
    'solojob', p_tier <> 'Basic'::public.subscription_tier,
    'clients', true,
    'documents', true,
    'teaminventory', p_tier IN (
      'Team'::public.subscription_tier,
      'Enterprise'::public.subscription_tier
    ),
    'companyinventory', p_tier IN (
      'Team'::public.subscription_tier,
      'Enterprise'::public.subscription_tier
    ),
    'inventory', p_tier <> 'Basic'::public.subscription_tier
  );
$$;--> statement-breakpoint

CREATE VIEW private.api_upgrade_request_rows AS
SELECT
  upgrade.id AS request_id,
  upgrade.uid::UUID AS requester_uid,
  upgrade.email AS requester_email,
  company.public_company_id,
  upgrade.role,
  upgrade.current_tier,
  upgrade.requested_tier,
  upgrade.message,
  upgrade.status,
  upgrade.moderation_note,
  upgrade.moderated_at,
  upgrade.moderated_by_name,
  upgrade.applied_at,
  upgrade.entity_version,
  upgrade.created_at,
  upgrade.updated_at,
  pg_catalog.to_char(
    upgrade.created_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  ) AS cursor_created_at
FROM public.upgrade_requests AS upgrade
INNER JOIN public.companies AS company
  ON company.id = upgrade.company_id;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.read_api_upgrade_request(
  p_request_id UUID
) RETURNS TABLE (
  request_id UUID,
  requester_uid UUID,
  requester_email TEXT,
  public_company_id BIGINT,
  role TEXT,
  current_tier TEXT,
  requested_tier TEXT,
  message TEXT,
  status TEXT,
  moderation_note TEXT,
  moderated_at TIMESTAMPTZ,
  moderated_by_name TEXT,
  applied_at TIMESTAMPTZ,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  cursor_created_at TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    row.request_id,
    row.requester_uid,
    row.requester_email::TEXT,
    row.public_company_id,
    row.role::TEXT,
    row.current_tier::TEXT,
    row.requested_tier::TEXT,
    row.message,
    row.status::TEXT,
    row.moderation_note,
    row.moderated_at,
    row.moderated_by_name::TEXT,
    row.applied_at,
    row.entity_version,
    row.created_at,
    row.updated_at,
    row.cursor_created_at
  FROM private.api_upgrade_request_rows AS row
  WHERE row.request_id = p_request_id
    AND (private.app_is_dev() OR row.requester_uid::TEXT = v_uid_text)
  LIMIT 1;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.list_api_upgrade_requests(
  p_status TEXT,
  p_after_created_at TIMESTAMPTZ,
  p_after_id UUID,
  p_limit INTEGER
) RETURNS TABLE (
  request_id UUID,
  requester_uid UUID,
  requester_email TEXT,
  public_company_id BIGINT,
  role TEXT,
  current_tier TEXT,
  requested_tier TEXT,
  message TEXT,
  status TEXT,
  moderation_note TEXT,
  moderated_at TIMESTAMPTZ,
  moderated_by_name TEXT,
  applied_at TIMESTAMPTZ,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  cursor_created_at TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.app_is_dev() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_REQUEST_DEV_REQUIRED';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_STATUS_INVALID';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_CURSOR_INVALID';
  END IF;

  RETURN QUERY
  SELECT
    row.request_id,
    row.requester_uid,
    row.requester_email::TEXT,
    row.public_company_id,
    row.role::TEXT,
    row.current_tier::TEXT,
    row.requested_tier::TEXT,
    row.message,
    row.status::TEXT,
    row.moderation_note,
    row.moderated_at,
    row.moderated_by_name::TEXT,
    row.applied_at,
    row.entity_version,
    row.created_at,
    row.updated_at,
    row.cursor_created_at
  FROM private.api_upgrade_request_rows AS row
  WHERE (p_status IS NULL OR row.status = p_status)
    AND (
      p_after_created_at IS NULL
      OR (row.created_at, row.request_id) < (p_after_created_at, p_after_id)
    )
  ORDER BY row.created_at DESC, row.request_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 201);
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.consume_api_upgrade_request_rate_limit()
RETURNS TABLE (allowed BOOLEAN, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_bucket_number BIGINT;
  v_window_started_at TIMESTAMPTZ;
  v_reset_at TIMESTAMPTZ;
  v_bucket_key TEXT;
  v_hashed_key TEXT;
  v_hit_count INTEGER;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  v_bucket_number := pg_catalog.floor(EXTRACT(EPOCH FROM v_now) / 60)::BIGINT;
  v_window_started_at := pg_catalog.to_timestamp(v_bucket_number * 60);
  v_reset_at := v_window_started_at + INTERVAL '1 minute';
  v_hashed_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('api-upgrade-request:' || v_uid_text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_bucket_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'api-upgrade-request:' || v_uid_text || ':' || v_bucket_number::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.rate_limit_buckets AS bucket (
    bucket_key, hashed_key, window_started_at, hit_count, expire_at, updated_at
  ) VALUES (
    v_bucket_key, v_hashed_key, v_window_started_at, 1,
    v_reset_at + INTERVAL '1 minute', v_now
  )
  ON CONFLICT (bucket_key) DO UPDATE
  SET hit_count = bucket.hit_count + 1,
      expire_at = EXCLUDED.expire_at,
      updated_at = v_now
  RETURNING bucket.hit_count INTO v_hit_count;

  RETURN QUERY SELECT v_hit_count <= 5, v_reset_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_upgrade_request(
  p_company_id UUID,
  p_requested_tier TEXT,
  p_message TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_email TEXT;
  v_role TEXT;
  v_requested_tier public.subscription_tier;
  v_current_tier public.subscription_tier;
  v_message TEXT := pg_catalog.btrim(p_message);
  v_request_id UUID;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid_text IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_CONTEXT_REQUIRED';
  END IF;
  BEGIN
    v_uid := v_uid_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_INVALID';
  END;
  IF v_message IS NULL OR pg_catalog.char_length(v_message) < 10
     OR pg_catalog.char_length(v_message) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_MESSAGE_INVALID';
  END IF;
  IF p_requested_tier IS NULL OR p_requested_tier NOT IN ('Solo', 'Team', 'Enterprise') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_TIER_INVALID';
  END IF;
  v_requested_tier := p_requested_tier::public.subscription_tier;

  SELECT pg_catalog.lower(pg_catalog.btrim(auth_user.email))
  INTO v_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = v_uid
    AND auth_user.email_confirmed_at IS NOT NULL
    AND auth_user.deleted_at IS NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_VERIFIED_EMAIL_REQUIRED';
  END IF;
  IF NOT private.app_has_company_access(p_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_COMPANY_ACCESS_DENIED';
  END IF;

  SELECT membership.role::TEXT
  INTO v_role
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid_text
    AND membership.status = 'active'
  LIMIT 1;
  IF v_role IS NULL THEN
    IF private.app_is_dev() THEN
      v_role := 'dev';
    ELSE
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_MEMBERSHIP_REQUIRED';
    END IF;
  END IF;

  SELECT subscription.tier
  INTO v_current_tier
  FROM public.company_subscriptions AS subscription
  WHERE subscription.company_id = p_company_id
  LIMIT 1;
  IF v_current_tier IS NULL THEN
    v_current_tier := 'Basic'::public.subscription_tier;
  END IF;
  IF v_current_tier = v_requested_tier THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_CURRENT_TIER_MATCH';
  END IF;

  INSERT INTO public.upgrade_requests (
    uid, email, company_id, role, current_tier, requested_tier, message,
    status, created_at, updated_at
  ) VALUES (
    v_uid_text, v_email, p_company_id, v_role, v_current_tier::TEXT,
    v_requested_tier::TEXT, v_message, 'pending', v_now, v_now
  )
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.moderate_api_upgrade_request(
  p_request_id UUID,
  p_status TEXT,
  p_moderation_note TEXT,
  p_expected_entity_version BIGINT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_moderator_name TEXT;
  v_note TEXT := NULLIF(pg_catalog.btrim(p_moderation_note), '');
  v_upgrade public.upgrade_requests%ROWTYPE;
  v_requested_tier public.subscription_tier;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid_text IS NULL OR NOT private.app_is_dev() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_REQUEST_DEV_REQUIRED';
  END IF;
  BEGIN
    v_uid := v_uid_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_INVALID';
  END;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS auth_user
    WHERE auth_user.id = v_uid
      AND auth_user.email_confirmed_at IS NOT NULL
      AND auth_user.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_VERIFIED_EMAIL_REQUIRED';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_STATUS_INVALID';
  END IF;
  IF v_note IS NOT NULL AND pg_catalog.char_length(v_note) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_NOTE_INVALID';
  END IF;

  SELECT upgrade.*
  INTO v_upgrade
  FROM public.upgrade_requests AS upgrade
  WHERE upgrade.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_upgrade.company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPGRADE_REQUEST_NOT_FOUND';
  END IF;
  IF v_upgrade.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'UPGRADE_REQUEST_VERSION_CONFLICT';
  END IF;
  IF v_upgrade.applied_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_REQUEST_ALREADY_APPLIED';
  END IF;

  SELECT COALESCE(
    NULLIF(pg_catalog.btrim(app_user.display_name), ''),
    NULLIF(pg_catalog.btrim(app_user.email), ''),
    v_uid_text
  )
  INTO v_moderator_name
  FROM public.app_users AS app_user
  WHERE app_user.id = v_uid_text;
  v_moderator_name := pg_catalog.left(COALESCE(v_moderator_name, v_uid_text), 200);

  IF p_status = 'approved' THEN
    v_requested_tier := v_upgrade.requested_tier::public.subscription_tier;
    UPDATE public.company_subscriptions AS subscription
    SET tier = v_requested_tier,
        status = 'active',
        enabled_modules = private.api_enabled_modules_for_tier(v_requested_tier),
        updated_at = v_now
    WHERE subscription.company_id = v_upgrade.company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPGRADE_SUBSCRIPTION_NOT_FOUND';
    END IF;
  END IF;

  UPDATE public.upgrade_requests AS upgrade
  SET status = p_status,
      moderation_note = v_note,
      moderated_at = v_now,
      moderated_by_uid = v_uid_text,
      moderated_by_name = v_moderator_name,
      applied_at = CASE WHEN p_status = 'approved' THEN v_now ELSE NULL END,
      applied_by_uid = CASE WHEN p_status = 'approved' THEN v_uid_text ELSE NULL END,
      updated_at = v_now
  WHERE upgrade.id = p_request_id;

  RETURN p_request_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.consume_api_contact_request_rate_limit(
  p_email TEXT
) RETURNS TABLE (allowed BOOLEAN, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_context_uid TEXT := private.app_auth_uid();
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_bucket_number BIGINT;
  v_window_started_at TIMESTAMPTZ;
  v_reset_at TIMESTAMPTZ;
  v_bucket_key TEXT;
  v_hashed_key TEXT;
  v_hit_count INTEGER;
BEGIN
  IF v_context_uid <> '00000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CONTACT_ANONYMOUS_CONTEXT_REQUIRED';
  END IF;
  IF v_email IS NULL OR pg_catalog.char_length(v_email) > 320
     OR pg_catalog.strpos(v_email, '@') <= 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTACT_EMAIL_INVALID';
  END IF;

  v_bucket_number := pg_catalog.floor(EXTRACT(EPOCH FROM v_now) / 60)::BIGINT;
  v_window_started_at := pg_catalog.to_timestamp(v_bucket_number * 60);
  v_reset_at := v_window_started_at + INTERVAL '1 minute';
  v_hashed_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('api-contact-request:' || v_email, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_bucket_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'api-contact-request:' || v_email || ':' || v_bucket_number::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.rate_limit_buckets AS bucket (
    bucket_key, hashed_key, window_started_at, hit_count, expire_at, updated_at
  ) VALUES (
    v_bucket_key, v_hashed_key, v_window_started_at, 1,
    v_reset_at + INTERVAL '1 minute', v_now
  )
  ON CONFLICT (bucket_key) DO UPDATE
  SET hit_count = bucket.hit_count + 1,
      expire_at = EXCLUDED.expire_at,
      updated_at = v_now
  RETURNING bucket.hit_count INTO v_hit_count;

  RETURN QUERY SELECT v_hit_count <= 5, v_reset_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_contact_request(
  p_name TEXT,
  p_email TEXT,
  p_company TEXT,
  p_subject TEXT,
  p_message TEXT
) RETURNS TABLE (request_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_context_uid TEXT := private.app_auth_uid();
  v_name TEXT := pg_catalog.btrim(p_name);
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_company TEXT := pg_catalog.btrim(p_company);
  v_subject TEXT := NULLIF(pg_catalog.btrim(p_subject), '');
  v_message TEXT := pg_catalog.btrim(p_message);
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_context_uid <> '00000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CONTACT_ANONYMOUS_CONTEXT_REQUIRED';
  END IF;
  IF v_name IS NULL OR pg_catalog.char_length(v_name) < 2
     OR pg_catalog.char_length(v_name) > 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTACT_NAME_INVALID';
  END IF;
  IF v_email IS NULL OR pg_catalog.char_length(v_email) > 320
     OR pg_catalog.strpos(v_email, '@') <= 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTACT_EMAIL_INVALID';
  END IF;
  IF v_company IS NULL OR pg_catalog.char_length(v_company) < 2
     OR pg_catalog.char_length(v_company) > 140 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTACT_COMPANY_INVALID';
  END IF;
  IF v_subject IS NOT NULL AND (
    pg_catalog.char_length(v_subject) < 2 OR pg_catalog.char_length(v_subject) > 500
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTACT_SUBJECT_INVALID';
  END IF;
  IF v_message IS NULL OR pg_catalog.char_length(v_message) < 8
     OR pg_catalog.char_length(v_message) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTACT_MESSAGE_INVALID';
  END IF;

  INSERT INTO public.contact_requests (
    name, email, company, subject, message, status, created_at, updated_at, expire_at
  ) VALUES (
    v_name, v_email, v_company, v_subject, v_message, 'new', v_now, v_now,
    v_now + INTERVAL '180 days'
  )
  RETURNING id, public.contact_requests.created_at
  INTO request_id, created_at;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

REVOKE ALL ON private.api_upgrade_request_rows
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.increment_upgrade_request_entity_version()
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.api_enabled_modules_for_tier(public.subscription_tier)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.read_api_upgrade_request(UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.list_api_upgrade_requests(TEXT, TIMESTAMPTZ, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.consume_api_upgrade_request_rate_limit()
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.create_api_upgrade_request(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.moderate_api_upgrade_request(UUID, TEXT, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.consume_api_contact_request_rate_limit(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.create_api_contact_request(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.read_api_upgrade_request(UUID)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.list_api_upgrade_requests(TEXT, TIMESTAMPTZ, UUID, INTEGER)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.consume_api_upgrade_request_rate_limit()
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.create_api_upgrade_request(UUID, TEXT, TEXT)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.moderate_api_upgrade_request(UUID, TEXT, TEXT, BIGINT)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.consume_api_contact_request_rate_limit(TEXT)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.create_api_contact_request(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO smart_job_api;
