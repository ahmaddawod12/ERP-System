-- Hardened, API-only first-workspace registration.
-- Identity, role, tier, modules, counters, and membership are derived in SQL.

CREATE OR REPLACE FUNCTION private.register_api_business_account(
  p_verified_email TEXT,
  p_workspace_mode TEXT,
  p_display_name TEXT,
  p_phone_number TEXT,
  p_he_name TEXT,
  p_en_name TEXT,
  p_vat_number TEXT,
  p_business_type TEXT,
  p_city TEXT,
  p_address TEXT,
  p_business_phone TEXT,
  p_business_fax TEXT,
  p_accountant_name TEXT,
  p_accountant_email TEXT,
  p_accountant_phone TEXT
) RETURNS TABLE (
  internal_company_id UUID,
  public_company_id BIGINT,
  tier TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id TEXT := private.app_auth_uid();
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_verified_email, '')));
  v_mode TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_workspace_mode, '')));
  v_display_name TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_display_name, '')), '');
  v_phone_number TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_phone_number, '')), '');
  v_he_name TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_he_name, '')), '');
  v_en_name TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_en_name, '')), '');
  v_vat_number TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_vat_number, '')), '');
  v_business_type TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_business_type, '')), '');
  v_city TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_city, '')), '');
  v_address TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_address, '')), '');
  v_business_phone TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_business_phone, '')), '');
  v_business_fax TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_business_fax, '')), '');
  v_accountant_name TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_accountant_name, '')), '');
  v_accountant_email TEXT := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(COALESCE(p_accountant_email, ''))),
    ''
  );
  v_accountant_phone TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_accountant_phone, '')), '');
  v_account_type public.account_type;
  v_role public.membership_role;
  v_tier public.subscription_tier;
  v_enabled_modules JSONB;
  v_company_id UUID;
  v_public_company_id INTEGER;
  v_member_no INTEGER;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'REGISTRATION_CONTEXT_REQUIRED';
  END IF;

  IF pg_catalog.char_length(v_email) NOT BETWEEN 5 AND 320
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_EMAIL_INVALID';
  END IF;
  IF pg_catalog.char_length(COALESCE(v_display_name, '')) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_DISPLAY_NAME_INVALID';
  END IF;
  IF pg_catalog.char_length(COALESCE(v_phone_number, '')) NOT BETWEEN 6 AND 40 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_PHONE_INVALID';
  END IF;

  CASE v_mode
    WHEN 'basic' THEN
      v_account_type := 'solo'::public.account_type;
      v_role := 'basic'::public.membership_role;
      v_tier := 'Basic'::public.subscription_tier;
    WHEN 'solo' THEN
      v_account_type := 'solo'::public.account_type;
      v_role := 'user'::public.membership_role;
      v_tier := 'Solo'::public.subscription_tier;
    WHEN 'business' THEN
      v_account_type := 'business'::public.account_type;
      v_role := 'manager'::public.membership_role;
      v_tier := 'Team'::public.subscription_tier;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_MODE_INVALID';
  END CASE;

  IF pg_catalog.char_length(COALESCE(v_he_name, '')) > 200
     OR pg_catalog.char_length(COALESCE(v_en_name, '')) > 200
     OR pg_catalog.char_length(COALESCE(v_vat_number, '')) > 32
     OR pg_catalog.char_length(COALESCE(v_business_type, '')) > 120
     OR pg_catalog.char_length(COALESCE(v_city, '')) > 120
     OR pg_catalog.char_length(COALESCE(v_address, '')) > 500
     OR pg_catalog.char_length(COALESCE(v_business_phone, '')) > 40
     OR pg_catalog.char_length(COALESCE(v_business_fax, '')) > 40
     OR pg_catalog.char_length(COALESCE(v_accountant_name, '')) > 200
     OR pg_catalog.char_length(COALESCE(v_accountant_email, '')) > 320
     OR pg_catalog.char_length(COALESCE(v_accountant_phone, '')) > 40 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_PROFILE_INVALID';
  END IF;
  IF v_accountant_email IS NOT NULL
     AND v_accountant_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_ACCOUNTANT_EMAIL_INVALID';
  END IF;

  IF v_mode = 'business' AND (
    v_he_name IS NULL
    OR v_vat_number IS NULL
    OR v_business_type IS NULL
    OR v_address IS NULL
    OR v_business_phone IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_BUSINESS_PROFILE_REQUIRED';
  END IF;

  v_he_name := COALESCE(v_he_name, v_display_name);
  v_en_name := COALESCE(v_en_name, v_he_name);
  v_business_type := COALESCE(v_business_type, v_mode);
  v_business_phone := COALESCE(v_business_phone, v_phone_number);
  v_enabled_modules := pg_catalog.jsonb_build_object(
    'team', v_tier IN ('Team'::public.subscription_tier, 'Enterprise'::public.subscription_tier),
    'solojob', v_tier <> 'Basic'::public.subscription_tier,
    'clients', true,
    'documents', true,
    'teaminventory', v_tier IN ('Team'::public.subscription_tier, 'Enterprise'::public.subscription_tier),
    'companyinventory', v_tier IN ('Team'::public.subscription_tier, 'Enterprise'::public.subscription_tier),
    'inventory', v_tier <> 'Basic'::public.subscription_tier
  );

  -- Serialize first-workspace creation per Auth subject, including requests
  -- that use different idempotency keys.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id, 731927)
  );

  IF EXISTS (
    SELECT 1
    FROM public.company_memberships AS membership
    WHERE membership.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ONBOARDING_ALREADY_COMPLETED';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.app_users AS app_user
    WHERE app_user.id = v_user_id
      AND app_user.system_role IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'REGISTRATION_SYSTEM_USER_FORBIDDEN';
  END IF;

  INSERT INTO public.app_users AS app_user (
    id,
    email,
    display_name,
    phone_number,
    system_role,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_email,
    v_display_name,
    v_phone_number,
    NULL,
    v_now,
    v_now
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      phone_number = EXCLUDED.phone_number,
      updated_at = v_now;

  SELECT private.allocate_system_counter('public_company_id', 1001)
  INTO v_public_company_id;

  INSERT INTO public.companies (
    public_company_id,
    account_type,
    status,
    created_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_public_company_id,
    v_account_type,
    'active',
    v_user_id,
    v_now,
    v_now
  )
  RETURNING id INTO v_company_id;

  INSERT INTO public.company_profiles (
    company_id,
    he_name,
    en_name,
    vat_number,
    business_type,
    city,
    address,
    business_email,
    business_phone,
    business_fax,
    accountant_name,
    accountant_email,
    accountant_phone,
    registered_at,
    registered_by_user_id,
    last_updated_at
  ) VALUES (
    v_company_id,
    v_he_name,
    v_en_name,
    v_vat_number,
    v_business_type,
    v_city,
    v_address,
    v_email,
    v_business_phone,
    v_business_fax,
    v_accountant_name,
    v_accountant_email,
    v_accountant_phone,
    v_now,
    v_user_id,
    v_now
  );

  INSERT INTO public.company_subscriptions (
    company_id,
    tier,
    status,
    enabled_modules,
    updated_at
  ) VALUES (
    v_company_id,
    v_tier,
    'active',
    v_enabled_modules,
    v_now
  );

  INSERT INTO public.company_sync_state (
    company_id,
    jobs_version,
    documents_version,
    clients_version,
    workers_version,
    company_inventory_version,
    updated_at
  ) VALUES (
    v_company_id,
    0,
    0,
    0,
    1,
    0,
    v_now
  );

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
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    v_company_id,
    v_user_id,
    v_member_no,
    v_role,
    'active',
    v_display_name,
    v_phone_number,
    v_now,
    v_now,
    v_now
  );

  RETURN QUERY SELECT
    v_company_id,
    v_public_company_id::BIGINT,
    v_tier::TEXT;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.register_api_business_account(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.register_api_business_account(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO smart_job_api;
