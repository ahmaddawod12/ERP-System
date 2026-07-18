-- Tax callback processing: idempotent event tracking and document status updates.
--
-- The cloudrun-tax service forwards authenticated callbacks to a protected
-- internal main-API endpoint. This migration adds the private callback event
-- log, an indexed OAuth-session link on tax invoice reservations, and the
-- single SECURITY DEFINER entrypoint that atomically records the event and
-- updates the document and reservation status.

ALTER TABLE public.tax_invoice_reservations
  ADD COLUMN oauth_session_id VARCHAR(128);--> statement-breakpoint

CREATE UNIQUE INDEX tax_invoice_reservations_oauth_session_id_unique
  ON public.tax_invoice_reservations (oauth_session_id)
  WHERE oauth_session_id IS NOT NULL;--> statement-breakpoint

CREATE TABLE private.tax_callback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(128) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  reservation_id UUID REFERENCES public.tax_invoice_reservations(id) ON DELETE SET NULL,
  callback_status VARCHAR(32) NOT NULL,
  confirmation_number VARCHAR(128),
  error_code VARCHAR(128),
  error_message TEXT,
  oauth_session_id VARCHAR(128) NOT NULL,
  occurred_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT tax_callback_events_event_id_length_check
    CHECK (length(event_id) >= 8 AND length(event_id) <= 128),
  CONSTRAINT tax_callback_events_payload_hash_length_check
    CHECK (length(payload_hash) = 64),
  CONSTRAINT tax_callback_events_callback_status_check
    CHECK (callback_status IN ('approved', 'rejected', 'error'))
);--> statement-breakpoint

CREATE UNIQUE INDEX tax_callback_events_event_id_unique
  ON private.tax_callback_events (event_id);--> statement-breakpoint

CREATE INDEX tax_callback_events_company_created_idx
  ON private.tax_callback_events (company_id, created_at DESC);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.bind_api_tax_approval_session(
  p_document_id UUID,
  p_oauth_session_id VARCHAR(128)
) RETURNS TABLE(bound BOOLEAN, idempotent_replay BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.tax_invoice_reservations%ROWTYPE;
  v_document_type INTEGER;
BEGIN
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_APPROVAL_DOCUMENT_ID_INVALID';
  END IF;
  IF p_oauth_session_id IS NULL OR length(p_oauth_session_id) < 1 OR length(p_oauth_session_id) > 128 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_APPROVAL_OAUTH_SESSION_ID_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tax-approval-session:' || p_oauth_session_id, 0)
  );

  SELECT reservation.*
  INTO v_reservation
  FROM public.tax_invoice_reservations reservation
  INNER JOIN public.documents document ON document.id = reservation.document_id
  WHERE reservation.document_id = p_document_id
  FOR UPDATE OF reservation;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TAX_APPROVAL_RESERVATION_NOT_FOUND';
  END IF;
  SELECT document_type INTO v_document_type
  FROM public.documents
  WHERE id = v_reservation.document_id;
  IF v_document_type <> 305 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_APPROVAL_NOT_TAX_INVOICE';
  END IF;
  IF v_reservation.oauth_session_id IS NOT NULL THEN
    IF v_reservation.oauth_session_id = p_oauth_session_id THEN
      RETURN QUERY SELECT true, true;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TAX_APPROVAL_SESSION_CONFLICT';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tax_invoice_reservations reservation
    WHERE reservation.oauth_session_id = p_oauth_session_id
      AND reservation.id <> v_reservation.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TAX_APPROVAL_SESSION_CONFLICT';
  END IF;
  IF v_reservation.status NOT IN ('reserved', 'submitted') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_APPROVAL_RESERVATION_NOT_SUBMITTABLE';
  END IF;

  UPDATE public.tax_invoice_reservations
  SET oauth_session_id = p_oauth_session_id,
      status = 'submitted',
      status_payload = status_payload || jsonb_build_object(
        'oauthSessionId', p_oauth_session_id,
        'submittedAt', pg_catalog.clock_timestamp()
      ),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_reservation.id;

  RETURN QUERY SELECT true, false;
END;
$$;--> statement-breakpoint

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_event private.tax_callback_events%ROWTYPE;
  v_reservation public.tax_invoice_reservations%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_new_tax_status public.tax_authority_status;
  v_new_reservation_status public.tax_invoice_reservation_status;
  v_callback_response JSONB;
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) < 8 OR length(p_event_id) > 128 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_CALLBACK_INVALID_EVENT_ID';
  END IF;
  IF p_payload_hash IS NULL OR length(p_payload_hash) <> 64 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_CALLBACK_INVALID_PAYLOAD_HASH';
  END IF;
  IF p_oauth_session_id IS NULL OR length(p_oauth_session_id) < 1 OR length(p_oauth_session_id) > 128 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_CALLBACK_INVALID_OAUTH_SESSION_ID';
  END IF;
  IF p_callback_status NOT IN ('approved', 'rejected', 'error') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_CALLBACK_INVALID_STATUS';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tax-callback-event:' || p_event_id, 0)
  );

  -- Idempotency: lock existing event by event_id
  SELECT * INTO v_existing_event
  FROM private.tax_callback_events
  WHERE event_id = p_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_event.payload_hash = p_payload_hash THEN
      RETURN QUERY SELECT true, true;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TAX_CALLBACK_PAYLOAD_CONFLICT';
  END IF;

  -- Look up the reservation by OAuth session ID
  SELECT * INTO v_reservation
  FROM public.tax_invoice_reservations
  WHERE oauth_session_id = p_oauth_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TAX_CALLBACK_RESERVATION_NOT_FOUND';
  END IF;

  -- Lock the linked document
  SELECT * INTO v_document
  FROM public.documents
  WHERE id = v_reservation.document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TAX_CALLBACK_DOCUMENT_NOT_FOUND';
  END IF;

  -- Only tax invoices (doc type 305) participate in the tax workflow
  IF v_document.document_type <> 305 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_CALLBACK_NOT_TAX_INVOICE';
  END IF;

  -- Map callback status to internal enums
  v_new_tax_status := CASE p_callback_status
    WHEN 'approved' THEN 'approved'::public.tax_authority_status
    WHEN 'rejected' THEN 'rejected'::public.tax_authority_status
    WHEN 'error' THEN 'failed'::public.tax_authority_status
  END;

  v_new_reservation_status := CASE p_callback_status
    WHEN 'approved' THEN 'approved'::public.tax_invoice_reservation_status
    WHEN 'rejected' THEN 'rejected'::public.tax_invoice_reservation_status
    WHEN 'error' THEN 'failed'::public.tax_invoice_reservation_status
  END;

  v_callback_response := jsonb_build_object(
    'status', p_callback_status,
    'eventId', p_event_id,
    'oauthSessionId', p_oauth_session_id,
    'confirmationNumber', p_confirmation_number,
    'errorCode', p_error_code,
    'errorMessage', p_error_message,
    'occurredAt', p_occurred_at,
    'processedAt', pg_catalog.clock_timestamp()
  );

  -- Update the document
  UPDATE public.documents
  SET tax_authority_status = v_new_tax_status,
      confirmation_number = COALESCE(p_confirmation_number, documents.confirmation_number),
      tax_authority_response = v_callback_response,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_document.id;

  -- Update the reservation
  UPDATE public.tax_invoice_reservations
  SET status = v_new_reservation_status,
      external_confirmation_number = COALESCE(p_confirmation_number, tax_invoice_reservations.external_confirmation_number),
      status_payload = tax_invoice_reservations.status_payload
        || jsonb_build_object(
          'callbackStatus', p_callback_status,
          'errorCode', p_error_code,
          'errorMessage', p_error_message,
          'processedAt', pg_catalog.clock_timestamp()
        ),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_reservation.id;

  -- Record the event
  INSERT INTO private.tax_callback_events (
    event_id, payload_hash, company_id, document_id, reservation_id,
    callback_status, confirmation_number, error_code, error_message,
    oauth_session_id, occurred_at
  ) VALUES (
    p_event_id, p_payload_hash, v_reservation.company_id, v_document.id, v_reservation.id,
    p_callback_status, p_confirmation_number, p_error_code, p_error_message,
    p_oauth_session_id, p_occurred_at
  );

  -- Bump sync version so clients see the updated document
  PERFORM private.bump_company_sync_version(v_reservation.company_id, 'documents_version');

  RETURN QUERY SELECT true, false;
END;
$$;--> statement-breakpoint

-- Bounded cleanup for old callback events (called by the maintenance workload)
CREATE OR REPLACE FUNCTION private.cleanup_tax_callback_events(
  p_retention_days INTEGER DEFAULT 90
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INTEGER;
  v_retention INTEGER := LEAST(GREATEST(COALESCE(p_retention_days, 90), 1), 365);
BEGIN
  DELETE FROM private.tax_callback_events
  WHERE created_at < pg_catalog.clock_timestamp()
    - pg_catalog.make_interval(days => v_retention);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.process_api_tax_callback(
  VARCHAR, VARCHAR(64), VARCHAR(128), VARCHAR(32),
  VARCHAR(128), VARCHAR(128), TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.bind_api_tax_approval_session(UUID, VARCHAR(128))
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.cleanup_tax_callback_events(INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.process_api_tax_callback(
  VARCHAR, VARCHAR(64), VARCHAR(128), VARCHAR(32),
  VARCHAR(128), VARCHAR(128), TEXT, TIMESTAMPTZ
) TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.bind_api_tax_approval_session(UUID, VARCHAR(128))
  TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.cleanup_tax_callback_events(INTEGER)
  TO smart_job_api;
