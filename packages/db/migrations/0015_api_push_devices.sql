-- Per-device push registration for the Node API.
--
-- A single user-column token cannot represent multiple devices and permits a
-- recycled provider token to remain owned by a previous account. Keep provider
-- tokens in a private table, uniquely bind each token to one owner/device, and
-- clear only the current installation during logout.

CREATE TABLE private.push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  device_id_hash BYTEA NOT NULL,
  push_token VARCHAR(500) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT push_devices_device_hash_length_check
    CHECK (octet_length(device_id_hash) = 32),
  CONSTRAINT push_devices_token_present_check
    CHECK (char_length(btrim(push_token)) BETWEEN 8 AND 500),
  CONSTRAINT push_devices_platform_check
    CHECK (platform IN ('ios', 'android')),
  CONSTRAINT push_devices_user_device_unique UNIQUE (user_id, device_id_hash),
  CONSTRAINT push_devices_token_unique UNIQUE (push_token)
);--> statement-breakpoint

CREATE INDEX push_devices_user_updated_idx
  ON private.push_devices (user_id, updated_at DESC);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.register_api_push_device(
  p_device_id TEXT,
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
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_device_id TEXT := pg_catalog.btrim(p_device_id);
  v_token TEXT := pg_catalog.btrim(p_token);
  v_device_hash BYTEA;
  v_token_lock BIGINT;
  v_device_lock BIGINT;
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
  IF NOT EXISTS (
    SELECT 1 FROM public.app_users AS app_user WHERE app_user.id = v_uid_text
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PUSH_DEVICE_USER_NOT_FOUND';
  END IF;
  IF v_device_id IS NULL
     OR pg_catalog.char_length(v_device_id) NOT BETWEEN 16 AND 128
     OR v_device_id !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PUSH_DEVICE_ID_INVALID';
  END IF;
  IF v_token IS NULL OR pg_catalog.char_length(v_token) NOT BETWEEN 8 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PUSH_DEVICE_TOKEN_INVALID';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PUSH_DEVICE_PLATFORM_INVALID';
  END IF;

  v_device_hash := extensions.digest(
    pg_catalog.convert_to(v_device_id, 'UTF8'),
    'sha256'
  );
  v_token_lock := pg_catalog.hashtextextended('push-token:' || v_token, 0);
  v_device_lock := pg_catalog.hashtextextended(
    'push-device:' || v_uid::TEXT || ':' || pg_catalog.encode(v_device_hash, 'hex'),
    0
  );
  IF v_token_lock <= v_device_lock THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(v_token_lock);
    PERFORM pg_catalog.pg_advisory_xact_lock(v_device_lock);
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(v_device_lock);
    PERFORM pg_catalog.pg_advisory_xact_lock(v_token_lock);
  END IF;

  -- This atomically transfers a provider token away from a previous account and
  -- replaces an old token for the same installation.
  DELETE FROM private.push_devices AS device
  WHERE device.push_token = v_token
     OR (device.user_id = v_uid AND device.device_id_hash = v_device_hash);

  INSERT INTO private.push_devices (
    user_id,
    device_id_hash,
    push_token,
    platform,
    created_at,
    updated_at
  ) VALUES (
    v_uid,
    v_device_hash,
    v_token,
    p_platform,
    v_now,
    v_now
  );

  RETURN QUERY SELECT p_platform, v_now;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.clear_api_push_device(
  p_device_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_device_id TEXT := pg_catalog.btrim(p_device_id);
  v_device_hash BYTEA;
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
  IF v_device_id IS NULL
     OR pg_catalog.char_length(v_device_id) NOT BETWEEN 16 AND 128
     OR v_device_id !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PUSH_DEVICE_ID_INVALID';
  END IF;

  v_device_hash := extensions.digest(
    pg_catalog.convert_to(v_device_id, 'UTF8'),
    'sha256'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'push-device:' || v_uid::TEXT || ':' || pg_catalog.encode(v_device_hash, 'hex'),
      0
    )
  );
  DELETE FROM private.push_devices AS device
  WHERE device.user_id = v_uid
    AND device.device_id_hash = v_device_hash;

  RETURN TRUE;
END;
$$;--> statement-breakpoint

REVOKE ALL ON TABLE private.push_devices
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.upsert_api_push_token(TEXT, TEXT)
FROM smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.clear_api_push_token()
FROM smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.register_api_push_device(TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.clear_api_push_device(TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.register_api_push_device(TEXT, TEXT, TEXT)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.clear_api_push_device(TEXT)
TO smart_job_api;
