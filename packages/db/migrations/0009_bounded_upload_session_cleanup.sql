ALTER TABLE "private"."file_upload_sessions" DROP CONSTRAINT "file_upload_sessions_status_check";--> statement-breakpoint
ALTER TABLE "private"."file_upload_sessions" DROP CONSTRAINT "file_upload_sessions_cleanup_attempts_non_negative_check";--> statement-breakpoint
UPDATE "private"."file_upload_sessions"
SET "cleanup_attempts" = LEAST(GREATEST("cleanup_attempts", 0), 5),
    "last_cleanup_error" = CASE
      WHEN "last_cleanup_error" IS NULL THEN NULL
      ELSE LEFT("last_cleanup_error", 500)
    END,
    "status" = CASE
      WHEN "status" = 'cleanup_claimed' AND "cleanup_lease_expires_at" IS NULL
        THEN 'cleanup_pending'
      ELSE "status"
    END,
    "cleanup_lease_expires_at" = CASE
      WHEN "status" = 'cleanup_claimed' AND "cleanup_lease_expires_at" IS NOT NULL
        THEN "cleanup_lease_expires_at"
      ELSE NULL
    END;--> statement-breakpoint
ALTER TABLE "private"."file_upload_sessions" ADD CONSTRAINT "file_upload_sessions_cleanup_error_length_check" CHECK ("private"."file_upload_sessions"."last_cleanup_error" IS NULL OR char_length("private"."file_upload_sessions"."last_cleanup_error") <= 500);--> statement-breakpoint
ALTER TABLE "private"."file_upload_sessions" ADD CONSTRAINT "file_upload_sessions_cleanup_lease_state_check" CHECK (("private"."file_upload_sessions"."status" = 'cleanup_claimed' AND "private"."file_upload_sessions"."cleanup_lease_expires_at" IS NOT NULL)
      OR ("private"."file_upload_sessions"."status" <> 'cleanup_claimed' AND "private"."file_upload_sessions"."cleanup_lease_expires_at" IS NULL));--> statement-breakpoint
ALTER TABLE "private"."file_upload_sessions" ADD CONSTRAINT "file_upload_sessions_status_check" CHECK ("private"."file_upload_sessions"."status" IN ('pending', 'consumed', 'cleanup_pending', 'cleanup_claimed', 'cleanup_complete', 'cleanup_failed'));--> statement-breakpoint
ALTER TABLE "private"."file_upload_sessions" ADD CONSTRAINT "file_upload_sessions_cleanup_attempts_non_negative_check" CHECK ("private"."file_upload_sessions"."cleanup_attempts" BETWEEN 0 AND 5);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.file_upload_cleanup_manifest_is_canonical(
  p_session_id UUID,
  p_company_id UUID,
  p_user_id UUID,
  p_bucket_id TEXT,
  p_object_prefix TEXT,
  p_expected_manifest JSONB
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT
    p_session_id IS NOT NULL
    AND p_company_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND p_bucket_id = 'smart-job-company-files'
    AND p_object_prefix = pg_catalog.concat(
      p_company_id::text,
      '/',
      p_user_id::text,
      '/',
      p_session_id::text
    )
    AND pg_catalog.jsonb_typeof(p_expected_manifest) = 'array'
    AND pg_catalog.jsonb_array_length(p_expected_manifest) BETWEEN 1 AND 20
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(
        CASE
          WHEN pg_catalog.jsonb_typeof(p_expected_manifest) = 'array'
            THEN p_expected_manifest
          ELSE '[]'::jsonb
        END
      ) AS attachment(item)
      WHERE pg_catalog.jsonb_typeof(attachment.item) <> 'object'
        OR NOT (
          attachment.item ? 'attachmentId'
          AND attachment.item ? 'mimeType'
          AND attachment.item ? 'objectPath'
        )
        OR COALESCE(attachment.item ->> 'attachmentId', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR COALESCE(attachment.item ->> 'mimeType', '') NOT IN (
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/heic',
          'image/heif'
        )
        OR attachment.item ->> 'objectPath' IS DISTINCT FROM pg_catalog.concat(
          p_object_prefix,
          '/',
          attachment.item ->> 'attachmentId',
          '.',
          CASE attachment.item ->> 'mimeType'
            WHEN 'image/jpeg' THEN 'jpg'
            WHEN 'image/png' THEN 'png'
            WHEN 'image/webp' THEN 'webp'
            WHEN 'image/heic' THEN 'heic'
            WHEN 'image/heif' THEN 'heif'
            ELSE NULL
          END
        )
    )
    AND (
      SELECT pg_catalog.count(DISTINCT attachment.item ->> 'objectPath')
      FROM pg_catalog.jsonb_array_elements(
        CASE
          WHEN pg_catalog.jsonb_typeof(p_expected_manifest) = 'array'
            THEN p_expected_manifest
          ELSE '[]'::jsonb
        END
      ) AS attachment(item)
    ) = pg_catalog.jsonb_array_length(p_expected_manifest);
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.queue_expired_file_upload_cleanup(
  p_now TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_summary JSONB;
  v_quarantined INTEGER := 0;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLEANUP_NOW_REQUIRED';
  END IF;

  v_summary := private.cleanup_expired_operational_rows(p_now);

  -- Invalid manifests are never returned to an object-deletion worker. Keep the
  -- row for review, cap its attempts, and expose only an aggregate count.
  UPDATE private.file_upload_sessions AS upload
  SET status = 'cleanup_failed',
      cleanup_lease_expires_at = NULL,
      cleanup_attempts = 5,
      last_cleanup_error = CASE
        WHEN upload.cleanup_attempts >= 5
          THEN COALESCE(upload.last_cleanup_error, 'cleanup_attempt_limit_reached')
        ELSE 'invalid_upload_cleanup_manifest'
      END,
      updated_at = p_now
  WHERE upload.status = 'cleanup_pending'
    AND (
      upload.cleanup_attempts >= 5
      OR NOT private.file_upload_cleanup_manifest_is_canonical(
        upload.id,
        upload.company_id,
        upload.user_id,
        upload.bucket_id,
        upload.object_prefix,
        upload.expected_manifest
      )
    );
  GET DIAGNOSTICS v_quarantined = ROW_COUNT;

  RETURN COALESCE(v_summary, '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'uploadSessionsQuarantined',
    v_quarantined
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_file_upload_cleanup_batch(
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 300,
  p_now TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS TABLE (
  session_id UUID,
  bucket_id TEXT,
  object_paths TEXT[],
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_lease_seconds INTEGER := LEAST(
    GREATEST(COALESCE(p_lease_seconds, 300), 30),
    900
  );
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLEANUP_NOW_REQUIRED';
  END IF;

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT upload.id
    FROM private.file_upload_sessions AS upload
    WHERE upload.status = 'cleanup_pending'
      AND upload.cleanup_attempts < 5
      AND upload.consumed_at IS NULL
      AND upload.consumed_by_job_id IS NULL
      AND private.file_upload_cleanup_manifest_is_canonical(
        upload.id,
        upload.company_id,
        upload.user_id,
        upload.bucket_id,
        upload.object_prefix,
        upload.expected_manifest
      )
    ORDER BY upload.updated_at, upload.expires_at, upload.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE private.file_upload_sessions AS upload
    SET status = 'cleanup_claimed',
        cleanup_lease_expires_at = p_now
          + pg_catalog.make_interval(secs => v_lease_seconds),
        cleanup_attempts = upload.cleanup_attempts + 1,
        last_cleanup_error = NULL,
        updated_at = p_now
    FROM candidates
    WHERE upload.id = candidates.id
      AND upload.status = 'cleanup_pending'
      AND upload.cleanup_attempts < 5
      AND upload.consumed_at IS NULL
      AND upload.consumed_by_job_id IS NULL
    RETURNING
      upload.id,
      upload.bucket_id,
      upload.expected_manifest,
      upload.cleanup_lease_expires_at,
      upload.cleanup_attempts
  )
  SELECT
    claimed.id,
    claimed.bucket_id,
    ARRAY(
      SELECT attachment.item ->> 'objectPath'
      FROM pg_catalog.jsonb_array_elements(claimed.expected_manifest)
        WITH ORDINALITY AS attachment(item, position)
      ORDER BY attachment.position
    ),
    claimed.cleanup_lease_expires_at,
    claimed.cleanup_attempts
  FROM claimed
  ORDER BY claimed.id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.finish_file_upload_cleanup(
  p_session_id UUID,
  p_attempt_count INTEGER,
  p_succeeded BOOLEAN,
  p_error TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_upload private.file_upload_sessions%ROWTYPE;
  v_error TEXT;
  v_next_status TEXT;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLEANUP_SESSION_REQUIRED';
  END IF;
  IF p_attempt_count NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLEANUP_ATTEMPT_INVALID';
  END IF;
  IF p_succeeded IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLEANUP_RESULT_REQUIRED';
  END IF;
  IF p_now IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLEANUP_NOW_REQUIRED';
  END IF;

  SELECT upload.*
  INTO v_upload
  FROM private.file_upload_sessions AS upload
  WHERE upload.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPLOAD_CLEANUP_SESSION_NOT_FOUND';
  END IF;

  -- The attempt token prevents an expired worker from acknowledging a newer
  -- lease. Consumed, completed, failed, or requeued rows are never mutated.
  IF v_upload.status <> 'cleanup_claimed'
     OR v_upload.cleanup_attempts <> p_attempt_count
     OR v_upload.consumed_at IS NOT NULL
     OR v_upload.consumed_by_job_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'stale',
      'status', v_upload.status,
      'attemptCount', v_upload.cleanup_attempts
    );
  END IF;

  IF p_succeeded THEN
    UPDATE private.file_upload_sessions
    SET status = 'cleanup_complete',
        cleanup_lease_expires_at = NULL,
        last_cleanup_error = NULL,
        updated_at = p_now
    WHERE id = p_session_id;

    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'cleanup_complete',
      'status', 'cleanup_complete',
      'attemptCount', p_attempt_count
    );
  END IF;

  v_error := LEFT(
    COALESCE(NULLIF(pg_catalog.btrim(p_error), ''), 'storage_delete_failed'),
    500
  );
  v_next_status := CASE
    WHEN p_attempt_count >= 5 THEN 'cleanup_failed'
    ELSE 'cleanup_pending'
  END;

  UPDATE private.file_upload_sessions
  SET status = v_next_status,
      cleanup_lease_expires_at = NULL,
      last_cleanup_error = v_error,
      updated_at = p_now
  WHERE id = p_session_id;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', v_next_status,
    'status', v_next_status,
    'attemptCount', p_attempt_count
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.queue_expired_file_upload_cleanup(
  p_now TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.queue_expired_file_upload_cleanup(p_now);
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.claim_file_upload_cleanup_batch(
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 300,
  p_now TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS TABLE (
  session_id UUID,
  bucket_id TEXT,
  object_paths TEXT[],
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT *
  FROM private.claim_file_upload_cleanup_batch(
    p_limit,
    p_lease_seconds,
    p_now
  );
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.finish_file_upload_cleanup(
  p_session_id UUID,
  p_attempt_count INTEGER,
  p_succeeded BOOLEAN,
  p_error TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.finish_file_upload_cleanup(
    p_session_id,
    p_attempt_count,
    p_succeeded,
    p_error,
    p_now
  );
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.file_upload_cleanup_manifest_is_canonical(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.queue_expired_file_upload_cleanup(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.claim_file_upload_cleanup_batch(
  INTEGER, INTEGER, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.finish_file_upload_cleanup(
  UUID, INTEGER, BOOLEAN, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.queue_expired_file_upload_cleanup(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_file_upload_cleanup_batch(
  INTEGER, INTEGER, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.finish_file_upload_cleanup(
  UUID, INTEGER, BOOLEAN, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.queue_expired_file_upload_cleanup(TIMESTAMPTZ)
  TO service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_file_upload_cleanup_batch(
  INTEGER, INTEGER, TIMESTAMPTZ
) TO service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.finish_file_upload_cleanup(
  UUID, INTEGER, BOOLEAN, TEXT, TIMESTAMPTZ
) TO service_role;
