-- Deterministic, bounded job-attachment upload-session preparation.
--
-- A session id is the API idempotency-claim UUID. The narrow preparation RPC
-- serializes each user/workspace quota, persists a per-user limiter result, and
-- reuses the exact pending row on retries. Storage signing remains outside the
-- database transaction; repeated initial signing failures eventually enqueue
-- the unconsumed canonical object paths for the existing bounded cleanup job.

ALTER TABLE private.file_upload_sessions
  ADD COLUMN signing_failures INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE private.file_upload_sessions
  ADD COLUMN last_signing_error TEXT;--> statement-breakpoint
ALTER TABLE private.file_upload_sessions
  ADD CONSTRAINT file_upload_sessions_signing_failures_check
    CHECK (signing_failures BETWEEN 0 AND 3);--> statement-breakpoint
ALTER TABLE private.file_upload_sessions
  ADD CONSTRAINT file_upload_sessions_signing_error_length_check
    CHECK (last_signing_error IS NULL OR char_length(last_signing_error) <= 500);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.prepare_api_file_upload_session(
  p_session_id UUID,
  p_company_id UUID,
  p_purpose TEXT,
  p_target_job_id UUID,
  p_bucket_id TEXT,
  p_object_prefix TEXT,
  p_expected_manifest JSONB,
  p_expires_at TIMESTAMPTZ
) RETURNS TABLE (
  outcome TEXT,
  session_id UUID,
  session_expires_at TIMESTAMPTZ,
  session_signing_failures INTEGER,
  rate_limit_reset_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_existing private.file_upload_sessions%ROWTYPE;
  v_bucket_number BIGINT;
  v_window_started_at TIMESTAMPTZ;
  v_reset_at TIMESTAMPTZ;
  v_bucket_key TEXT;
  v_hashed_key TEXT;
  v_hit_count INTEGER;
  v_active_count INTEGER;
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

  IF p_session_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_CONTEXT_REQUIRED';
  END IF;
  IF p_purpose NOT IN ('job.create_finished', 'job.complete_assigned')
     OR (p_purpose = 'job.create_finished' AND p_target_job_id IS NOT NULL)
     OR (p_purpose = 'job.complete_assigned' AND p_target_job_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_PURPOSE_INVALID';
  END IF;
  IF p_expires_at IS NULL
     OR p_expires_at <= v_now + INTERVAL '1 minute'
     OR p_expires_at > v_now + INTERVAL '120 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_EXPIRY_INVALID';
  END IF;
  IF NOT private.app_has_company_access(p_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPLOAD_SESSION_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM private.api_idempotency AS claim
    WHERE claim.id = p_session_id
      AND claim.user_id = v_uid
      AND claim.company_id = p_company_id
      AND claim.operation = 'uploads.job_attachments.prepare'
      AND claim.expires_at > v_now
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPLOAD_IDEMPOTENCY_CLAIM_REQUIRED';
  END IF;
  IF NOT private.file_upload_cleanup_manifest_is_canonical(
    p_session_id,
    p_company_id,
    v_uid,
    p_bucket_id,
    p_object_prefix,
    p_expected_manifest
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_INVALID';
  END IF;

  -- All new sessions for one user/workspace take the same transaction-scoped
  -- lock, making the active-count check and insert a single serial decision.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'smart-job:upload-session:' || v_uid::TEXT || ':' || p_company_id::TEXT,
      0
    )
  );

  SELECT upload.*
  INTO v_existing
  FROM private.file_upload_sessions AS upload
  WHERE upload.id = p_session_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.user_id <> v_uid
       OR v_existing.company_id <> p_company_id
       OR v_existing.purpose <> p_purpose
       OR v_existing.target_job_id IS DISTINCT FROM p_target_job_id
       OR v_existing.bucket_id <> p_bucket_id
       OR v_existing.object_prefix <> p_object_prefix
       OR v_existing.expected_manifest <> p_expected_manifest THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'UPLOAD_IDEMPOTENCY_SESSION_MISMATCH';
    END IF;

    IF v_existing.status <> 'pending' THEN
      RETURN QUERY SELECT
        'unavailable'::TEXT,
        v_existing.id,
        v_existing.expires_at,
        v_existing.signing_failures,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    IF v_existing.expires_at <= v_now + INTERVAL '1 minute' THEN
      RETURN QUERY SELECT
        'expired'::TEXT,
        v_existing.id,
        v_existing.expires_at,
        v_existing.signing_failures,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      'reused'::TEXT,
      v_existing.id,
      v_existing.expires_at,
      v_existing.signing_failures,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Fixed ten-minute windows: 12 distinct session preparations per user.
  -- Returning a denial (instead of raising) lets the caller commit the bucket.
  v_bucket_number := pg_catalog.floor(EXTRACT(EPOCH FROM v_now) / 600)::BIGINT;
  v_window_started_at := pg_catalog.to_timestamp(v_bucket_number * 600);
  v_reset_at := v_window_started_at + INTERVAL '10 minutes';
  v_hashed_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('api-upload-session:' || v_uid::TEXT, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_bucket_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'api-upload-session:' || v_uid::TEXT || ':' || v_bucket_number::TEXT,
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
    v_reset_at + INTERVAL '10 minutes',
    v_now
  )
  ON CONFLICT (bucket_key) DO UPDATE
  SET hit_count = bucket.hit_count + 1,
      expire_at = EXCLUDED.expire_at,
      updated_at = v_now
  RETURNING bucket.hit_count INTO v_hit_count;

  IF v_hit_count > 12 THEN
    RETURN QUERY SELECT
      'rate_limited'::TEXT,
      p_session_id,
      NULL::TIMESTAMPTZ,
      0,
      v_reset_at;
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)::INTEGER
  INTO v_active_count
  FROM private.file_upload_sessions AS upload
  WHERE upload.user_id = v_uid
    AND upload.company_id = p_company_id
    AND upload.status = 'pending'
    AND upload.expires_at > v_now;

  IF v_active_count >= 4 THEN
    RETURN QUERY SELECT
      'quota_exceeded'::TEXT,
      p_session_id,
      NULL::TIMESTAMPTZ,
      0,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  INSERT INTO private.file_upload_sessions (
    id,
    user_id,
    company_id,
    purpose,
    target_job_id,
    bucket_id,
    object_prefix,
    expected_manifest,
    status,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    p_session_id,
    v_uid,
    p_company_id,
    p_purpose,
    p_target_job_id,
    p_bucket_id,
    p_object_prefix,
    p_expected_manifest,
    'pending',
    p_expires_at,
    v_now,
    v_now
  );

  RETURN QUERY SELECT
    'created'::TEXT,
    p_session_id,
    p_expires_at,
    0,
    v_reset_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.record_api_file_upload_signing_failure(
  p_session_id UUID,
  p_error TEXT DEFAULT 'signed_url_creation_failed'
) RETURNS TABLE (
  session_status TEXT,
  failure_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_upload private.file_upload_sessions%ROWTYPE;
  v_error TEXT := pg_catalog.left(
    COALESCE(NULLIF(pg_catalog.btrim(p_error), ''), 'signed_url_creation_failed'),
    500
  );
  v_failure_count INTEGER;
  v_status TEXT;
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
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_CONTEXT_REQUIRED';
  END IF;

  SELECT upload.*
  INTO v_upload
  FROM private.file_upload_sessions AS upload
  WHERE upload.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPLOAD_SESSION_NOT_FOUND';
  END IF;
  IF v_upload.user_id <> v_uid
     OR NOT private.app_has_company_access(v_upload.company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPLOAD_SESSION_FORBIDDEN';
  END IF;

  IF v_upload.status <> 'pending' THEN
    RETURN QUERY SELECT v_upload.status::TEXT, v_upload.signing_failures;
    RETURN;
  END IF;

  v_failure_count := LEAST(v_upload.signing_failures + 1, 3);
  v_status := CASE
    WHEN v_failure_count >= 3 THEN 'cleanup_pending'
    ELSE 'pending'
  END;

  UPDATE private.file_upload_sessions
  SET signing_failures = v_failure_count,
      last_signing_error = v_error,
      status = v_status,
      cleanup_lease_expires_at = NULL,
      last_cleanup_error = CASE
        WHEN v_status = 'cleanup_pending' THEN 'signed_url_creation_failed'
        ELSE last_cleanup_error
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_session_id;

  RETURN QUERY SELECT v_status, v_failure_count;
END;
$$;--> statement-breakpoint

-- All runtime writes now go through the two narrow functions above or the
-- existing create/complete-job SECURITY DEFINER functions.
REVOKE INSERT, UPDATE, DELETE ON private.file_upload_sessions FROM smart_job_api;--> statement-breakpoint
GRANT SELECT ON private.file_upload_sessions TO smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.prepare_api_file_upload_session(
  UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.record_api_file_upload_signing_failure(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.prepare_api_file_upload_session(
  UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, TIMESTAMPTZ
) TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.record_api_file_upload_signing_failure(UUID, TEXT)
  TO smart_job_api;
