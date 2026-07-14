-- Hardened invitation creation and redemption for the Node API.
--
-- Both functions derive the caller from transaction-local request context and
-- require a live, verified Supabase Auth email. The runtime role receives no
-- direct write access to public invitation, membership, profile, or inventory
-- tables. Public company ids are resolved to internal UUIDs inside SQL.

CREATE OR REPLACE FUNCTION private.consume_api_invitation_rate_limit(
  p_operation TEXT
) RETURNS TABLE (
  allowed BOOLEAN,
  reset_at TIMESTAMPTZ
)
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
  IF p_operation IS NULL OR p_operation NOT IN ('create', 'redeem') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_RATE_LIMIT_OPERATION_INVALID';
  END IF;

  v_bucket_number := pg_catalog.floor(EXTRACT(EPOCH FROM v_now) / 60)::BIGINT;
  v_window_started_at := pg_catalog.to_timestamp(v_bucket_number * 60);
  v_reset_at := v_window_started_at + INTERVAL '1 minute';
  v_hashed_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'invitation:' || p_operation || ':' || v_uid_text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_bucket_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'invitation:' || p_operation || ':' || v_uid_text || ':' || v_bucket_number::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.rate_limit_buckets AS bucket (
    bucket_key,
    hashed_key,
    window_started_at,
    hit_count,
    expire_at,
    updated_at
  ) VALUES (
    v_bucket_key,
    v_hashed_key,
    v_window_started_at,
    1,
    v_reset_at + INTERVAL '1 minute',
    v_now
  )
  ON CONFLICT (bucket_key) DO UPDATE
  SET hit_count = bucket.hit_count + 1,
      expire_at = EXCLUDED.expire_at,
      updated_at = v_now
  RETURNING bucket.hit_count INTO v_hit_count;

  -- Return instead of raising so the caller can commit this limiter
  -- transaction before mapping the denial to HTTP 429.
  RETURN QUERY SELECT v_hit_count <= 10, v_reset_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_company_invitation(
  p_company_id UUID,
  p_target_role TEXT,
  p_target_email TEXT DEFAULT NULL,
  p_expires_in_days INTEGER DEFAULT 30
) RETURNS TABLE (
  invite_id UUID,
  invite_code TEXT,
  target_role TEXT,
  status TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_verified_email TEXT;
  v_creator_membership_id UUID;
  v_is_dev BOOLEAN := false;
  v_team_enabled BOOLEAN := false;
  v_target_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_target_email));
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_expires_at TIMESTAMPTZ;
  v_invite_id UUID;
  v_invite_code TEXT;
  v_attempt INTEGER := 0;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  BEGIN
    v_uid := v_uid_text::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_INVALID';
  END;

  SELECT pg_catalog.lower(pg_catalog.btrim(auth_user.email))
  INTO v_verified_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = v_uid
    AND auth_user.email IS NOT NULL
    AND auth_user.email_confirmed_at IS NOT NULL
    AND auth_user.deleted_at IS NULL
    AND NOT auth_user.is_anonymous
  FOR KEY SHARE OF auth_user;

  IF v_verified_email IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EMAIL_VERIFICATION_REQUIRED';
  END IF;
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_ID_INVALID';
  END IF;
  IF p_target_role IS NULL
     OR p_target_role NOT IN ('manager', 'worker', 'user', 'basic') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_ROLE_INVALID';
  END IF;
  IF p_expires_in_days IS NULL OR p_expires_in_days NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_EXPIRY_INVALID';
  END IF;
  IF p_target_email IS NOT NULL AND (
    v_target_email IS NULL
    OR pg_catalog.char_length(v_target_email) NOT BETWEEN 3 AND 320
    OR v_target_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_EMAIL_INVALID';
  END IF;

  SELECT private.app_is_dev() INTO v_is_dev;
  SELECT membership.id
  INTO v_creator_membership_id
  FROM public.company_memberships AS membership
  INNER JOIN public.companies AS company
    ON company.id = membership.company_id
   AND company.status = 'active'
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid_text
    AND membership.status = 'active'
    AND membership.role = 'manager'
  LIMIT 1
  FOR KEY SHARE OF membership, company;

  IF v_creator_membership_id IS NULL AND NOT v_is_dev THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVITATION_MANAGER_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.companies AS company
    WHERE company.id = p_company_id
      AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'COMPANY_NOT_FOUND';
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
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVITATIONS_MODULE_DISABLED';
  END IF;

  v_expires_at := v_now + pg_catalog.make_interval(days => p_expires_in_days);
  WHILE v_attempt < 5 LOOP
    v_attempt := v_attempt + 1;
    v_invite_code := pg_catalog.upper(
      pg_catalog.encode(extensions.gen_random_bytes(10), 'hex')
    );
    BEGIN
      INSERT INTO public.company_invites (
        company_id,
        code,
        target_role,
        status,
        invited_email,
        created_by_membership_id,
        expires_at,
        created_at
      ) VALUES (
        p_company_id,
        v_invite_code,
        p_target_role::public.membership_role,
        'active',
        v_target_email,
        v_creator_membership_id,
        v_expires_at,
        v_now
      )
      RETURNING id INTO v_invite_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        v_invite_id := NULL;
    END;
  END LOOP;

  IF v_invite_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITATION_CODE_GENERATION_FAILED';
  END IF;

  RETURN QUERY SELECT
    v_invite_id,
    v_invite_code,
    p_target_role,
    'active'::TEXT,
    v_expires_at,
    v_now;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.redeem_api_company_invitation(
  p_public_company_id BIGINT,
  p_invite_code TEXT,
  p_display_name TEXT DEFAULT NULL,
  p_phone_number TEXT DEFAULT NULL
) RETURNS TABLE (
  internal_company_id UUID,
  public_company_id BIGINT,
  membership_id UUID,
  member_no INTEGER,
  role TEXT,
  display_name TEXT,
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_verified_email TEXT;
  v_company_id UUID;
  v_code TEXT := pg_catalog.upper(pg_catalog.btrim(p_invite_code));
  v_display_name TEXT := NULLIF(pg_catalog.btrim(p_display_name), '');
  v_phone_number TEXT := NULLIF(pg_catalog.btrim(p_phone_number), '');
  v_profile_display_name TEXT;
  v_profile_phone_number TEXT;
  v_invite public.company_invites%ROWTYPE;
  v_existing public.company_memberships%ROWTYPE;
  v_membership public.company_memberships%ROWTYPE;
  v_invited_by_user_id TEXT;
  v_member_no INTEGER;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  BEGIN
    v_uid := v_uid_text::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_INVALID';
  END;

  SELECT pg_catalog.lower(pg_catalog.btrim(auth_user.email))
  INTO v_verified_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = v_uid
    AND auth_user.email IS NOT NULL
    AND auth_user.email_confirmed_at IS NOT NULL
    AND auth_user.deleted_at IS NULL
    AND NOT auth_user.is_anonymous
  FOR KEY SHARE OF auth_user;

  IF v_verified_email IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EMAIL_VERIFICATION_REQUIRED';
  END IF;
  IF p_public_company_id IS NULL OR p_public_company_id < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_ID_INVALID';
  END IF;
  IF v_code IS NULL OR pg_catalog.char_length(v_code) NOT BETWEEN 4 AND 80 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_CODE_INVALID';
  END IF;
  IF v_display_name IS NOT NULL AND pg_catalog.char_length(v_display_name) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_DISPLAY_NAME_INVALID';
  END IF;
  IF v_phone_number IS NOT NULL
     AND pg_catalog.char_length(v_phone_number) NOT BETWEEN 3 AND 40 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_PHONE_INVALID';
  END IF;

  SELECT company.id
  INTO v_company_id
  FROM public.companies AS company
  WHERE company.public_company_id = p_public_company_id
    AND company.status = 'active'
  LIMIT 1
  FOR KEY SHARE OF company;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'COMPANY_NOT_FOUND';
  END IF;

  -- Serialize the same Auth subject joining the same company even when two
  -- different invitation codes are submitted concurrently.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_company_id::TEXT || ':' || v_uid_text, 812731)
  );

  SELECT invitation.*
  INTO v_invite
  FROM public.company_invites AS invitation
  WHERE invitation.company_id = v_company_id
    AND invitation.code = v_code
  LIMIT 1
  FOR UPDATE OF invitation;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVITATION_NOT_FOUND';
  END IF;

  -- A successful same-subject retry remains replayable after the original
  -- expiry timestamp. A different subject never learns who consumed it.
  IF v_invite.status = 'used' THEN
    IF v_invite.used_by_user_id <> v_uid_text THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITATION_ALREADY_USED';
    END IF;

    SELECT membership.*
    INTO v_existing
    FROM public.company_memberships AS membership
    WHERE membership.company_id = v_company_id
      AND membership.user_id = v_uid_text
      AND membership.status = 'active'
    ORDER BY membership.joined_at ASC, membership.created_at ASC
    LIMIT 1
    FOR KEY SHARE OF membership;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITATION_ALREADY_USED';
    END IF;

    RETURN QUERY SELECT
      v_company_id,
      p_public_company_id,
      v_existing.id,
      v_existing.member_no,
      v_existing.role::TEXT,
      v_existing.display_name::TEXT,
      v_existing.joined_at;
    RETURN;
  END IF;

  IF v_invite.status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITATION_INACTIVE';
  END IF;
  IF v_invite.expires_at <= v_now THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITATION_EXPIRED';
  END IF;
  IF v_invite.invited_email IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(v_invite.invited_email)) <> v_verified_email THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVITATION_EMAIL_MISMATCH';
  END IF;
  IF v_invite.target_role NOT IN ('manager', 'worker', 'user', 'basic') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_ROLE_INVALID';
  END IF;

  SELECT membership.*
  INTO v_existing
  FROM public.company_memberships AS membership
  WHERE membership.company_id = v_company_id
    AND membership.user_id = v_uid_text
    AND membership.status = 'active'
  ORDER BY membership.joined_at ASC, membership.created_at ASC
  LIMIT 1
  FOR KEY SHARE OF membership;

  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORKSPACE_MEMBERSHIP_EXISTS';
  END IF;

  SELECT app_user.display_name, app_user.phone_number
  INTO v_profile_display_name, v_profile_phone_number
  FROM public.app_users AS app_user
  WHERE app_user.id = v_uid_text;

  v_display_name := COALESCE(
    v_display_name,
    v_profile_display_name,
    pg_catalog.left(v_verified_email, 200)
  );
  v_phone_number := COALESCE(v_phone_number, v_profile_phone_number);

  INSERT INTO public.app_users AS app_user (
    id,
    email,
    display_name,
    phone_number,
    created_at,
    updated_at
  ) VALUES (
    v_uid_text,
    v_verified_email,
    v_display_name,
    v_phone_number,
    v_now,
    v_now
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      display_name = COALESCE(EXCLUDED.display_name, app_user.display_name),
      phone_number = COALESCE(EXCLUDED.phone_number, app_user.phone_number),
      updated_at = v_now;

  SELECT creator.user_id
  INTO v_invited_by_user_id
  FROM public.company_memberships AS creator
  WHERE creator.id = v_invite.created_by_membership_id;

  SELECT private.allocate_company_counter(v_company_id, 'member_no')
  INTO v_member_no;

  INSERT INTO public.company_memberships (
    company_id,
    user_id,
    member_no,
    role,
    status,
    display_name,
    phone_number,
    invited_by_user_id,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    v_company_id,
    v_uid_text,
    v_member_no,
    v_invite.target_role,
    'active',
    v_display_name,
    v_phone_number,
    v_invited_by_user_id,
    v_now,
    v_now,
    v_now
  )
  RETURNING * INTO v_membership;

  INSERT INTO public.inventory_locations (
    company_id,
    location_type,
    membership_id,
    name,
    created_at
  ) VALUES (
    v_company_id,
    'member',
    v_membership.id,
    v_display_name,
    v_now
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.company_invites AS invitation
  SET status = 'used',
      used_by_user_id = v_uid_text,
      used_at = v_now
  WHERE invitation.id = v_invite.id
    AND invitation.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITATION_INACTIVE';
  END IF;

  PERFORM private.bump_company_sync_version(v_company_id, 'workers_version');

  RETURN QUERY SELECT
    v_company_id,
    p_public_company_id,
    v_membership.id,
    v_membership.member_no,
    v_membership.role::TEXT,
    v_membership.display_name::TEXT,
    v_membership.joined_at;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.create_api_company_invitation(UUID, TEXT, TEXT, INTEGER)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.redeem_api_company_invitation(BIGINT, TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.consume_api_invitation_rate_limit(TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.create_api_company_invitation(UUID, TEXT, TEXT, INTEGER)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.redeem_api_company_invitation(BIGINT, TEXT, TEXT, TEXT)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.consume_api_invitation_rate_limit(TEXT)
TO smart_job_api;
