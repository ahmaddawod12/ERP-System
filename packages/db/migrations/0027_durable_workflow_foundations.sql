-- Expand-only workflow types. Existing public tax enums gain the explicit
-- submitted state; new worker state machines live in the private schema.
ALTER TYPE public.tax_authority_status
  ADD VALUE IF NOT EXISTS 'submitted' AFTER 'reserved';
--> statement-breakpoint
ALTER TYPE public.tax_invoice_reservation_status
  ADD VALUE IF NOT EXISTS 'submitted' AFTER 'reserved';
--> statement-breakpoint
CREATE TYPE public.email_delivery_status AS ENUM (
  'queued', 'sending', 'sent', 'failed', 'delivery_unknown'
);
--> statement-breakpoint
CREATE TYPE public.tax_submission_status AS ENUM (
  'queued', 'submitting', 'submitted', 'approved', 'rejected', 'failed',
  'submission_unknown'
);
--> statement-breakpoint
CREATE TYPE public.archive_run_lease_status AS ENUM (
  'pending', 'leased', 'completed', 'failed'
);
--> statement-breakpoint

-- Passwords are intentionally absent. Platform provisioning assigns strong
-- passwords out of band and injects only role-specific connection URLs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'smart_job_pdf') THEN
    CREATE ROLE smart_job_pdf LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS PASSWORD NULL CONNECTION LIMIT 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'smart_job_email') THEN
    CREATE ROLE smart_job_email LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS PASSWORD NULL CONNECTION LIMIT 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'smart_job_archiver') THEN
    CREATE ROLE smart_job_archiver LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS PASSWORD NULL CONNECTION LIMIT 1;
  END IF;
END
$$;
--> statement-breakpoint
-- The migration owner may assume worker roles for local permission tests and
-- production diagnostics. This grants no capability to the worker roles.
GRANT smart_job_pdf, smart_job_email, smart_job_archiver TO postgres;
--> statement-breakpoint
ALTER ROLE smart_job_pdf SET statement_timeout = '300s';
ALTER ROLE smart_job_pdf SET lock_timeout = '5s';
ALTER ROLE smart_job_pdf SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE smart_job_email SET statement_timeout = '30s';
ALTER ROLE smart_job_email SET lock_timeout = '3s';
ALTER ROLE smart_job_email SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE smart_job_archiver SET statement_timeout = '60min';
ALTER ROLE smart_job_archiver SET lock_timeout = '5s';
ALTER ROLE smart_job_archiver SET idle_in_transaction_session_timeout = '30s';
--> statement-breakpoint

CREATE TABLE "private"."archive_run_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"archive_key" varchar(64) NOT NULL,
	"data_type" varchar(32) NOT NULL,
	"status" "archive_run_lease_status" DEFAULT 'pending' NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_run_leases_attempt_count_check" CHECK ("private"."archive_run_leases"."attempt_count" BETWEEN 0 AND 100),
	CONSTRAINT "archive_run_leases_data_type_check" CHECK ("private"."archive_run_leases"."data_type" IN ('jobs', 'documents')),
	CONSTRAINT "archive_run_leases_lease_check" CHECK ((
      ("private"."archive_run_leases"."status" = 'leased' AND "private"."archive_run_leases"."lease_token" IS NOT NULL AND "private"."archive_run_leases"."lease_until" IS NOT NULL)
      OR ("private"."archive_run_leases"."status" <> 'leased' AND "private"."archive_run_leases"."lease_token" IS NULL AND "private"."archive_run_leases"."lease_until" IS NULL)
    ))
);
--> statement-breakpoint
CREATE TABLE "private"."document_email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"status" "email_delivery_status" DEFAULT 'queued' NOT NULL,
	"recipient_email" varchar(320) NOT NULL,
	"dispatch_attempts" integer DEFAULT 0 NOT NULL,
	"dispatch_lease_token" uuid,
	"dispatch_lease_until" timestamp with time zone,
	"next_dispatch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"send_lease_token" uuid,
	"send_lease_until" timestamp with time zone,
	"provider_message_id" varchar(256),
	"last_error" text,
	"manual_retry_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_email_deliveries_dispatch_attempts_check" CHECK ("private"."document_email_deliveries"."dispatch_attempts" BETWEEN 0 AND 100),
	CONSTRAINT "document_email_deliveries_send_attempts_check" CHECK ("private"."document_email_deliveries"."send_attempts" BETWEEN 0 AND 100),
	CONSTRAINT "document_email_deliveries_manual_retry_count_check" CHECK ("private"."document_email_deliveries"."manual_retry_count" BETWEEN 0 AND 20),
	CONSTRAINT "document_email_deliveries_dispatch_lease_check" CHECK ((
      ("private"."document_email_deliveries"."dispatch_lease_token" IS NULL AND "private"."document_email_deliveries"."dispatch_lease_until" IS NULL)
      OR ("private"."document_email_deliveries"."dispatch_lease_token" IS NOT NULL AND "private"."document_email_deliveries"."dispatch_lease_until" IS NOT NULL)
    )),
	CONSTRAINT "document_email_deliveries_send_lease_check" CHECK ((
      ("private"."document_email_deliveries"."status" = 'sending' AND "private"."document_email_deliveries"."send_lease_token" IS NOT NULL AND "private"."document_email_deliveries"."send_lease_until" IS NOT NULL)
      OR ("private"."document_email_deliveries"."status" <> 'sending' AND "private"."document_email_deliveries"."send_lease_token" IS NULL AND "private"."document_email_deliveries"."send_lease_until" IS NULL)
    )),
	CONSTRAINT "document_email_deliveries_sent_state_check" CHECK ((
      ("private"."document_email_deliveries"."status" = 'sent' AND "private"."document_email_deliveries"."sent_at" IS NOT NULL AND "private"."document_email_deliveries"."provider_message_id" IS NOT NULL)
      OR ("private"."document_email_deliveries"."status" <> 'sent' AND "private"."document_email_deliveries"."sent_at" IS NULL)
    )),
	CONSTRAINT "document_email_deliveries_recipient_check" CHECK (char_length(btrim("private"."document_email_deliveries"."recipient_email")) BETWEEN 3 AND 320
      AND "private"."document_email_deliveries"."recipient_email" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
);
--> statement-breakpoint
CREATE TABLE "private"."tax_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"correlation_id" varchar(128) NOT NULL,
	"status" "tax_submission_status" DEFAULT 'queued' NOT NULL,
	"request_payload" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"authority_request_id" varchar(256),
	"response_payload" jsonb,
	"last_error" text,
	"submitted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_submissions_attempt_count_check" CHECK ("private"."tax_submissions"."attempt_count" BETWEEN 0 AND 100),
	CONSTRAINT "tax_submissions_lease_check" CHECK ((
      ("private"."tax_submissions"."status" = 'submitting' AND "private"."tax_submissions"."lease_token" IS NOT NULL AND "private"."tax_submissions"."lease_until" IS NOT NULL)
      OR ("private"."tax_submissions"."status" <> 'submitting' AND "private"."tax_submissions"."lease_token" IS NULL AND "private"."tax_submissions"."lease_until" IS NULL)
    )),
	CONSTRAINT "tax_submissions_correlation_check" CHECK (char_length(btrim("private"."tax_submissions"."correlation_id")) BETWEEN 8 AND 128),
	CONSTRAINT "tax_submissions_request_payload_check" CHECK (jsonb_typeof("private"."tax_submissions"."request_payload") = 'object')
);
--> statement-breakpoint
ALTER TABLE "document_tasks" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_tasks" ADD COLUMN "processing_lease_token" uuid;--> statement-breakpoint
ALTER TABLE "document_tasks" ADD COLUMN "processing_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "private"."archive_run_leases" ADD CONSTRAINT "archive_run_leases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."document_email_deliveries" ADD CONSTRAINT "document_email_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."document_email_deliveries" ADD CONSTRAINT "document_email_deliveries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."tax_submissions" ADD CONSTRAINT "tax_submissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."tax_submissions" ADD CONSTRAINT "tax_submissions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."tax_submissions" ADD CONSTRAINT "tax_submissions_reservation_id_tax_invoice_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."tax_invoice_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "archive_run_leases_company_archive_type_unique" ON "private"."archive_run_leases" USING btree ("company_id","archive_key","data_type");--> statement-breakpoint
CREATE INDEX "archive_run_leases_queue_idx" ON "private"."archive_run_leases" USING btree ("status","lease_until","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_email_deliveries_document_unique" ON "private"."document_email_deliveries" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_email_deliveries_company_status_created_idx" ON "private"."document_email_deliveries" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX "document_email_deliveries_dispatch_queue_idx" ON "private"."document_email_deliveries" USING btree ("next_dispatch_at","created_at","id") WHERE "private"."document_email_deliveries"."status" = 'queued' AND "private"."document_email_deliveries"."dispatched_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_submissions_document_unique" ON "private"."tax_submissions" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_submissions_reservation_unique" ON "private"."tax_submissions" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_submissions_correlation_unique" ON "private"."tax_submissions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "tax_submissions_queue_idx" ON "private"."tax_submissions" USING btree ("next_attempt_at","created_at","id") WHERE "private"."tax_submissions"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "tax_submissions_company_status_created_idx" ON "private"."tax_submissions" USING btree ("company_id","status","created_at");--> statement-breakpoint
ALTER TABLE "document_tasks" ADD CONSTRAINT "document_tasks_processing_attempts_non_negative_check" CHECK ("document_tasks"."processing_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "document_tasks" ADD CONSTRAINT "document_tasks_processing_lease_consistency_check" CHECK ((
      ("document_tasks"."processing_lease_token" IS NULL AND "document_tasks"."processing_lease_until" IS NULL)
      OR ("document_tasks"."processing_lease_token" IS NOT NULL AND "document_tasks"."processing_lease_until" IS NOT NULL)
    ));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_archive_run_lease(
  p_company_id UUID,
  p_archive_key TEXT,
  p_data_type TEXT,
  p_snapshot_at TIMESTAMPTZ,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 3600
) RETURNS TABLE (
  lease_id UUID,
  claimed BOOLEAN,
  attempt_count INTEGER,
  snapshot_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
BEGIN
  IF p_company_id IS NULL
     OR p_lease_token IS NULL
     OR p_snapshot_at IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_archive_key, ''))) NOT BETWEEN 1 AND 64
     OR p_data_type NOT IN ('jobs', 'documents')
     OR p_lease_seconds NOT BETWEEN 60 AND 7200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_LEASE_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.companies AS company
    WHERE company.id = p_company_id AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ARCHIVE_COMPANY_NOT_FOUND';
  END IF;

  INSERT INTO private.archive_run_leases (
    company_id, archive_key, data_type, status, snapshot_at
  ) VALUES (
    p_company_id,
    pg_catalog.btrim(p_archive_key),
    p_data_type,
    'pending',
    p_snapshot_at
  )
  ON CONFLICT (company_id, archive_key, data_type) DO NOTHING;

  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.company_id = p_company_id
    AND lease.archive_key = pg_catalog.btrim(p_archive_key)
    AND lease.data_type = p_data_type
  FOR UPDATE;

  IF v_lease.status = 'completed'
     OR (
       v_lease.status = 'leased'
       AND v_lease.lease_until > pg_catalog.clock_timestamp()
     ) THEN
    lease_id := v_lease.id;
    claimed := false;
    attempt_count := v_lease.attempt_count;
    snapshot_at := v_lease.snapshot_at;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE private.archive_run_leases AS lease
  SET status = 'leased',
      snapshot_at = LEAST(lease.snapshot_at, p_snapshot_at),
      lease_token = p_lease_token,
      lease_until = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_lease_seconds),
      attempt_count = lease.attempt_count + 1,
      last_error = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE lease.id = v_lease.id
  RETURNING lease.* INTO v_lease;

  lease_id := v_lease.id;
  claimed := true;
  attempt_count := v_lease.attempt_count;
  snapshot_at := v_lease.snapshot_at;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.finish_archive_run_lease(
  p_lease_id UUID,
  p_lease_token UUID,
  p_succeeded BOOLEAN,
  p_error TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_lease_id IS NULL OR p_lease_token IS NULL OR p_succeeded IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_LEASE_RESULT_INVALID';
  END IF;
  UPDATE private.archive_run_leases AS lease
  SET status = (CASE WHEN p_succeeded THEN 'completed' ELSE 'failed' END)::public.archive_run_lease_status,
      lease_token = NULL,
      lease_until = NULL,
      last_error = CASE
        WHEN p_succeeded THEN NULL
        ELSE pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'Archive run failed'), 2000)
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

-- New private objects stay opt-in even if platform defaults differ by project.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON TABLE
  private.archive_run_leases,
  private.document_email_deliveries,
  private.tax_submissions
FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
  smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.claim_archive_run_lease(
  UUID, TEXT, TEXT, TIMESTAMPTZ, UUID, INTEGER
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
  smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.finish_archive_run_lease(
  UUID, UUID, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
  smart_job_pdf, smart_job_email;

GRANT USAGE ON SCHEMA private TO smart_job_pdf, smart_job_email, smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.claim_archive_run_lease(
  UUID, TEXT, TEXT, TIMESTAMPTZ, UUID, INTEGER
) TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.finish_archive_run_lease(
  UUID, UUID, BOOLEAN, TEXT
) TO smart_job_archiver;
