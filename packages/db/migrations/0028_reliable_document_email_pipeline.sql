-- Opaque Pub/Sub messages carry only task/delivery IDs. Worker roles load all
-- canonical tenant, user, document, and request state through these private
-- lease-token RPCs and receive no direct table privileges.

CREATE OR REPLACE FUNCTION private.complete_api_document_dispatch(
  p_task_key TEXT,
  p_lease_token UUID,
  p_dispatched_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.document_tasks AS task
  SET status = CASE WHEN task.status = 'pending' THEN 'queued' ELSE task.status END,
      dispatched_at = COALESCE(task.dispatched_at, p_dispatched_at),
      dispatch_lease_token = NULL,
      dispatch_lease_until = NULL,
      dispatch_error = NULL
  WHERE task.task_key = p_task_key
    AND task.status IN ('pending', 'queued', 'processing', 'completed')
    AND task.dispatch_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_pdf_document_task(
  p_task_key TEXT,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS TABLE (
  task_key TEXT,
  task_type public.document_task_type,
  internal_company_id UUID,
  public_company_id BIGINT,
  user_id TEXT,
  internal_document_id UUID,
  document_code TEXT,
  document_number INTEGER,
  document_type SMALLINT,
  document_data JSONB,
  confirmation_number TEXT,
  processing_attempt INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task public.document_tasks%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_document public.documents%ROWTYPE;
BEGIN
  IF p_lease_token IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_task_key, ''))) NOT BETWEEN 1 AND 160
     OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PDF_TASK_CLAIM_INVALID';
  END IF;

  SELECT task.*
  INTO v_task
  FROM public.document_tasks AS task
  WHERE task.task_key = pg_catalog.btrim(p_task_key)
  FOR UPDATE;
  IF NOT FOUND OR v_task.status IN ('completed', 'failed') THEN
    RETURN;
  END IF;
  IF v_task.status = 'processing'
     AND v_task.processing_lease_until > pg_catalog.clock_timestamp() THEN
    RETURN;
  END IF;
  IF v_task.status NOT IN ('pending', 'queued', 'processing') THEN
    RETURN;
  END IF;
  IF v_task.status = 'pending' AND v_task.dispatch_lease_token IS NULL THEN
    RETURN;
  END IF;

  SELECT company.*
  INTO STRICT v_company
  FROM public.companies AS company
  WHERE company.id = v_task.company_id
    AND company.status = 'active';

  IF v_task.document_id IS NOT NULL THEN
    SELECT document.*
    INTO STRICT v_document
    FROM public.documents AS document
    WHERE document.id = v_task.document_id
      AND document.company_id = v_task.company_id
      AND document.document_type = v_task.document_type
    FOR UPDATE;
    IF v_document.document_type = 305
       AND v_document.tax_authority_status <> 'approved' THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'TAX_DOCUMENT_NOT_APPROVED';
    END IF;
  ELSIF v_task.task_type = 'generate' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PDF_DOCUMENT_NOT_FOUND';
  END IF;

  IF pg_catalog.jsonb_typeof(v_task.request_payload -> 'documentData') <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PDF_TASK_PAYLOAD_INVALID';
  END IF;

  UPDATE public.document_tasks AS task
  SET status = 'processing',
      processing_started_at = pg_catalog.clock_timestamp(),
      processing_attempts = task.processing_attempts + 1,
      processing_lease_token = p_lease_token,
      processing_lease_until = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_lease_seconds),
      error = NULL
  WHERE task.id = v_task.id
  RETURNING task.* INTO v_task;

  task_key := v_task.task_key::TEXT;
  task_type := v_task.task_type;
  internal_company_id := v_task.company_id;
  public_company_id := v_company.public_company_id;
  user_id := v_task.user_id;
  internal_document_id := v_task.document_id;
  document_code := v_document.document_code;
  document_number := v_document.document_number;
  document_type := v_task.document_type;
  document_data := v_task.request_payload -> 'documentData';
  confirmation_number := v_document.confirmation_number;
  processing_attempt := v_task.processing_attempts;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.complete_pdf_document_task(
  p_task_key TEXT,
  p_lease_token UUID,
  p_company_id UUID,
  p_document_id UUID,
  p_storage_path TEXT,
  p_pdf_size INTEGER,
  p_completed_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS TABLE (
  completed BOOLEAN,
  delivery_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task public.document_tasks%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_expected_path TEXT;
  v_recipient TEXT;
BEGIN
  IF p_lease_token IS NULL
     OR p_company_id IS NULL
     OR p_pdf_size IS NULL
     OR p_pdf_size NOT BETWEEN 1 AND 52428800
     OR pg_catalog.char_length(COALESCE(p_storage_path, '')) NOT BETWEEN 1 AND 1024 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PDF_TASK_COMPLETION_INVALID';
  END IF;

  SELECT task.*
  INTO v_task
  FROM public.document_tasks AS task
  WHERE task.task_key = p_task_key
    AND task.status = 'processing'
    AND task.processing_lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PDF_TASK_LEASE_LOST';
  END IF;
  IF v_task.company_id <> p_company_id
     OR v_task.document_id IS DISTINCT FROM p_document_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PDF_TASK_CANONICAL_MISMATCH';
  END IF;

  IF v_task.task_type = 'preview' THEN
    v_expected_path := p_company_id::TEXT || '/previews/' || v_task.user_id || '/';
    IF pg_catalog.left(p_storage_path, pg_catalog.char_length(v_expected_path)) <> v_expected_path
       OR p_document_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PDF_TASK_STORAGE_PATH_INVALID';
    END IF;
  ELSE
    IF p_document_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PDF_DOCUMENT_REQUIRED';
    END IF;
    v_expected_path := p_company_id::TEXT || '/documents/' || p_document_id::TEXT || '.pdf';
    IF p_storage_path <> v_expected_path THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PDF_TASK_STORAGE_PATH_INVALID';
    END IF;

    SELECT document.*
    INTO v_document
    FROM public.documents AS document
    WHERE document.id = p_document_id
      AND document.company_id = p_company_id
      AND document.document_type = v_task.document_type
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PDF_DOCUMENT_NOT_FOUND';
    END IF;
    IF v_document.document_type = 305
       AND v_document.tax_authority_status <> 'approved' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TAX_DOCUMENT_NOT_APPROVED';
    END IF;
    IF v_document.storage_path IS NOT NULL
       AND (
         v_document.storage_path <> p_storage_path
         OR v_document.generation_status <> 'completed'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PDF_DOCUMENT_FINALIZATION_CONFLICT';
    END IF;

    UPDATE public.documents AS document
    SET storage_path = COALESCE(document.storage_path, p_storage_path),
        generation_status = 'completed',
        updated_at = p_completed_at
    WHERE document.id = v_document.id;

    v_recipient := pg_catalog.lower(pg_catalog.btrim(
      v_document.payload #>> '{client,email}'
    ));
    IF v_recipient IS NOT NULL
       AND pg_catalog.char_length(v_recipient) BETWEEN 3 AND 320
       AND v_recipient ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
      INSERT INTO private.document_email_deliveries (
        company_id, document_id, recipient_email, status,
        next_dispatch_at, created_at, updated_at
      ) VALUES (
        p_company_id, p_document_id, v_recipient, 'queued',
        p_completed_at, p_completed_at, p_completed_at
      )
      ON CONFLICT (document_id) DO NOTHING
      RETURNING id INTO delivery_id;
      IF delivery_id IS NULL THEN
        SELECT email_delivery.id
        INTO delivery_id
        FROM private.document_email_deliveries AS email_delivery
        WHERE email_delivery.document_id = p_document_id;
      END IF;
    END IF;
    PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  END IF;

  UPDATE public.document_tasks AS task
  SET status = 'completed',
      storage_path = p_storage_path,
      pdf_size = p_pdf_size,
      error = NULL,
      processing_lease_token = NULL,
      processing_lease_until = NULL,
      completed_at = p_completed_at
  WHERE task.id = v_task.id;

  completed := true;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.fail_pdf_document_task(
  p_task_key TEXT,
  p_lease_token UUID,
  p_company_id UUID,
  p_document_id UUID,
  p_error TEXT,
  p_retryable BOOLEAN,
  p_retry_after_seconds INTEGER DEFAULT 30
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task public.document_tasks%ROWTYPE;
BEGIN
  IF p_lease_token IS NULL
     OR p_company_id IS NULL
     OR p_retryable IS NULL
     OR (p_retryable AND p_retry_after_seconds NOT BETWEEN 1 AND 3600) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PDF_TASK_FAILURE_INVALID';
  END IF;
  SELECT task.*
  INTO v_task
  FROM public.document_tasks AS task
  WHERE task.task_key = p_task_key
    AND task.status = 'processing'
    AND task.processing_lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_task.company_id <> p_company_id
     OR v_task.document_id IS DISTINCT FROM p_document_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PDF_TASK_CANONICAL_MISMATCH';
  END IF;

  UPDATE public.document_tasks AS task
  SET status = (CASE WHEN p_retryable THEN 'queued' ELSE 'failed' END)::public.document_generation_status,
      processing_started_at = NULL,
      processing_lease_token = NULL,
      processing_lease_until = NULL,
      dispatched_at = CASE WHEN p_retryable THEN NULL ELSE task.dispatched_at END,
      next_dispatch_at = CASE WHEN p_retryable
        THEN pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_retry_after_seconds)
        ELSE task.next_dispatch_at
      END,
      error = pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'PDF processing failed'), 2000),
      completed_at = CASE WHEN p_retryable THEN NULL ELSE pg_catalog.clock_timestamp() END
  WHERE task.id = v_task.id;

  IF NOT p_retryable AND p_document_id IS NOT NULL THEN
    UPDATE public.documents AS document
    SET generation_status = 'failed',
        payload = COALESCE(document.payload, '{}'::JSONB)
          || pg_catalog.jsonb_build_object(
            'generationError',
            pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'PDF processing failed'), 2000)
          ),
        updated_at = pg_catalog.clock_timestamp()
    WHERE document.id = p_document_id
      AND document.company_id = p_company_id
      AND document.storage_path IS NULL
      AND document.generation_status <> 'completed';
    PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  END IF;
  RETURN true;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_api_email_dispatch_batch(
  p_lease_token UUID,
  p_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 30,
  p_delivery_id UUID DEFAULT NULL
) RETURNS TABLE (
  delivery_id UUID,
  dispatch_attempt INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_lease_token IS NULL
     OR p_limit NOT BETWEEN 1 AND 100
     OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMAIL_DISPATCH_CLAIM_INVALID';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT delivery.id
    FROM private.document_email_deliveries AS delivery
    WHERE delivery.status = 'queued'
      AND delivery.dispatched_at IS NULL
      AND delivery.next_dispatch_at <= pg_catalog.clock_timestamp()
      AND (p_delivery_id IS NULL OR delivery.id = p_delivery_id)
      AND (
        delivery.dispatch_lease_until IS NULL
        OR delivery.dispatch_lease_until <= pg_catalog.clock_timestamp()
      )
    ORDER BY delivery.next_dispatch_at, delivery.created_at, delivery.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE private.document_email_deliveries AS delivery
    SET dispatch_attempts = delivery.dispatch_attempts + 1,
        dispatch_lease_token = p_lease_token,
        dispatch_lease_until = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_lease_seconds),
        last_error = NULL,
        updated_at = pg_catalog.clock_timestamp()
    FROM candidates
    WHERE delivery.id = candidates.id
    RETURNING delivery.id, delivery.dispatch_attempts
  )
  SELECT claimed.id, claimed.dispatch_attempts FROM claimed;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.complete_api_email_dispatch(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_dispatched_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE private.document_email_deliveries AS delivery
  SET dispatched_at = CASE
        -- Pub/Sub push can reach the worker before this publisher transaction
        -- commits. Preserve a worker-scheduled retry instead of marking that
        -- already-acknowledged message as durably dispatched.
        WHEN delivery.status = 'queued'
          AND delivery.next_dispatch_at > p_dispatched_at
          THEN NULL
        ELSE COALESCE(delivery.dispatched_at, p_dispatched_at)
      END,
      dispatch_lease_token = NULL,
      dispatch_lease_until = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE delivery.id = p_delivery_id
    AND delivery.status IN ('queued', 'sending', 'sent', 'failed', 'delivery_unknown')
    AND delivery.dispatch_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.retry_api_email_dispatch(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_error TEXT,
  p_retry_after_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_retry_after_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMAIL_DISPATCH_RETRY_INVALID';
  END IF;
  UPDATE private.document_email_deliveries AS delivery
  SET next_dispatch_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_retry_after_seconds),
      dispatch_lease_token = NULL,
      dispatch_lease_until = NULL,
      last_error = pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'Email dispatch failed'), 2000),
      updated_at = pg_catalog.clock_timestamp()
  WHERE delivery.id = p_delivery_id
    AND delivery.status = 'queued'
    AND delivery.dispatched_at IS NULL
    AND delivery.dispatch_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_email_delivery(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 30
) RETURNS TABLE (
  delivery_id UUID,
  internal_company_id UUID,
  public_company_id BIGINT,
  internal_document_id UUID,
  document_code TEXT,
  document_number INTEGER,
  document_type SMALLINT,
  language TEXT,
  recipient_email TEXT,
  recipient_name TEXT,
  business_name TEXT,
  storage_path TEXT,
  send_attempt INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery private.document_email_deliveries%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_company public.companies%ROWTYPE;
BEGIN
  IF p_delivery_id IS NULL OR p_lease_token IS NULL
     OR p_lease_seconds NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMAIL_DELIVERY_CLAIM_INVALID';
  END IF;
  SELECT delivery.*
  INTO v_delivery
  FROM private.document_email_deliveries AS delivery
  WHERE delivery.id = p_delivery_id
  FOR UPDATE;
  IF NOT FOUND OR v_delivery.status IN ('sent', 'failed', 'delivery_unknown') THEN
    RETURN;
  END IF;

  IF v_delivery.status = 'sending' THEN
    IF v_delivery.send_lease_until > pg_catalog.clock_timestamp() THEN
      RETURN;
    END IF;
    UPDATE private.document_email_deliveries AS delivery
    SET status = 'delivery_unknown',
        send_lease_token = NULL,
        send_lease_until = NULL,
        last_error = 'Previous SES submission ended without a durable result',
        updated_at = pg_catalog.clock_timestamp()
    WHERE delivery.id = v_delivery.id;
    PERFORM private.bump_company_sync_version(v_delivery.company_id, 'documents_version');
    RETURN;
  END IF;
  IF v_delivery.status <> 'queued'
     OR (
       v_delivery.dispatched_at IS NULL
       AND v_delivery.dispatch_lease_token IS NULL
     ) THEN
    RETURN;
  END IF;

  SELECT document.*
  INTO v_document
  FROM public.documents AS document
  WHERE document.id = v_delivery.document_id
    AND document.company_id = v_delivery.company_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_document.generation_status <> 'completed'
     OR v_document.storage_path IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'EMAIL_DOCUMENT_NOT_READY';
  END IF;
  IF v_document.document_type = 305
     AND v_document.tax_authority_status <> 'approved' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TAX_DOCUMENT_NOT_APPROVED';
  END IF;
  SELECT company.*
  INTO STRICT v_company
  FROM public.companies AS company
  WHERE company.id = v_delivery.company_id
    AND company.status = 'active';

  UPDATE private.document_email_deliveries AS delivery
  SET status = 'sending',
      send_attempts = delivery.send_attempts + 1,
      send_lease_token = p_lease_token,
      send_lease_until = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_lease_seconds),
      last_error = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE delivery.id = v_delivery.id
  RETURNING delivery.* INTO v_delivery;

  delivery_id := v_delivery.id;
  internal_company_id := v_delivery.company_id;
  public_company_id := v_company.public_company_id;
  internal_document_id := v_document.id;
  document_code := v_document.document_code;
  document_number := v_document.document_number;
  document_type := v_document.document_type;
  language := COALESCE(NULLIF(v_document.language, ''), 'he');
  recipient_email := v_delivery.recipient_email;
  recipient_name := v_document.payload #>> '{client,name}';
  business_name := COALESCE(
    NULLIF(v_document.company_name_snapshot, ''),
    v_document.payload #>> '{company,name}',
    'Smart-Job'
  );
  storage_path := v_document.storage_path;
  send_attempt := v_delivery.send_attempts;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.complete_email_delivery(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_company_id UUID,
  p_document_id UUID,
  p_provider_message_id TEXT,
  p_sent_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_provider_message_id, ''))) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMAIL_PROVIDER_MESSAGE_ID_INVALID';
  END IF;
  UPDATE private.document_email_deliveries AS delivery
  SET status = 'sent',
      send_lease_token = NULL,
      send_lease_until = NULL,
      provider_message_id = pg_catalog.btrim(p_provider_message_id),
      last_error = NULL,
      sent_at = p_sent_at,
      updated_at = p_sent_at
  WHERE delivery.id = p_delivery_id
    AND delivery.company_id = p_company_id
    AND delivery.document_id = p_document_id
    AND delivery.status = 'sending'
    AND delivery.send_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    UPDATE public.documents AS document
    SET email_sent = true,
        updated_at = p_sent_at
    WHERE document.id = p_document_id
      AND document.company_id = p_company_id;
    PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  END IF;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.resolve_email_delivery_failure(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_company_id UUID,
  p_document_id UUID,
  p_outcome TEXT,
  p_error TEXT,
  p_retry_after_seconds INTEGER DEFAULT 30
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_outcome NOT IN ('queued', 'failed', 'delivery_unknown')
     OR (p_outcome = 'queued' AND p_retry_after_seconds NOT BETWEEN 1 AND 3600) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMAIL_DELIVERY_OUTCOME_INVALID';
  END IF;
  UPDATE private.document_email_deliveries AS delivery
  SET status = p_outcome::public.email_delivery_status,
      send_lease_token = NULL,
      send_lease_until = NULL,
      dispatched_at = CASE WHEN p_outcome = 'queued' THEN NULL ELSE delivery.dispatched_at END,
      next_dispatch_at = CASE WHEN p_outcome = 'queued'
        THEN pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_retry_after_seconds)
        ELSE delivery.next_dispatch_at
      END,
      last_error = pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'Email delivery failed'), 2000),
      updated_at = pg_catalog.clock_timestamp()
  WHERE delivery.id = p_delivery_id
    AND delivery.company_id = p_company_id
    AND delivery.document_id = p_document_id
    AND delivery.status = 'sending'
    AND delivery.send_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  END IF;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.retry_api_document_email(
  p_company_id UUID,
  p_document_id UUID
) RETURNS TABLE (
  delivery_id UUID,
  document_id UUID,
  delivery_status public.email_delivery_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery private.document_email_deliveries%ROWTYPE;
BEGIN
  PERFORM private.require_api_document_mutation_access(p_company_id, true);
  SELECT delivery.*
  INTO v_delivery
  FROM private.document_email_deliveries AS delivery
  WHERE delivery.company_id = p_company_id
    AND delivery.document_id = p_document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'EMAIL_DELIVERY_NOT_FOUND';
  END IF;
  IF v_delivery.status NOT IN ('failed', 'delivery_unknown') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMAIL_DELIVERY_NOT_RETRYABLE';
  END IF;
  IF v_delivery.manual_retry_count >= 20 THEN
    RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'EMAIL_MANUAL_RETRY_LIMIT';
  END IF;

  UPDATE private.document_email_deliveries AS delivery
  SET status = 'queued',
      dispatch_lease_token = NULL,
      dispatch_lease_until = NULL,
      dispatched_at = NULL,
      next_dispatch_at = pg_catalog.clock_timestamp(),
      send_lease_token = NULL,
      send_lease_until = NULL,
      provider_message_id = NULL,
      last_error = NULL,
      manual_retry_count = delivery.manual_retry_count + 1,
      sent_at = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE delivery.id = v_delivery.id
  RETURNING delivery.* INTO v_delivery;

  delivery_id := v_delivery.id;
  document_id := v_delivery.document_id;
  delivery_status := v_delivery.status;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.get_api_document_email_delivery_status(
  p_company_id UUID,
  p_document_id UUID
) RETURNS public.email_delivery_status
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT delivery.status
  FROM private.document_email_deliveries AS delivery
  WHERE delivery.company_id = p_company_id
    AND delivery.document_id = p_document_id
    AND (
      private.app_is_dev()
      OR EXISTS (
        SELECT 1
        FROM public.company_memberships AS membership
        WHERE membership.company_id = p_company_id
          AND membership.user_id = private.app_auth_uid()
          AND membership.status = 'active'
          AND membership.role IN ('manager', 'user', 'basic')
      )
    )
  LIMIT 1
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION private.get_api_document_email_delivery_status(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.claim_pdf_document_task(TEXT, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.complete_pdf_document_task(TEXT, UUID, UUID, UUID, TEXT, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.fail_pdf_document_task(TEXT, UUID, UUID, UUID, TEXT, BOOLEAN, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.claim_email_delivery(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api, smart_job_pdf, smart_job_archiver;
REVOKE ALL ON FUNCTION private.complete_email_delivery(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api, smart_job_pdf, smart_job_archiver;
REVOKE ALL ON FUNCTION private.resolve_email_delivery_failure(UUID, UUID, UUID, UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api, smart_job_pdf, smart_job_archiver;
REVOKE ALL ON FUNCTION private.claim_api_email_dispatch_batch(UUID, INTEGER, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.complete_api_email_dispatch(UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.retry_api_email_dispatch(UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.retry_api_document_email(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;

GRANT EXECUTE ON FUNCTION private.claim_pdf_document_task(TEXT, UUID, INTEGER)
  TO smart_job_pdf;
GRANT EXECUTE ON FUNCTION private.complete_pdf_document_task(TEXT, UUID, UUID, UUID, TEXT, INTEGER, TIMESTAMPTZ)
  TO smart_job_pdf;
GRANT EXECUTE ON FUNCTION private.fail_pdf_document_task(TEXT, UUID, UUID, UUID, TEXT, BOOLEAN, INTEGER)
  TO smart_job_pdf;
GRANT EXECUTE ON FUNCTION private.claim_email_delivery(UUID, UUID, INTEGER)
  TO smart_job_email;
GRANT EXECUTE ON FUNCTION private.complete_email_delivery(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
  TO smart_job_email;
GRANT EXECUTE ON FUNCTION private.resolve_email_delivery_failure(UUID, UUID, UUID, UUID, TEXT, TEXT, INTEGER)
  TO smart_job_email;
GRANT EXECUTE ON FUNCTION private.claim_api_email_dispatch_batch(UUID, INTEGER, INTEGER, UUID)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.complete_api_email_dispatch(UUID, UUID, TIMESTAMPTZ)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.retry_api_email_dispatch(UUID, UUID, TEXT, INTEGER)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.retry_api_document_email(UUID, UUID)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.get_api_document_email_delivery_status(UUID, UUID)
  TO smart_job_api;
