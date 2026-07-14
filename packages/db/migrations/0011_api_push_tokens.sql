-- Stage 3 authenticated viewer push-token mutations.
--
-- The runtime role cannot update public.app_users directly. These narrow
-- SECURITY DEFINER functions derive the only writable user id from the
-- transaction-local API request context and never return the token value.

CREATE OR REPLACE FUNCTION private.upsert_api_push_token(
  p_token TEXT,
  p_platform TEXT
) RETURNS TABLE (
  push_token_platform TEXT,
  push_token_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_token TEXT := pg_catalog.btrim(p_token);
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'API_CONTEXT_USER_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF v_token IS NULL
     OR pg_catalog.char_length(v_token) NOT BETWEEN 8 AND 500 THEN
    RAISE EXCEPTION 'PUSH_TOKEN_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'PUSH_TOKEN_PLATFORM_INVALID'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.app_users AS app_user
  SET
    push_token = v_token,
    push_token_platform = p_platform,
    push_token_updated_at = v_now,
    updated_at = v_now
  WHERE app_user.id = v_uid
  RETURNING
    app_user.push_token_platform::TEXT,
    app_user.push_token_updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PUSH_TOKEN_USER_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.clear_api_push_token()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'API_CONTEXT_USER_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  -- A repeated clear is a no-op, and a missing app-user row is already in the
  -- desired state. Both cases intentionally return success.
  UPDATE public.app_users AS app_user
  SET
    push_token = NULL,
    push_token_platform = NULL,
    push_token_updated_at = NULL,
    updated_at = pg_catalog.clock_timestamp()
  WHERE app_user.id = v_uid
    AND (
      app_user.push_token IS NOT NULL
      OR app_user.push_token_platform IS NOT NULL
      OR app_user.push_token_updated_at IS NOT NULL
    );

  RETURN TRUE;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.upsert_api_push_token(TEXT, TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.clear_api_push_token()
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.upsert_api_push_token(TEXT, TEXT)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.clear_api_push_token()
TO smart_job_api;
