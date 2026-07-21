-- Batch 5: immutable, leased and resumable monthly archive segments.
--
-- `public.archive_runs` is the user-visible, durable object ledger. The
-- private lease row serializes one company/month/type writer and preserves a
-- snapshot plus segment number across retries. The archiver role receives only
-- the narrow SECURITY DEFINER functions declared below.

ALTER TABLE public.archive_runs
  ALTER COLUMN archive_key TYPE VARCHAR(64),
  ALTER COLUMN checksum TYPE VARCHAR(64);
--> statement-breakpoint

ALTER TABLE private.archive_run_leases
  ADD COLUMN period_start TIMESTAMPTZ,
  ADD COLUMN period_end TIMESTAMPTZ,
  ADD COLUMN segment INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint

UPDATE private.archive_run_leases AS lease
SET period_start = CASE
      WHEN lease.archive_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        pg_catalog.make_timestamptz(
          pg_catalog.split_part(lease.archive_key, '-', 1)::INTEGER,
          pg_catalog.split_part(lease.archive_key, '-', 2)::INTEGER,
          1, 0, 0, 0, 'UTC'
        )
      ELSE pg_catalog.date_trunc('month', lease.snapshot_at) - INTERVAL '1 month'
    END,
    period_end = CASE
      WHEN lease.archive_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        pg_catalog.make_timestamptz(
          pg_catalog.split_part(lease.archive_key, '-', 1)::INTEGER,
          pg_catalog.split_part(lease.archive_key, '-', 2)::INTEGER,
          1, 0, 0, 0, 'UTC'
        ) + INTERVAL '1 month'
      ELSE pg_catalog.date_trunc('month', lease.snapshot_at)
    END
WHERE lease.period_start IS NULL OR lease.period_end IS NULL;
--> statement-breakpoint

ALTER TABLE private.archive_run_leases
  ALTER COLUMN period_start SET NOT NULL,
  ALTER COLUMN period_end SET NOT NULL;
--> statement-breakpoint

ALTER TABLE public.archive_runs
  ADD COLUMN snapshot_at TIMESTAMPTZ,
  ADD COLUMN segment INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN delete_cursor INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN storage_generation BIGINT,
  ADD COLUMN id_manifest_path VARCHAR(1024),
  ADD COLUMN id_manifest_checksum VARCHAR(64),
  ADD COLUMN id_manifest_generation BIGINT;
--> statement-breakpoint

UPDATE public.archive_runs AS run
SET snapshot_at = COALESCE(run.completed_at, run.created_at)
WHERE run.snapshot_at IS NULL;
--> statement-breakpoint

ALTER TABLE public.archive_runs
  ALTER COLUMN snapshot_at SET NOT NULL;
--> statement-breakpoint

CREATE INDEX archive_runs_company_type_snapshot_idx
  ON public.archive_runs (company_id, data_type, snapshot_at, segment);
--> statement-breakpoint

ALTER TABLE private.archive_run_leases
  ADD CONSTRAINT archive_run_leases_period_check CHECK (
    period_end > period_start AND snapshot_at >= period_end
  ),
  ADD CONSTRAINT archive_run_leases_segment_positive_check CHECK (segment > 0);
--> statement-breakpoint

ALTER TABLE public.archive_runs
  ADD CONSTRAINT archive_runs_segment_positive_check CHECK (segment > 0),
  ADD CONSTRAINT archive_runs_counts_check CHECK (
    doc_count >= 0
    AND deleted_count >= 0
    AND delete_cursor >= 0
    AND deleted_count <= doc_count
    AND delete_cursor <= doc_count
  ),
  ADD CONSTRAINT archive_runs_storage_generation_check CHECK (
    storage_generation IS NULL OR storage_generation > 0
  ),
  ADD CONSTRAINT archive_runs_id_generation_check CHECK (
    id_manifest_generation IS NULL OR id_manifest_generation > 0
  ),
  ADD CONSTRAINT archive_runs_checksum_check CHECK (
    checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT archive_runs_id_checksum_check CHECK (
    id_manifest_checksum IS NULL OR id_manifest_checksum ~ '^[0-9a-f]{64}$'
  );
--> statement-breakpoint

DROP FUNCTION IF EXISTS private.claim_archive_run_lease(
  UUID, TEXT, TEXT, TIMESTAMPTZ, UUID, INTEGER
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.list_archiver_companies()
RETURNS TABLE (company_id UUID, public_company_id BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT company.id, company.public_company_id
  FROM public.companies AS company
  WHERE company.status = 'active'
  ORDER BY company.public_company_id ASC
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.list_archiver_candidates(
  p_cutoff_end TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 2000
) RETURNS TABLE (
  company_id UUID,
  public_company_id BIGINT,
  data_type TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_cutoff_end IS NULL
     OR p_cutoff_end <> (
       pg_catalog.date_trunc('month', p_cutoff_end AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
     )
     OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_CANDIDATE_QUERY_INVALID';
  END IF;

  RETURN QUERY
  WITH candidate_periods AS (
    SELECT
      job.company_id,
      'jobs'::TEXT AS data_type,
      pg_catalog.date_trunc('month', job.finished_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AS period_start
    FROM public.jobs AS job
    WHERE job.status = 'finished'
      AND job.finished_at IS NOT NULL
      AND job.finished_at < p_cutoff_end
    GROUP BY job.company_id,
      pg_catalog.date_trunc('month', job.finished_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'

    UNION ALL

    SELECT
      document.company_id,
      'documents'::TEXT AS data_type,
      pg_catalog.date_trunc('month', document.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AS period_start
    FROM public.documents AS document
    WHERE document.created_at < p_cutoff_end
      AND document.generation_status = 'completed'
      AND (document.document_type <> 305 OR document.tax_authority_status = 'approved')
    GROUP BY document.company_id,
      pg_catalog.date_trunc('month', document.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  )
  SELECT
    company.id,
    company.public_company_id,
    candidate.data_type,
    candidate.period_start,
    candidate.period_start + INTERVAL '1 month'
  FROM candidate_periods AS candidate
  INNER JOIN public.companies AS company
    ON company.id = candidate.company_id
   AND company.status = 'active'
  ORDER BY
    candidate.period_start ASC,
    company.public_company_id ASC,
    CASE WHEN candidate.data_type = 'documents' THEN 0 ELSE 1 END ASC
  LIMIT p_limit;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_archive_run_lease(
  p_company_id UUID,
  p_archive_key TEXT,
  p_data_type TEXT,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ,
  p_snapshot_at TIMESTAMPTZ,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 3600
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
  v_run public.archive_runs%ROWTYPE;
  v_full_key TEXT;
  v_claimed BOOLEAN := false;
BEGIN
  IF p_company_id IS NULL
     OR p_lease_token IS NULL
     OR p_archive_key IS NULL
     OR p_archive_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     OR p_data_type IS NULL
     OR p_data_type NOT IN ('jobs', 'documents')
     OR p_period_start IS NULL
     OR p_period_end IS NULL
     OR p_period_end <> p_period_start + INTERVAL '1 month'
     OR p_snapshot_at IS NULL
     OR p_snapshot_at < p_period_end
     OR p_lease_seconds IS NULL
     OR p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_LEASE_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.companies AS company
    WHERE company.id = p_company_id AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ARCHIVE_COMPANY_NOT_FOUND';
  END IF;

  -- The transaction-scoped advisory lock prevents two schedulers from both
  -- allocating a segment before either lease row is visible.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::TEXT || ':' || p_archive_key || ':' || p_data_type,
      0
    )
  );

  INSERT INTO private.archive_run_leases (
    company_id, archive_key, data_type, status, period_start, period_end,
    snapshot_at, segment
  ) VALUES (
    p_company_id, p_archive_key, p_data_type, 'pending', p_period_start,
    p_period_end, p_snapshot_at, 1
  )
  ON CONFLICT (company_id, archive_key, data_type) DO NOTHING;

  SELECT lease.*
  INTO STRICT v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.company_id = p_company_id
    AND lease.archive_key = p_archive_key
    AND lease.data_type = p_data_type
  FOR UPDATE;

  IF v_lease.period_start <> p_period_start OR v_lease.period_end <> p_period_end THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_PERIOD_CONFLICT';
  END IF;

  IF v_lease.status = 'leased'
     AND v_lease.lease_until > pg_catalog.clock_timestamp() THEN
    v_claimed := false;
  ELSE
    IF v_lease.attempt_count >= 100 THEN
      RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'ARCHIVE_ATTEMPTS_EXHAUSTED';
    END IF;
    UPDATE private.archive_run_leases AS lease
    SET status = 'leased',
        snapshot_at = CASE
          WHEN lease.status IN ('pending', 'completed') THEN p_snapshot_at
          ELSE lease.snapshot_at
        END,
        segment = CASE
          WHEN lease.status = 'completed' THEN lease.segment + 1
          ELSE lease.segment
        END,
        lease_token = p_lease_token,
        lease_until = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_lease_seconds),
        attempt_count = lease.attempt_count + 1,
        last_error = NULL,
        updated_at = pg_catalog.clock_timestamp()
    WHERE lease.id = v_lease.id
    RETURNING lease.* INTO STRICT v_lease;
    v_claimed := true;
  END IF;

  v_full_key := pg_catalog.format(
    '%s-%s-s%s',
    v_lease.archive_key,
    CASE WHEN v_lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
    pg_catalog.lpad(v_lease.segment::TEXT, 6, '0')
  );

  SELECT run.*
  INTO v_run
  FROM public.archive_runs AS run
  WHERE run.company_id = v_lease.company_id
    AND run.archive_key = v_full_key
    AND run.data_type = v_lease.data_type;

  IF v_claimed AND v_run.id IS NOT NULL AND v_run.status = 'failed' THEN
    UPDATE public.archive_runs AS run
    SET status = 'uploaded_not_deleted'
    WHERE run.id = v_run.id
    RETURNING run.* INTO STRICT v_run;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'leaseId', v_lease.id,
    'claimed', v_claimed,
    'attemptCount', v_lease.attempt_count,
    'periodStart', v_lease.period_start,
    'periodEnd', v_lease.period_end,
    'snapshotAt', v_lease.snapshot_at,
    'leaseUntil', v_lease.lease_until,
    'segment', v_lease.segment,
    'archiveKey', v_full_key,
    'runId', v_run.id,
    'runStatus', v_run.status,
    'docCount', COALESCE(v_run.doc_count, 0),
    'deleteCursor', COALESCE(v_run.delete_cursor, 0),
    'storagePath', v_run.storage_path,
    'checksum', v_run.checksum,
    'storageGeneration', v_run.storage_generation::TEXT,
    'idManifestPath', v_run.id_manifest_path,
    'idManifestChecksum', v_run.id_manifest_checksum,
    'idManifestGeneration', v_run.id_manifest_generation::TEXT
  );
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.renew_archive_run_lease(
  p_lease_id UUID,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 3600
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_until TIMESTAMPTZ;
BEGIN
  IF p_lease_id IS NULL OR p_lease_token IS NULL
     OR p_lease_seconds IS NULL
     OR p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_LEASE_RENEW_INVALID';
  END IF;
  UPDATE private.archive_run_leases AS lease
  SET lease_until = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = pg_catalog.clock_timestamp()
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
  RETURNING lease.lease_until INTO v_until;
  IF v_until IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;
  RETURN v_until;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.read_archiver_jobs_page(
  p_lease_id UUID,
  p_lease_token UUID,
  p_after_finished_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 500
) RETURNS TABLE (source_id UUID, cursor_at TIMESTAMPTZ, record JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
BEGIN
  IF p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 500
     OR ((p_after_finished_at IS NULL) <> (p_after_id IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_PAGE_INVALID';
  END IF;
  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.data_type = 'jobs'
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
    AND lease.lease_until > pg_catalog.clock_timestamp();
  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;

  RETURN QUERY
  SELECT
    job.id,
    job.finished_at,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'id', job.job_no::TEXT,
      'title', COALESCE(job.title, ''),
      'description', COALESCE(job.description, ''),
      'notes', job.notes,
      'location', job.location,
      'address', job.address,
      'category', job.category,
      'priority', job.priority,
      'dueDate', job.due_at,
      'status', job.status,
      'clientId', client.client_no,
      'client', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'name', COALESCE(job.client_name_snapshot, client.name),
        'phone', COALESCE(job.client_phone_snapshot, client.phone)
      )),
      'assignee', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'memberNo', assignee.member_no,
        'name', COALESCE(assignee.display_name, assignee_user.display_name, assignee_user.email, job.assigned_member_name_snapshot)
      )),
      'creator', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'memberNo', creator.member_no,
        'name', COALESCE(creator.display_name, creator_user.display_name, creator_user.email, job.created_by_name_snapshot)
      )),
      'createdAt', job.created_at,
      'updatedAt', job.updated_at,
      'finishedAt', job.finished_at,
      'isCertificate', job.is_cert,
      'meta', job.meta,
      'attachments', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'attachmentId', attachment.id,
            'kind', attachment.kind,
            'storagePath', attachment.storage_path,
            'createdAt', attachment.created_at
          ) ORDER BY attachment.created_at, attachment.id
        )
        FROM public.job_attachments AS attachment
        WHERE attachment.job_id = job.id
      ), '[]'::JSONB),
      'partsUsed', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'partNo', part.part_no,
            'name', usage.part_name_snapshot,
            'quantity', usage.quantity
          )) ORDER BY usage.created_at, usage.id
        )
        FROM public.job_part_usages AS usage
        LEFT JOIN public.inventory_parts AS part ON part.id = usage.inventory_part_id
        WHERE usage.job_id = job.id
      ), '[]'::JSONB)
    ))
  FROM public.jobs AS job
  LEFT JOIN public.clients AS client
    ON client.id = job.client_id AND client.company_id = job.company_id
  LEFT JOIN public.company_memberships AS assignee
    ON assignee.id = job.assigned_membership_id AND assignee.company_id = job.company_id
  LEFT JOIN public.app_users AS assignee_user ON assignee_user.id = assignee.user_id
  LEFT JOIN public.company_memberships AS creator
    ON creator.id = job.created_by_membership_id AND creator.company_id = job.company_id
  LEFT JOIN public.app_users AS creator_user ON creator_user.id = creator.user_id
  WHERE job.company_id = v_lease.company_id
    AND job.status = 'finished'
    AND job.finished_at >= v_lease.period_start
    AND job.finished_at < v_lease.period_end
    AND job.updated_at <= v_lease.snapshot_at
    AND NOT EXISTS (
      SELECT 1 FROM public.document_job_links AS link WHERE link.job_id = job.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM private.file_upload_sessions AS upload WHERE upload.target_job_id = job.id
    )
    AND (
      p_after_finished_at IS NULL
      OR (job.finished_at, job.id) > (p_after_finished_at, p_after_id)
    )
  ORDER BY job.finished_at ASC, job.id ASC
  LIMIT p_limit;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.read_archiver_documents_page(
  p_lease_id UUID,
  p_lease_token UUID,
  p_after_created_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 500
) RETURNS TABLE (source_id UUID, cursor_at TIMESTAMPTZ, record JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
BEGIN
  IF p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 500
     OR ((p_after_created_at IS NULL) <> (p_after_id IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_PAGE_INVALID';
  END IF;
  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.data_type = 'documents'
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
    AND lease.lease_until > pg_catalog.clock_timestamp();
  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;

  RETURN QUERY
  SELECT
    document.id,
    document.created_at,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'id', document.document_code,
      'documentId', document.document_code,
      'documentType', document.document_type,
      'documentNumber', document.document_number,
      'generationStatus', document.generation_status,
      'taxAuthorityStatus', document.tax_authority_status,
      'client', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'name', document.client_name_snapshot,
        'phone', document.client_phone_snapshot,
        'city', document.client_city_snapshot,
        'vatNumber', document.client_vat_snapshot
      )),
      'creator', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'memberNo', creator.member_no,
        'name', COALESCE(creator.display_name, creator_user.display_name, creator_user.email)
      )),
      'language', document.language,
      'date', document.document_date,
      'notes', document.notes,
      'totalBeforeVat', document.total_before_vat,
      'vatAmount', document.vat_amount,
      'totalWithVat', document.total_with_vat,
      'confirmationNumber', document.confirmation_number,
      'taxAuthorityResponseData', document.tax_authority_response,
      'emailSent', document.email_sent,
      'storagePath', document.storage_path,
      'documentData', document.payload,
      'createdAt', document.created_at,
      'updatedAt', document.updated_at,
      'items', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'lineNo', item.line_no,
            'description', item.description,
            'quantity', item.quantity,
            'unitPrice', item.unit_price,
            'lineTotal', item.line_total,
            'metadata', item.metadata
          ) ORDER BY item.line_no
        )
        FROM public.document_items AS item
        WHERE item.document_id = document.id
      ), '[]'::JSONB),
      'jobsData', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('jobId', linked_job.job_no::TEXT)
          ORDER BY linked_job.job_no
        )
        FROM public.document_job_links AS link
        INNER JOIN public.jobs AS linked_job ON linked_job.id = link.job_id
        WHERE link.document_id = document.id
      ), '[]'::JSONB)
    ))
  FROM public.documents AS document
  LEFT JOIN public.company_memberships AS creator
    ON creator.id = document.created_by_membership_id
   AND creator.company_id = document.company_id
  LEFT JOIN public.app_users AS creator_user ON creator_user.id = creator.user_id
  WHERE document.company_id = v_lease.company_id
    AND document.created_at >= v_lease.period_start
    AND document.created_at < v_lease.period_end
    AND document.updated_at <= v_lease.snapshot_at
    AND document.generation_status = 'completed'
    AND (document.document_type <> 305 OR document.tax_authority_status = 'approved')
    AND NOT EXISTS (
      SELECT 1
      FROM public.document_tasks AS task
      WHERE task.document_id = document.id AND task.status <> 'completed'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM private.document_email_deliveries AS delivery
      WHERE delivery.document_id = document.id AND delivery.status <> 'sent'
    )
    AND (
      p_after_created_at IS NULL
      OR (document.created_at, document.id) > (p_after_created_at, p_after_id)
    )
  ORDER BY document.created_at ASC, document.id ASC
  LIMIT p_limit;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.record_archiver_uploaded_run(
  p_lease_id UUID,
  p_lease_token UUID,
  p_doc_count INTEGER,
  p_storage_path TEXT,
  p_checksum TEXT,
  p_storage_generation BIGINT,
  p_id_manifest_path TEXT,
  p_id_manifest_checksum TEXT,
  p_id_manifest_generation BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
  v_run public.archive_runs%ROWTYPE;
  v_public_company_id BIGINT;
  v_full_key TEXT;
  v_expected_storage_path TEXT;
  v_expected_id_path TEXT;
BEGIN
  IF p_lease_id IS NULL
     OR p_lease_token IS NULL
     OR p_doc_count IS NULL
     OR p_doc_count NOT BETWEEN 1 AND 1000000
     OR p_storage_path IS NULL
     OR p_checksum IS NULL
     OR p_checksum !~ '^[0-9a-f]{64}$'
     OR p_storage_generation IS NULL
     OR p_id_manifest_path IS NULL
     OR p_id_manifest_checksum IS NULL
     OR p_id_manifest_checksum !~ '^[0-9a-f]{64}$'
     OR p_id_manifest_generation IS NULL
     OR p_storage_generation <= 0
     OR p_id_manifest_generation <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_UPLOAD_INVALID';
  END IF;
  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
    AND lease.lease_until > pg_catalog.clock_timestamp()
  FOR UPDATE OF lease;
  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;
  SELECT company.public_company_id
  INTO STRICT v_public_company_id
  FROM public.companies AS company
  WHERE company.id = v_lease.company_id;

  v_full_key := pg_catalog.format(
    '%s-%s-s%s',
    v_lease.archive_key,
    CASE WHEN v_lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
    pg_catalog.lpad(v_lease.segment::TEXT, 6, '0')
  );
  v_expected_storage_path := pg_catalog.format(
    'companies/%s/archives/%s.json', v_public_company_id, v_full_key
  );
  v_expected_id_path := pg_catalog.format(
    'companies/%s/archives/%s.ids.json', v_public_company_id, v_full_key
  );
  IF p_storage_path <> v_expected_storage_path OR p_id_manifest_path <> v_expected_id_path THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_OBJECT_PATH_INVALID';
  END IF;

  INSERT INTO public.archive_runs (
    company_id, archive_key, data_type, status, snapshot_at, segment,
    doc_count, deleted_count, delete_cursor, storage_path, checksum,
    storage_generation, id_manifest_path, id_manifest_checksum,
    id_manifest_generation, created_at, completed_at
  ) VALUES (
    v_lease.company_id, v_full_key, v_lease.data_type,
    'uploaded_not_deleted', v_lease.snapshot_at, v_lease.segment,
    p_doc_count, 0, 0, p_storage_path, p_checksum,
    p_storage_generation, p_id_manifest_path, p_id_manifest_checksum,
    p_id_manifest_generation, pg_catalog.clock_timestamp(), NULL
  )
  ON CONFLICT (company_id, archive_key, data_type) DO UPDATE
  SET status = 'uploaded_not_deleted'
  WHERE public.archive_runs.doc_count = EXCLUDED.doc_count
    AND public.archive_runs.storage_path = EXCLUDED.storage_path
    AND public.archive_runs.checksum = EXCLUDED.checksum
    AND public.archive_runs.storage_generation = EXCLUDED.storage_generation
    AND public.archive_runs.id_manifest_path = EXCLUDED.id_manifest_path
    AND public.archive_runs.id_manifest_checksum = EXCLUDED.id_manifest_checksum
    AND public.archive_runs.id_manifest_generation = EXCLUDED.id_manifest_generation
  RETURNING public.archive_runs.* INTO v_run;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'ARCHIVE_UPLOAD_CONFLICT';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'runId', v_run.id,
    'docCount', v_run.doc_count,
    'deleteCursor', v_run.delete_cursor,
    'status', v_run.status
  );
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.delete_archiver_records_chunk(
  p_lease_id UUID,
  p_lease_token UUID,
  p_expected_cursor INTEGER,
  p_source_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
  v_run public.archive_runs%ROWTYPE;
  v_count INTEGER;
  v_unique_count INTEGER;
  v_remaining INTEGER;
BEGIN
  v_count := COALESCE(pg_catalog.array_length(p_source_ids, 1), 0);
  SELECT COUNT(DISTINCT source_id)::INTEGER
  INTO v_unique_count
  FROM pg_catalog.unnest(COALESCE(p_source_ids, ARRAY[]::UUID[])) AS source(source_id);
  IF p_lease_id IS NULL
     OR p_lease_token IS NULL
     OR p_expected_cursor IS NULL
     OR p_expected_cursor < 0
     OR v_count NOT BETWEEN 1 AND 500
     OR v_unique_count <> v_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_DELETE_CHUNK_INVALID';
  END IF;

  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
    AND lease.lease_until > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;

  SELECT run.*
  INTO v_run
  FROM public.archive_runs AS run
  WHERE run.company_id = v_lease.company_id
    AND run.archive_key = pg_catalog.format(
      '%s-%s-s%s',
      v_lease.archive_key,
      CASE WHEN v_lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
      pg_catalog.lpad(v_lease.segment::TEXT, 6, '0')
    )
    AND run.data_type = v_lease.data_type
  FOR UPDATE;
  IF v_run.id IS NULL OR v_run.status NOT IN ('uploaded_not_deleted', 'failed') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_RUN_NOT_DELETABLE';
  END IF;
  IF v_run.delete_cursor > p_expected_cursor THEN
    RETURN pg_catalog.jsonb_build_object(
      'runId', v_run.id,
      'deleteCursor', v_run.delete_cursor,
      'processedCount', 0,
      'replayed', true
    );
  END IF;
  IF v_run.delete_cursor <> p_expected_cursor
     OR p_expected_cursor + v_count > v_run.doc_count THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ARCHIVE_DELETE_CURSOR_CONFLICT';
  END IF;

  IF v_lease.data_type = 'jobs' THEN
    DELETE FROM public.jobs AS job
    WHERE job.company_id = v_lease.company_id
      AND job.id = ANY(p_source_ids)
      AND job.status = 'finished'
      AND job.finished_at >= v_lease.period_start
      AND job.finished_at < v_lease.period_end
      AND job.updated_at <= v_lease.snapshot_at
      AND NOT EXISTS (
        SELECT 1 FROM public.document_job_links AS link WHERE link.job_id = job.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM private.file_upload_sessions AS upload WHERE upload.target_job_id = job.id
      );
    SELECT COUNT(*)::INTEGER INTO v_remaining
    FROM public.jobs AS job
    WHERE job.company_id = v_lease.company_id AND job.id = ANY(p_source_ids);
  ELSE
    DELETE FROM public.documents AS document
    WHERE document.company_id = v_lease.company_id
      AND document.id = ANY(p_source_ids)
      AND document.created_at >= v_lease.period_start
      AND document.created_at < v_lease.period_end
      AND document.generation_status = 'completed'
      AND (document.document_type <> 305 OR document.tax_authority_status = 'approved')
      AND document.updated_at <= v_lease.snapshot_at
      AND NOT EXISTS (
        SELECT 1 FROM public.document_tasks AS task
        WHERE task.document_id = document.id AND task.status <> 'completed'
      )
      AND NOT EXISTS (
        SELECT 1 FROM private.document_email_deliveries AS delivery
        WHERE delivery.document_id = document.id AND delivery.status <> 'sent'
      );
    SELECT COUNT(*)::INTEGER INTO v_remaining
    FROM public.documents AS document
    WHERE document.company_id = v_lease.company_id AND document.id = ANY(p_source_ids);
  END IF;
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ARCHIVE_SOURCE_CHANGED';
  END IF;

  UPDATE public.archive_runs AS run
  SET delete_cursor = run.delete_cursor + v_count,
      deleted_count = run.delete_cursor + v_count,
      status = 'uploaded_not_deleted'
  WHERE run.id = v_run.id
  RETURNING run.* INTO STRICT v_run;

  RETURN pg_catalog.jsonb_build_object(
    'runId', v_run.id,
    'deleteCursor', v_run.delete_cursor,
    'processedCount', v_count,
    'replayed', false
  );
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.complete_archiver_run(
  p_lease_id UUID,
  p_lease_token UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
  v_run public.archive_runs%ROWTYPE;
BEGIN
  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
    AND lease.lease_until > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;
  SELECT run.*
  INTO v_run
  FROM public.archive_runs AS run
  WHERE run.company_id = v_lease.company_id
    AND run.archive_key = pg_catalog.format(
      '%s-%s-s%s',
      v_lease.archive_key,
      CASE WHEN v_lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
      pg_catalog.lpad(v_lease.segment::TEXT, 6, '0')
    )
    AND run.data_type = v_lease.data_type
  FOR UPDATE;
  IF v_run.id IS NULL
     OR v_run.doc_count < 1
     OR v_run.delete_cursor <> v_run.doc_count
     OR v_run.deleted_count <> v_run.doc_count
     OR v_run.storage_path IS NULL
     OR v_run.storage_generation IS NULL
     OR v_run.id_manifest_path IS NULL
     OR v_run.id_manifest_generation IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_RUN_INCOMPLETE';
  END IF;

  UPDATE public.archive_runs AS run
  SET status = 'deleted', completed_at = pg_catalog.clock_timestamp()
  WHERE run.id = v_run.id;
  UPDATE private.archive_run_leases AS lease
  SET status = 'completed', lease_token = NULL, lease_until = NULL,
      last_error = NULL, updated_at = pg_catalog.clock_timestamp()
  WHERE lease.id = v_lease.id;
  RETURN true;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.release_empty_archive_run_lease(
  p_lease_id UUID,
  p_lease_token UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM private.archive_run_leases AS lease
    INNER JOIN public.archive_runs AS run
      ON run.company_id = lease.company_id
     AND run.archive_key = pg_catalog.format(
       '%s-%s-s%s',
       lease.archive_key,
       CASE WHEN lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
       pg_catalog.lpad(lease.segment::TEXT, 6, '0')
     )
     AND run.data_type = lease.data_type
    WHERE lease.id = p_lease_id
      AND lease.lease_token = p_lease_token
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_RUN_ALREADY_RECORDED';
  END IF;
  UPDATE private.archive_run_leases AS lease
  SET status = 'pending', lease_token = NULL, lease_until = NULL,
      last_error = NULL, updated_at = pg_catalog.clock_timestamp()
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
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
  v_lease private.archive_run_leases%ROWTYPE;
BEGIN
  IF p_lease_id IS NULL OR p_lease_token IS NULL OR p_succeeded IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_LEASE_RESULT_INVALID';
  END IF;
  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
  FOR UPDATE;
  IF v_lease.id IS NULL THEN
    RETURN false;
  END IF;
  IF p_succeeded THEN
    RETURN private.complete_archiver_run(p_lease_id, p_lease_token);
  END IF;
  UPDATE public.archive_runs AS run
  SET status = 'failed'
  WHERE run.company_id = v_lease.company_id
    AND run.archive_key = pg_catalog.format(
      '%s-%s-s%s',
      v_lease.archive_key,
      CASE WHEN v_lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
      pg_catalog.lpad(v_lease.segment::TEXT, 6, '0')
    )
    AND run.data_type = v_lease.data_type
    AND run.status = 'uploaded_not_deleted';
  UPDATE private.archive_run_leases AS lease
  SET status = 'failed', lease_token = NULL, lease_until = NULL,
      last_error = pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'Archive run failed'), 2000),
      updated_at = pg_catalog.clock_timestamp()
  WHERE lease.id = v_lease.id;
  RETURN true;
END;
$$;
--> statement-breakpoint

-- New private objects remain unreachable through PostgREST/client roles. The
-- runtime worker has no direct source-table or archive-table write grants.
REVOKE ALL ON FUNCTION private.list_archiver_companies()
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.list_archiver_candidates(TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.claim_archive_run_lease(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INTEGER
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.renew_archive_run_lease(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.read_archiver_jobs_page(
  UUID, UUID, TIMESTAMPTZ, UUID, INTEGER
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.read_archiver_documents_page(
  UUID, UUID, TIMESTAMPTZ, UUID, INTEGER
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.record_archiver_uploaded_run(
  UUID, UUID, INTEGER, TEXT, TEXT, BIGINT, TEXT, TEXT, BIGINT
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.delete_archiver_records_chunk(UUID, UUID, INTEGER, UUID[])
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.complete_archiver_run(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.release_empty_archive_run_lease(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.finish_archive_run_lease(UUID, UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.list_archiver_companies()
  TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.list_archiver_candidates(TIMESTAMPTZ, INTEGER)
  TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.claim_archive_run_lease(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INTEGER
) TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.renew_archive_run_lease(UUID, UUID, INTEGER)
  TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.read_archiver_jobs_page(
  UUID, UUID, TIMESTAMPTZ, UUID, INTEGER
) TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.read_archiver_documents_page(
  UUID, UUID, TIMESTAMPTZ, UUID, INTEGER
) TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.record_archiver_uploaded_run(
  UUID, UUID, INTEGER, TEXT, TEXT, BIGINT, TEXT, TEXT, BIGINT
) TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.delete_archiver_records_chunk(UUID, UUID, INTEGER, UUID[])
  TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.complete_archiver_run(UUID, UUID)
  TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.release_empty_archive_run_lease(UUID, UUID)
  TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.finish_archive_run_lease(UUID, UUID, BOOLEAN, TEXT)
  TO smart_job_archiver;
--> statement-breakpoint

REVOKE ALL ON TABLE private.archive_run_leases, public.archive_runs,
  public.jobs, public.documents
FROM smart_job_archiver;
