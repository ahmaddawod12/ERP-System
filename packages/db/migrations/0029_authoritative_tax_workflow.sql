-- Authoritative tax-invoice creation, durable submission claiming, and one
-- idempotent result path shared by immediate authority responses and callbacks.

ALTER TABLE private.tax_submissions
  ADD COLUMN requested_by_user_id TEXT;
--> statement-breakpoint
UPDATE private.tax_submissions AS submission
SET requested_by_user_id = reservation.reserved_by_user_id
FROM public.tax_invoice_reservations AS reservation
WHERE reservation.id = submission.reservation_id
  AND submission.requested_by_user_id IS NULL;
--> statement-breakpoint
ALTER TABLE private.tax_submissions
  ALTER COLUMN requested_by_user_id SET NOT NULL,
  ADD CONSTRAINT tax_submissions_requested_by_user_id_app_users_id_fk
    FOREIGN KEY (requested_by_user_id)
    REFERENCES public.app_users(id)
    ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE private.tax_callback_events
  DROP CONSTRAINT tax_callback_events_callback_status_check,
  ADD CONSTRAINT tax_callback_events_callback_status_check
    CHECK (callback_status IN ('submitted', 'approved', 'rejected', 'error'));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_tax_invoice(
  p_company_id UUID,
  p_document_data JSONB,
  p_created_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS TABLE (
  document_id UUID,
  document_code TEXT,
  document_number INTEGER,
  tax_authority_status public.tax_authority_status,
  tax_submission_status public.tax_submission_status,
  correlation_id TEXT,
  entity_version BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_uid TEXT := private.app_auth_uid();
  v_public_company_id BIGINT;
  v_document_id UUID := extensions.gen_random_uuid();
  v_reservation_id UUID := extensions.gen_random_uuid();
  v_submission_id UUID := extensions.gen_random_uuid();
  v_document_number INTEGER;
  v_document_code TEXT;
  v_correlation_id TEXT := extensions.gen_random_uuid()::TEXT;
  v_data JSONB;
  v_client_id UUID;
BEGIN
  IF p_created_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_INVOICE_CREATED_AT_INVALID';
  END IF;
  v_membership_id := private.require_api_document_mutation_access(p_company_id, false);
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;

  SELECT company.public_company_id
  INTO STRICT v_public_company_id
  FROM public.companies AS company
  WHERE company.id = p_company_id
    AND company.status = 'active';

  v_data := private.prepare_api_document_data(
    p_company_id,
    v_membership_id,
    p_document_data
  );
  IF (v_data ->> 'totalBeforeVat')::NUMERIC <= 0
     OR (v_data ->> 'vatAmount')::NUMERIC <= 0
     OR (v_data ->> 'totalWithVat')::NUMERIC <= 0
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_array_elements(v_data -> 'items') AS item(value)
       WHERE (item.value ->> 'quantity')::NUMERIC <= 0
          OR (item.value ->> 'price')::NUMERIC <= 0
          OR (item.value ->> 'quantity')::NUMERIC > 99999999999.999
          OR (item.value ->> 'price')::NUMERIC > 99999999999.99
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_INVOICE_AMOUNT_INVALID';
  END IF;

  v_document_number := private.allocate_company_counter(p_company_id, 'doc_305');
  v_document_code := 'TI' || v_document_number::TEXT || '-' || v_public_company_id::TEXT;
  v_data := v_data || pg_catalog.jsonb_build_object(
    'documentNumber', v_document_number,
    'documentCode', v_document_code
  );
  IF v_data #>> '{client,clientId}' IS NOT NULL THEN
    v_client_id := (v_data #>> '{client,clientId}')::UUID;
  END IF;

  INSERT INTO public.documents (
    id, company_id, document_type, document_number, document_code,
    generation_status, tax_authority_status, client_id,
    created_by_membership_id, language, document_date, notes,
    total_before_vat, vat_amount, total_with_vat,
    company_name_snapshot, company_vat_snapshot, company_address_snapshot,
    client_name_snapshot, client_phone_snapshot, client_city_snapshot,
    client_vat_snapshot, payload, created_at, updated_at
  ) VALUES (
    v_document_id, p_company_id, 305, v_document_number, v_document_code,
    'pending', 'reserved', v_client_id,
    v_membership_id, v_data ->> 'language', (v_data ->> 'date')::TIMESTAMPTZ,
    NULLIF(v_data ->> 'notes', ''),
    (v_data ->> 'totalBeforeVat')::NUMERIC(14, 2),
    (v_data ->> 'vatAmount')::NUMERIC(14, 2),
    (v_data ->> 'totalWithVat')::NUMERIC(14, 2),
    NULLIF(v_data #>> '{company,name}', ''),
    NULLIF(v_data #>> '{company,vatNumber}', ''),
    NULLIF(v_data #>> '{company,address}', ''),
    NULLIF(v_data #>> '{client,name}', ''),
    NULLIF(v_data #>> '{client,phone}', ''),
    NULLIF(v_data #>> '{client,city}', ''),
    NULLIF(v_data #>> '{client,clientVatNumber}', ''),
    v_data, p_created_at, p_created_at
  );

  INSERT INTO public.document_items (
    document_id, line_no, description, quantity, unit_price,
    line_total, source_inventory_part_id, metadata
  )
  SELECT
    v_document_id,
    item.line_no::INTEGER,
    pg_catalog.btrim(item.value ->> 'description'),
    (item.value ->> 'quantity')::NUMERIC(14, 3),
    (item.value ->> 'price')::NUMERIC(14, 2),
    pg_catalog.round(
      (item.value ->> 'quantity')::NUMERIC
        * (item.value ->> 'price')::NUMERIC,
      2
    )::NUMERIC(14, 2),
    part.id,
    CASE WHEN item.value ? 'partNo'
      THEN pg_catalog.jsonb_build_object(
        'partNo', (item.value ->> 'partNo')::INTEGER
      )
      ELSE '{}'::JSONB
    END
  FROM pg_catalog.jsonb_array_elements(v_data -> 'items')
    WITH ORDINALITY AS item(value, line_no)
  LEFT JOIN public.inventory_parts AS part
    ON part.company_id = p_company_id
   AND part.part_no = CASE WHEN item.value ? 'partNo'
     THEN (item.value ->> 'partNo')::INTEGER ELSE NULL END;

  INSERT INTO public.tax_invoice_reservations (
    id, company_id, document_id, document_number, status,
    reserved_by_user_id, client_name_snapshot, oauth_session_id,
    status_payload, created_at, updated_at
  ) VALUES (
    v_reservation_id, p_company_id, v_document_id, v_document_number,
    'reserved', v_uid, NULLIF(v_data #>> '{client,name}', ''),
    v_correlation_id,
    pg_catalog.jsonb_build_object(
      'correlationId', v_correlation_id,
      'reservedAt', p_created_at
    ),
    p_created_at, p_created_at
  );

  INSERT INTO private.tax_submissions (
    id, company_id, document_id, reservation_id, correlation_id,
    requested_by_user_id, status, request_payload, next_attempt_at,
    created_at, updated_at
  ) VALUES (
    v_submission_id, p_company_id, v_document_id, v_reservation_id,
    v_correlation_id, v_uid, 'queued',
    pg_catalog.jsonb_build_object(
      'documentId', v_document_id,
      'documentCode', v_document_code,
      'documentNumber', v_document_number,
      'documentType', 305,
      'invoice', v_data
    ),
    p_created_at, p_created_at, p_created_at
  );

  PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  document_id := v_document_id;
  document_code := v_document_code;
  document_number := v_document_number;
  tax_authority_status := 'reserved';
  tax_submission_status := 'queued';
  correlation_id := v_correlation_id;
  entity_version := 1;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_api_tax_submission_batch(
  p_lease_token UUID,
  p_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 60,
  p_submission_id UUID DEFAULT NULL
) RETURNS TABLE (
  submission_id UUID,
  internal_company_id UUID,
  internal_document_id UUID,
  correlation_id TEXT,
  request_payload JSONB,
  submission_attempt INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expired RECORD;
BEGIN
  IF p_lease_token IS NULL
     OR p_limit NOT BETWEEN 1 AND 100
     OR p_lease_seconds NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_SUBMISSION_CLAIM_INVALID';
  END IF;

  -- Once a worker held the submission lease, expiry is ambiguous: it may have
  -- reached the authority before the worker died. Never reclaim it blindly.
  FOR v_expired IN
    UPDATE private.tax_submissions AS submission
    SET status = 'submission_unknown',
        lease_token = NULL,
        lease_until = NULL,
        last_error = 'Previous authority submission ended without a durable result',
        submitted_at = COALESCE(submission.submitted_at, pg_catalog.clock_timestamp()),
        updated_at = pg_catalog.clock_timestamp()
    WHERE submission.status = 'submitting'
      AND submission.lease_until <= pg_catalog.clock_timestamp()
    RETURNING submission.company_id, submission.document_id, submission.reservation_id
  LOOP
    UPDATE public.documents AS document
    SET tax_authority_status = CASE
          WHEN document.tax_authority_status = 'reserved' THEN 'submitted'
          ELSE document.tax_authority_status
        END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE document.id = v_expired.document_id
      AND document.company_id = v_expired.company_id;
    UPDATE public.tax_invoice_reservations AS reservation
    SET status = CASE
          WHEN reservation.status = 'reserved' THEN 'submitted'
          ELSE reservation.status
        END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE reservation.id = v_expired.reservation_id;
    PERFORM private.bump_company_sync_version(
      v_expired.company_id,
      'documents_version'
    );
  END LOOP;

  RETURN QUERY
  WITH candidates AS (
    SELECT submission.id
    FROM private.tax_submissions AS submission
    WHERE submission.status = 'queued'
      AND submission.next_attempt_at <= pg_catalog.clock_timestamp()
      AND (p_submission_id IS NULL OR submission.id = p_submission_id)
      AND submission.attempt_count < 100
    ORDER BY submission.next_attempt_at, submission.created_at, submission.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE private.tax_submissions AS submission
    SET status = 'submitting',
        attempt_count = submission.attempt_count + 1,
        lease_token = p_lease_token,
        lease_until = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_lease_seconds),
        last_error = NULL,
        updated_at = pg_catalog.clock_timestamp()
    FROM candidates
    WHERE submission.id = candidates.id
    RETURNING submission.*
  )
  SELECT
    claimed.id,
    claimed.company_id,
    claimed.document_id,
    claimed.correlation_id::TEXT,
    claimed.request_payload,
    claimed.attempt_count
  FROM claimed;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.retry_api_tax_submission(
  p_submission_id UUID,
  p_lease_token UUID,
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
  IF p_submission_id IS NULL OR p_lease_token IS NULL
     OR p_retry_after_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_SUBMISSION_RETRY_INVALID';
  END IF;
  UPDATE private.tax_submissions AS submission
  SET status = 'queued',
      lease_token = NULL,
      lease_until = NULL,
      next_attempt_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_retry_after_seconds),
      last_error = pg_catalog.left(
        COALESCE(NULLIF(p_error, ''), 'Tax submission pre-send failure'),
        2000
      ),
      updated_at = pg_catalog.clock_timestamp()
  WHERE submission.id = p_submission_id
    AND submission.status = 'submitting'
    AND submission.lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.mark_api_tax_submission_unknown(
  p_submission_id UUID,
  p_lease_token UUID,
  p_error TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission private.tax_submissions%ROWTYPE;
BEGIN
  SELECT submission.*
  INTO v_submission
  FROM private.tax_submissions AS submission
  WHERE submission.id = p_submission_id
    AND submission.status = 'submitting'
    AND submission.lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE private.tax_submissions AS submission
  SET status = 'submission_unknown',
      lease_token = NULL,
      lease_until = NULL,
      last_error = pg_catalog.left(
        COALESCE(NULLIF(p_error, ''), 'Tax authority result is unknown'),
        2000
      ),
      submitted_at = COALESCE(submission.submitted_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  WHERE submission.id = v_submission.id;
  UPDATE public.documents AS document
  SET tax_authority_status = CASE
        WHEN document.tax_authority_status = 'reserved' THEN 'submitted'
        ELSE document.tax_authority_status
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE document.id = v_submission.document_id
    AND document.company_id = v_submission.company_id;
  UPDATE public.tax_invoice_reservations AS reservation
  SET status = CASE
        WHEN reservation.status = 'reserved' THEN 'submitted'
        ELSE reservation.status
      END,
      status_payload = reservation.status_payload
        || pg_catalog.jsonb_build_object(
          'submissionUnknownAt', pg_catalog.clock_timestamp()
        ),
      updated_at = pg_catalog.clock_timestamp()
  WHERE reservation.id = v_submission.reservation_id;
  PERFORM private.bump_company_sync_version(
    v_submission.company_id,
    'documents_version'
  );
  RETURN true;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.process_api_tax_submission_result(
  p_correlation_id VARCHAR(128),
  p_result_key VARCHAR(128),
  p_payload_hash VARCHAR(64),
  p_result_status VARCHAR(32),
  p_confirmation_number VARCHAR(128),
  p_authority_request_id VARCHAR(256),
  p_error_code VARCHAR(128),
  p_error_message TEXT,
  p_occurred_at TIMESTAMPTZ
) RETURNS TABLE(processed BOOLEAN, idempotent_replay BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_event private.tax_callback_events%ROWTYPE;
  v_submission private.tax_submissions%ROWTYPE;
  v_reservation public.tax_invoice_reservations%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_tax_status public.tax_authority_status;
  v_reservation_status public.tax_invoice_reservation_status;
  v_submission_status public.tax_submission_status;
  v_response JSONB;
  v_task_id UUID;
  v_terminal BOOLEAN;
BEGIN
  IF pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_correlation_id, ''))) NOT BETWEEN 8 AND 128
     OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_result_key, ''))) NOT BETWEEN 8 AND 128
     OR p_payload_hash IS NULL
     OR p_payload_hash !~ '^[0-9a-f]{64}$'
     OR p_result_status NOT IN ('submitted', 'approved', 'rejected', 'error')
     OR (p_result_status = 'approved'
       AND pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_confirmation_number, ''))) NOT BETWEEN 1 AND 128)
     OR (p_confirmation_number IS NOT NULL AND pg_catalog.char_length(p_confirmation_number) > 128)
     OR (p_authority_request_id IS NOT NULL AND pg_catalog.char_length(p_authority_request_id) > 256)
     OR (p_error_code IS NOT NULL AND pg_catalog.char_length(p_error_code) > 128) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_RESULT_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tax-result:' || p_result_key, 0)
  );
  SELECT event.*
  INTO v_existing_event
  FROM private.tax_callback_events AS event
  WHERE event.event_id = p_result_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_event.payload_hash = p_payload_hash THEN
      RETURN QUERY SELECT true, true;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TAX_CALLBACK_PAYLOAD_CONFLICT';
  END IF;

  SELECT submission.*
  INTO v_submission
  FROM private.tax_submissions AS submission
  WHERE submission.correlation_id = p_correlation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TAX_SUBMISSION_NOT_FOUND';
  END IF;
  SELECT reservation.*
  INTO STRICT v_reservation
  FROM public.tax_invoice_reservations AS reservation
  WHERE reservation.id = v_submission.reservation_id
  FOR UPDATE;
  SELECT document.*
  INTO STRICT v_document
  FROM public.documents AS document
  WHERE document.id = v_submission.document_id
    AND document.company_id = v_submission.company_id
    AND document.document_type = 305
  FOR UPDATE;

  v_tax_status := CASE p_result_status
    WHEN 'submitted' THEN 'submitted'::public.tax_authority_status
    WHEN 'approved' THEN 'approved'::public.tax_authority_status
    WHEN 'rejected' THEN 'rejected'::public.tax_authority_status
    WHEN 'error' THEN 'failed'::public.tax_authority_status
  END;
  v_reservation_status := CASE p_result_status
    WHEN 'submitted' THEN 'submitted'::public.tax_invoice_reservation_status
    WHEN 'approved' THEN 'approved'::public.tax_invoice_reservation_status
    WHEN 'rejected' THEN 'rejected'::public.tax_invoice_reservation_status
    WHEN 'error' THEN 'failed'::public.tax_invoice_reservation_status
  END;
  v_submission_status := CASE p_result_status
    WHEN 'submitted' THEN 'submitted'::public.tax_submission_status
    WHEN 'approved' THEN 'approved'::public.tax_submission_status
    WHEN 'rejected' THEN 'rejected'::public.tax_submission_status
    WHEN 'error' THEN 'failed'::public.tax_submission_status
  END;
  v_terminal := v_submission.status IN ('approved', 'rejected', 'failed');
  IF v_terminal AND v_submission.status <> v_submission_status THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TAX_RESULT_STATE_CONFLICT';
  END IF;
  IF v_document.tax_authority_status = 'approved'
     AND p_result_status = 'approved'
     AND v_document.confirmation_number IS DISTINCT FROM pg_catalog.btrim(p_confirmation_number) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TAX_RESULT_CONFIRMATION_CONFLICT';
  END IF;

  v_response := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'status', p_result_status,
    'resultKey', p_result_key,
    'correlationId', p_correlation_id,
    'confirmationNumber', p_confirmation_number,
    'authorityRequestId', p_authority_request_id,
    'errorCode', p_error_code,
    'errorMessage', p_error_message,
    'occurredAt', p_occurred_at,
    'processedAt', pg_catalog.clock_timestamp()
  ));

  UPDATE private.tax_submissions AS submission
  SET status = v_submission_status,
      lease_token = NULL,
      lease_until = NULL,
      authority_request_id = COALESCE(
        NULLIF(pg_catalog.btrim(p_authority_request_id), ''),
        submission.authority_request_id
      ),
      response_payload = v_response,
      last_error = CASE WHEN p_result_status = 'error'
        THEN pg_catalog.left(
          COALESCE(NULLIF(p_error_message, ''), NULLIF(p_error_code, ''), 'Tax submission failed'),
          2000
        )
        ELSE NULL
      END,
      submitted_at = COALESCE(submission.submitted_at, pg_catalog.clock_timestamp()),
      resolved_at = CASE WHEN p_result_status IN ('approved', 'rejected', 'error')
        THEN COALESCE(p_occurred_at, pg_catalog.clock_timestamp())
        ELSE NULL
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE submission.id = v_submission.id;

  UPDATE public.documents AS document
  SET tax_authority_status = v_tax_status,
      confirmation_number = CASE WHEN p_result_status = 'approved'
        THEN pg_catalog.btrim(p_confirmation_number)
        ELSE document.confirmation_number
      END,
      tax_authority_response = v_response,
      entity_version = document.entity_version + 1,
      updated_at = pg_catalog.clock_timestamp()
  WHERE document.id = v_document.id;
  UPDATE public.tax_invoice_reservations AS reservation
  SET status = v_reservation_status,
      external_confirmation_number = CASE WHEN p_result_status = 'approved'
        THEN pg_catalog.btrim(p_confirmation_number)
        ELSE reservation.external_confirmation_number
      END,
      status_payload = reservation.status_payload || v_response,
      updated_at = pg_catalog.clock_timestamp()
  WHERE reservation.id = v_reservation.id;

  IF p_result_status = 'approved' AND NOT EXISTS (
    SELECT 1
    FROM public.document_tasks AS task
    WHERE task.document_id = v_document.id
      AND task.company_id = v_document.company_id
      AND task.task_type = 'generate'
  ) THEN
    v_task_id := extensions.gen_random_uuid();
    INSERT INTO public.document_tasks (
      id, task_key, lock_key, company_id, user_id, document_id,
      task_type, document_type, status, request_payload, expire_at,
      next_dispatch_at, created_at
    ) VALUES (
      v_task_id, v_task_id::TEXT, 'document:' || v_document.id::TEXT,
      v_document.company_id, v_submission.requested_by_user_id, v_document.id,
      'generate', 305, 'pending',
      pg_catalog.jsonb_build_object(
        'taskId', v_task_id::TEXT,
        'documentType', 305,
        'documentData', v_document.payload,
        'documentId', v_document.document_code,
        'documentNumber', v_document.document_number
      ),
      pg_catalog.clock_timestamp() + interval '24 hours',
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    );
  END IF;

  INSERT INTO private.tax_callback_events (
    event_id, payload_hash, company_id, document_id, reservation_id,
    callback_status, confirmation_number, error_code, error_message,
    oauth_session_id, occurred_at
  ) VALUES (
    p_result_key, p_payload_hash, v_submission.company_id,
    v_submission.document_id, v_submission.reservation_id,
    p_result_status, NULLIF(pg_catalog.btrim(p_confirmation_number), ''),
    NULLIF(pg_catalog.btrim(p_error_code), ''), p_error_message,
    p_correlation_id, p_occurred_at
  );
  PERFORM private.bump_company_sync_version(
    v_submission.company_id,
    'documents_version'
  );
  RETURN QUERY SELECT true, false;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.process_api_tax_callback(
  p_event_id VARCHAR,
  p_payload_hash VARCHAR(64),
  p_oauth_session_id VARCHAR(128),
  p_callback_status VARCHAR(32),
  p_confirmation_number VARCHAR(128),
  p_error_code VARCHAR(128),
  p_error_message TEXT,
  p_occurred_at TIMESTAMPTZ
) RETURNS TABLE(processed BOOLEAN, idempotent_replay BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT result.processed, result.idempotent_replay
  FROM private.process_api_tax_submission_result(
    p_oauth_session_id,
    p_event_id,
    p_payload_hash,
    p_callback_status,
    p_confirmation_number,
    NULL,
    p_error_code,
    p_error_message,
    p_occurred_at
  ) AS result
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.get_api_tax_submission_status(
  p_company_id UUID,
  p_document_id UUID
) RETURNS public.tax_submission_status
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT submission.status
  FROM private.tax_submissions AS submission
  WHERE submission.company_id = p_company_id
    AND submission.document_id = p_document_id
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

REVOKE ALL ON FUNCTION private.create_api_tax_invoice(UUID, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.claim_api_tax_submission_batch(UUID, INTEGER, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.retry_api_tax_submission(UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.mark_api_tax_submission_unknown(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.process_api_tax_submission_result(
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.get_api_tax_submission_status(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;

GRANT EXECUTE ON FUNCTION private.create_api_tax_invoice(UUID, JSONB, TIMESTAMPTZ)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.claim_api_tax_submission_batch(UUID, INTEGER, INTEGER, UUID)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.retry_api_tax_submission(UUID, UUID, TEXT, INTEGER)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.mark_api_tax_submission_unknown(UUID, UUID, TEXT)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.process_api_tax_submission_result(
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, TIMESTAMPTZ
) TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.get_api_tax_submission_status(UUID, UUID)
  TO smart_job_api;
