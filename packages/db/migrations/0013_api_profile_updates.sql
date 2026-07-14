-- Narrow authenticated profile mutations for the Node API.
--
-- The runtime role keeps read-only access to public profile tables. These
-- SECURITY DEFINER functions derive the caller from the transaction-local API
-- context, validate an explicit JSON patch allowlist, and retain the immutable
-- VAT boundary established during onboarding.

ALTER TABLE public.company_profiles
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT company_profiles_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.increment_company_profile_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER company_profiles_increment_entity_version
BEFORE UPDATE ON public.company_profiles
FOR EACH ROW
EXECUTE FUNCTION private.increment_company_profile_entity_version();--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.update_api_viewer_profile(
  p_company_id UUID,
  p_patch JSONB
) RETURNS TABLE (
  uid UUID,
  email TEXT,
  display_name TEXT,
  phone_number TEXT,
  system_role TEXT,
  public_company_id BIGINT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_user public.app_users%ROWTYPE;
  v_public_company_id BIGINT;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_PATCH_INVALID';
  END IF;
  IF NOT (p_patch ? 'displayName' OR p_patch ? 'phoneNumber')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_object_keys(p_patch) AS patch_key(key)
       WHERE patch_key.key NOT IN ('displayName', 'phoneNumber')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_PATCH_FIELDS_INVALID';
  END IF;
  IF p_patch ? 'displayName'
     AND pg_catalog.jsonb_typeof(p_patch -> 'displayName') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_DISPLAY_NAME_INVALID';
  END IF;
  IF p_patch ? 'phoneNumber'
     AND pg_catalog.jsonb_typeof(p_patch -> 'phoneNumber') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_PHONE_NUMBER_INVALID';
  END IF;
  IF p_patch ? 'displayName'
     AND p_patch ->> 'displayName' IS NOT NULL
     AND (
       pg_catalog.btrim(p_patch ->> 'displayName') = ''
       OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'displayName')) > 200
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_DISPLAY_NAME_INVALID';
  END IF;
  IF p_patch ? 'phoneNumber'
     AND p_patch ->> 'phoneNumber' IS NOT NULL
     AND (
       pg_catalog.btrim(p_patch ->> 'phoneNumber') = ''
       OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'phoneNumber')) > 40
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_PHONE_NUMBER_INVALID';
  END IF;

  IF p_company_id IS NOT NULL THEN
    IF NOT private.app_has_company_access(p_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PROFILE_COMPANY_ACCESS_DENIED';
    END IF;
    SELECT company.public_company_id
    INTO v_public_company_id
    FROM public.companies AS company
    WHERE company.id = p_company_id
      AND company.status = 'active';
    IF v_public_company_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PROFILE_COMPANY_NOT_FOUND';
    END IF;
  END IF;

  UPDATE public.app_users AS app_user
  SET
    display_name = CASE
      WHEN p_patch ? 'displayName'
        THEN NULLIF(pg_catalog.btrim(p_patch ->> 'displayName'), '')
      ELSE app_user.display_name
    END,
    phone_number = CASE
      WHEN p_patch ? 'phoneNumber'
        THEN NULLIF(pg_catalog.btrim(p_patch ->> 'phoneNumber'), '')
      ELSE app_user.phone_number
    END,
    updated_at = pg_catalog.clock_timestamp()
  WHERE app_user.id = v_uid_text
  RETURNING app_user.* INTO v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PROFILE_USER_NOT_FOUND';
  END IF;

  IF p_company_id IS NOT NULL THEN
    UPDATE public.company_memberships AS membership
    SET
      display_name = CASE
        WHEN p_patch ? 'displayName' THEN v_user.display_name
        ELSE membership.display_name
      END,
      phone_number = CASE
        WHEN p_patch ? 'phoneNumber' THEN v_user.phone_number
        ELSE membership.phone_number
      END,
      updated_at = v_user.updated_at
    WHERE membership.company_id = p_company_id
      AND membership.user_id = v_uid_text
      AND membership.status = 'active';
  END IF;

  RETURN QUERY SELECT
    v_user.id::UUID,
    v_user.email::TEXT,
    v_user.display_name::TEXT,
    v_user.phone_number::TEXT,
    v_user.system_role::TEXT,
    v_public_company_id,
    v_user.updated_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.update_api_company_profile(
  p_company_id UUID,
  p_expected_entity_version BIGINT,
  p_patch JSONB
) RETURNS TABLE (
  public_company_id BIGINT,
  he_name TEXT,
  en_name TEXT,
  vat_number TEXT,
  business_type TEXT,
  city TEXT,
  address TEXT,
  business_email TEXT,
  business_phone TEXT,
  business_fax TEXT,
  accountant_name TEXT,
  accountant_email TEXT,
  accountant_phone TEXT,
  entity_version BIGINT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.company_profiles%ROWTYPE;
  v_public_company_id BIGINT;
  v_key TEXT;
  v_value TEXT;
  v_max_length INTEGER;
BEGIN
  IF private.app_auth_uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_PROFILE_COMPANY_REQUIRED';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_PROFILE_VERSION_INVALID';
  END IF;
  IF NOT private.app_is_company_manager(p_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'COMPANY_PROFILE_MANAGER_REQUIRED';
  END IF;
  IF p_patch IS NULL
     OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
     OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_PROFILE_PATCH_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS patch_key(key)
    WHERE patch_key.key NOT IN (
      'heName',
      'enName',
      'businessType',
      'city',
      'address',
      'businessEmail',
      'businessPhone',
      'businessFax',
      'accountantName',
      'accountantEmail',
      'accountantPhone'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_PROFILE_PATCH_FIELDS_INVALID';
  END IF;

  FOR v_key, v_max_length IN
    SELECT * FROM (VALUES
      ('heName', 200),
      ('enName', 200),
      ('businessType', 120),
      ('city', 120),
      ('address', 500),
      ('businessEmail', 320),
      ('businessPhone', 40),
      ('businessFax', 40),
      ('accountantName', 200),
      ('accountantEmail', 320),
      ('accountantPhone', 40)
    ) AS allowed_field(key, max_length)
  LOOP
    IF p_patch ? v_key THEN
      IF pg_catalog.jsonb_typeof(p_patch -> v_key) NOT IN ('string', 'null') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_PROFILE_FIELD_INVALID';
      END IF;
      v_value := p_patch ->> v_key;
      IF v_value IS NOT NULL
         AND (
           pg_catalog.btrim(v_value) = ''
           OR pg_catalog.char_length(pg_catalog.btrim(v_value)) > v_max_length
         ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_PROFILE_FIELD_INVALID';
      END IF;
    END IF;
  END LOOP;

  SELECT company.public_company_id
  INTO v_public_company_id
  FROM public.companies AS company
  WHERE company.id = p_company_id
    AND company.status = 'active';
  IF v_public_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'COMPANY_PROFILE_COMPANY_NOT_FOUND';
  END IF;

  UPDATE public.company_profiles AS profile
  SET
    he_name = CASE WHEN p_patch ? 'heName' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'heName'), '') ELSE profile.he_name END,
    en_name = CASE WHEN p_patch ? 'enName' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'enName'), '') ELSE profile.en_name END,
    business_type = CASE WHEN p_patch ? 'businessType' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'businessType'), '') ELSE profile.business_type END,
    city = CASE WHEN p_patch ? 'city' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'city'), '') ELSE profile.city END,
    address = CASE WHEN p_patch ? 'address' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'address'), '') ELSE profile.address END,
    business_email = CASE WHEN p_patch ? 'businessEmail' THEN NULLIF(pg_catalog.lower(pg_catalog.btrim(p_patch ->> 'businessEmail')), '') ELSE profile.business_email END,
    business_phone = CASE WHEN p_patch ? 'businessPhone' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'businessPhone'), '') ELSE profile.business_phone END,
    business_fax = CASE WHEN p_patch ? 'businessFax' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'businessFax'), '') ELSE profile.business_fax END,
    accountant_name = CASE WHEN p_patch ? 'accountantName' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'accountantName'), '') ELSE profile.accountant_name END,
    accountant_email = CASE WHEN p_patch ? 'accountantEmail' THEN NULLIF(pg_catalog.lower(pg_catalog.btrim(p_patch ->> 'accountantEmail')), '') ELSE profile.accountant_email END,
    accountant_phone = CASE WHEN p_patch ? 'accountantPhone' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'accountantPhone'), '') ELSE profile.accountant_phone END,
    last_updated_at = pg_catalog.clock_timestamp()
  WHERE profile.company_id = p_company_id
    AND profile.entity_version = p_expected_entity_version
  RETURNING profile.* INTO v_profile;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.company_profiles AS existing_profile
      WHERE existing_profile.company_id = p_company_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'COMPANY_PROFILE_VERSION_CONFLICT';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'COMPANY_PROFILE_NOT_FOUND';
  END IF;

  RETURN QUERY SELECT
    v_public_company_id,
    v_profile.he_name::TEXT,
    v_profile.en_name::TEXT,
    v_profile.vat_number::TEXT,
    v_profile.business_type::TEXT,
    v_profile.city::TEXT,
    v_profile.address::TEXT,
    v_profile.business_email::TEXT,
    v_profile.business_phone::TEXT,
    v_profile.business_fax::TEXT,
    v_profile.accountant_name::TEXT,
    v_profile.accountant_email::TEXT,
    v_profile.accountant_phone::TEXT,
    v_profile.entity_version,
    v_profile.last_updated_at;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.update_api_viewer_profile(UUID, JSONB)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.update_api_company_profile(UUID, BIGINT, JSONB)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.update_api_viewer_profile(UUID, JSONB)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.update_api_company_profile(UUID, BIGINT, JSONB)
TO smart_job_api;
