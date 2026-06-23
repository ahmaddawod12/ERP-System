-- Phase 1: atomic business registration.
-- Replaces the edge handler's multi-step company onboarding with a single transaction.

CREATE OR REPLACE FUNCTION private.register_business_account(
  p_public_company_id INTEGER,
  p_account_type public.account_type,
  p_created_by_user_id TEXT,
  p_he_name VARCHAR(200),
  p_en_name VARCHAR(200),
  p_vat_number VARCHAR(50),
  p_business_type VARCHAR(120),
  p_city VARCHAR(120),
  p_address VARCHAR(500),
  p_business_email VARCHAR(320),
  p_business_phone VARCHAR(40),
  p_business_fax VARCHAR(40),
  p_accountant_name VARCHAR(200),
  p_accountant_email VARCHAR(320),
  p_accountant_phone VARCHAR(40),
  p_tier TEXT,
  p_enabled_modules JSONB,
  p_user_id TEXT,
  p_role TEXT,
  p_display_name VARCHAR(200),
  p_phone_number VARCHAR(40),
  p_created_at TIMESTAMPTZ
) RETURNS TABLE (
  company_id UUID,
  public_company_id INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_member_no INTEGER;
BEGIN
  INSERT INTO companies (
    public_company_id,
    account_type,
    status,
    created_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    p_public_company_id,
    p_account_type,
    'active',
    p_created_by_user_id,
    p_created_at,
    p_created_at
  )
  RETURNING id INTO v_company_id;

  INSERT INTO company_profiles (
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
    p_he_name,
    p_en_name,
    p_vat_number,
    p_business_type,
    p_city,
    p_address,
    p_business_email,
    p_business_phone,
    p_business_fax,
    p_accountant_name,
    p_accountant_email,
    p_accountant_phone,
    p_created_at,
    p_created_by_user_id,
    p_created_at
  );

  INSERT INTO company_subscriptions (
    company_id,
    tier,
    status,
    enabled_modules,
    updated_at
  ) VALUES (
    v_company_id,
    p_tier,
    'active',
    COALESCE(p_enabled_modules, '{}'::jsonb),
    p_created_at
  );

  INSERT INTO company_sync_state (
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
    p_created_at
  );

  SELECT allocate_company_counter(v_company_id, 'member_no'::counter_key)
  INTO v_member_no;

  INSERT INTO company_memberships (
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
    p_user_id,
    v_member_no,
    p_role,
    'active',
    p_display_name,
    p_phone_number,
    p_created_at,
    p_created_at,
    p_created_at
  );

  RETURN QUERY
  SELECT
    c.id,
    c.public_company_id
  FROM companies c
  WHERE c.id = v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_business_account(
  p_public_company_id INTEGER,
  p_account_type public.account_type,
  p_created_by_user_id TEXT,
  p_he_name VARCHAR(200),
  p_en_name VARCHAR(200),
  p_vat_number VARCHAR(50),
  p_business_type VARCHAR(120),
  p_city VARCHAR(120),
  p_address VARCHAR(500),
  p_business_email VARCHAR(320),
  p_business_phone VARCHAR(40),
  p_business_fax VARCHAR(40),
  p_accountant_name VARCHAR(200),
  p_accountant_email VARCHAR(320),
  p_accountant_phone VARCHAR(40),
  p_tier TEXT,
  p_enabled_modules JSONB,
  p_user_id TEXT,
  p_role TEXT,
  p_display_name VARCHAR(200),
  p_phone_number VARCHAR(40),
  p_created_at TIMESTAMPTZ
) RETURNS TABLE (
  company_id UUID,
  public_company_id INTEGER
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT *
  FROM private.register_business_account(
    p_public_company_id,
    p_account_type,
    p_created_by_user_id,
    p_he_name,
    p_en_name,
    p_vat_number,
    p_business_type,
    p_city,
    p_address,
    p_business_email,
    p_business_phone,
    p_business_fax,
    p_accountant_name,
    p_accountant_email,
    p_accountant_phone,
    p_tier,
    p_enabled_modules,
    p_user_id,
    p_role,
    p_display_name,
    p_phone_number,
    p_created_at
  );
$$;
