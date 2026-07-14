-- Atomic non-tax document creation and durable PDF dispatch outbox.
--
-- Client payloads never choose tenant authority, counters, totals, VAT, company
-- snapshots, creator snapshots, or inventory references. The API role may only
-- execute these narrow SECURITY DEFINER entrypoints.

ALTER TABLE public.documents
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT documents_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.increment_document_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER documents_increment_entity_version
BEFORE UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION private.increment_document_entity_version();--> statement-breakpoint

ALTER TABLE public.document_tasks
  ADD COLUMN dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN dispatch_lease_token UUID,
  ADD COLUMN dispatch_lease_until TIMESTAMPTZ,
  ADD COLUMN next_dispatch_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN dispatched_at TIMESTAMPTZ,
  ADD COLUMN dispatch_error TEXT,
  ADD CONSTRAINT document_tasks_dispatch_attempts_non_negative_check
    CHECK (dispatch_attempts >= 0),
  ADD CONSTRAINT document_tasks_dispatch_lease_consistency_check
    CHECK (
      (dispatch_lease_token IS NULL AND dispatch_lease_until IS NULL)
      OR (dispatch_lease_token IS NOT NULL AND dispatch_lease_until IS NOT NULL)
    );--> statement-breakpoint

CREATE INDEX document_tasks_dispatch_outbox_idx
  ON public.document_tasks (next_dispatch_at, created_at, id)
  WHERE status = 'pending' AND dispatched_at IS NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.require_api_document_mutation_access(
  p_company_id UUID,
  p_manager_only BOOLEAN DEFAULT false
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_membership_id UUID;
  v_documents_enabled BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_company_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.companies AS company
    WHERE company.id = p_company_id
      AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DOCUMENT_COMPANY_NOT_FOUND';
  END IF;

  SELECT entitlement.documents_enabled
  INTO v_documents_enabled
  FROM private.get_company_module_entitlements(p_company_id) AS entitlement;
  IF NOT COALESCE(v_documents_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DOCUMENTS_MODULE_DISABLED';
  END IF;

  IF private.app_is_dev() THEN
    RETURN NULL;
  END IF;

  SELECT membership.id
  INTO v_membership_id
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid
    AND membership.status = 'active'
    AND (
      (p_manager_only AND membership.role = 'manager')
      OR (NOT p_manager_only AND membership.role IN ('manager', 'user', 'basic'))
    )
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DOCUMENT_MUTATION_FORBIDDEN';
  END IF;
  RETURN v_membership_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.prepare_api_document_data(
  p_company_id UUID,
  p_membership_id UUID,
  p_document_data JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client JSONB;
  v_client_id UUID;
  v_client_row public.clients%ROWTYPE;
  v_company JSONB;
  v_creator JSONB;
  v_total_before_vat NUMERIC(14, 2);
  v_vat_amount NUMERIC(14, 2);
  v_total_with_vat NUMERIC(14, 2);
  v_document_date TIMESTAMPTZ;
  v_invalid_part_count INTEGER;
BEGIN
  IF p_document_data IS NULL
     OR pg_catalog.jsonb_typeof(p_document_data) <> 'object'
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_object_keys(p_document_data) AS key(name)
       WHERE key.name NOT IN (
         'client', 'items', 'language', 'date', 'notes',
         'paymentMethod', 'paymentInfo', 'invoiceReference'
       )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DATA_INVALID';
  END IF;
  IF pg_catalog.jsonb_typeof(p_document_data -> 'client') <> 'object'
     OR pg_catalog.jsonb_typeof(p_document_data -> 'items') <> 'array'
     OR pg_catalog.jsonb_array_length(p_document_data -> 'items') NOT BETWEEN 1 AND 100
     OR COALESCE(p_document_data ->> 'language', '') NOT IN ('he', 'ar', 'en') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DATA_INVALID';
  END IF;

  v_client := p_document_data -> 'client';
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(v_client) AS key(name)
    WHERE key.name NOT IN (
      'clientId', 'name', 'email', 'phone', 'address', 'city', 'clientVatNumber'
    )
  )
     OR pg_catalog.jsonb_typeof(v_client -> 'name') <> 'string'
     OR pg_catalog.btrim(v_client ->> 'name') = ''
     OR pg_catalog.char_length(pg_catalog.btrim(v_client ->> 'name')) > 240 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_CLIENT_INVALID';
  END IF;
  IF v_client ? 'email' AND (
    pg_catalog.jsonb_typeof(v_client -> 'email') <> 'string'
    OR pg_catalog.char_length(pg_catalog.btrim(v_client ->> 'email')) > 320
    OR pg_catalog.lower(pg_catalog.btrim(v_client ->> 'email'))
      !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_CLIENT_EMAIL_INVALID';
  END IF;
  IF (v_client ? 'phone' AND (
        pg_catalog.jsonb_typeof(v_client -> 'phone') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(v_client ->> 'phone')) NOT BETWEEN 1 AND 40
      ))
     OR (v_client ? 'address' AND (
        pg_catalog.jsonb_typeof(v_client -> 'address') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(v_client ->> 'address')) NOT BETWEEN 1 AND 500
      ))
     OR (v_client ? 'city' AND (
        pg_catalog.jsonb_typeof(v_client -> 'city') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(v_client ->> 'city')) NOT BETWEEN 1 AND 120
      ))
     OR (v_client ? 'clientVatNumber' AND (
        pg_catalog.jsonb_typeof(v_client -> 'clientVatNumber') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(v_client ->> 'clientVatNumber')) NOT BETWEEN 1 AND 32
      )) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_CLIENT_INVALID';
  END IF;

  IF v_client ? 'clientId' THEN
    BEGIN
      v_client_id := (v_client ->> 'clientId')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_CLIENT_INVALID';
    END;
    SELECT client.*
    INTO v_client_row
    FROM public.clients AS client
    WHERE client.id = v_client_id
      AND client.company_id = p_company_id
      AND client.status = 'active'
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DOCUMENT_CLIENT_NOT_FOUND';
    END IF;
    v_client := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'clientId', v_client_row.id,
      'name', v_client_row.name,
      'email', v_client_row.email,
      'phone', v_client_row.phone,
      'address', v_client_row.address,
      'city', v_client_row.city,
      'clientVatNumber', v_client_row.vat_number
    ));
  ELSE
    v_client := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'name', pg_catalog.btrim(v_client ->> 'name'),
      'email', NULLIF(pg_catalog.lower(pg_catalog.btrim(v_client ->> 'email')), ''),
      'phone', NULLIF(pg_catalog.btrim(v_client ->> 'phone'), ''),
      'address', NULLIF(pg_catalog.btrim(v_client ->> 'address'), ''),
      'city', NULLIF(pg_catalog.btrim(v_client ->> 'city'), ''),
      'clientVatNumber', NULLIF(pg_catalog.btrim(v_client ->> 'clientVatNumber'), '')
    ));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_document_data -> 'items') AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.jsonb_object_keys(item.value) AS key(name)
         WHERE key.name NOT IN ('description', 'quantity', 'price', 'partNo')
       )
       OR pg_catalog.jsonb_typeof(item.value -> 'description') <> 'string'
       OR pg_catalog.btrim(item.value ->> 'description') = ''
       OR pg_catalog.char_length(pg_catalog.btrim(item.value ->> 'description')) > 240
       OR pg_catalog.jsonb_typeof(item.value -> 'quantity') <> 'number'
       OR (item.value ->> 'quantity')::NUMERIC <= 0
       OR (item.value ->> 'quantity')::NUMERIC > 99999999999.999
       OR pg_catalog.jsonb_typeof(item.value -> 'price') <> 'number'
       OR (item.value ->> 'price')::NUMERIC < 0
       OR (item.value ->> 'price')::NUMERIC > 99999999999.99
       OR (item.value ? 'partNo' AND (
         pg_catalog.jsonb_typeof(item.value -> 'partNo') <> 'number'
         OR (item.value ->> 'partNo')::NUMERIC <= 0
         OR (item.value ->> 'partNo')::NUMERIC <> pg_catalog.trunc((item.value ->> 'partNo')::NUMERIC)
       ))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_ITEMS_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::INTEGER
  INTO v_invalid_part_count
  FROM pg_catalog.jsonb_array_elements(p_document_data -> 'items') AS item(value)
  WHERE item.value ? 'partNo'
    AND NOT EXISTS (
      SELECT 1
      FROM public.inventory_parts AS part
      WHERE part.company_id = p_company_id
        AND part.part_no = (item.value ->> 'partNo')::INTEGER
        AND part.active
        AND part.archived_at IS NULL
    );
  IF v_invalid_part_count > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DOCUMENT_PART_NOT_FOUND';
  END IF;

  IF pg_catalog.jsonb_typeof(p_document_data -> 'date') <> 'string' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DATE_INVALID';
  END IF;
  BEGIN
    v_document_date := (p_document_data ->> 'date')::TIMESTAMPTZ;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DATE_INVALID';
  END;
  IF (p_document_data ? 'notes' AND (
        pg_catalog.jsonb_typeof(p_document_data -> 'notes') <> 'string'
        OR pg_catalog.char_length(p_document_data ->> 'notes') > 4000
      ))
     OR (p_document_data ? 'paymentMethod' AND (
        pg_catalog.jsonb_typeof(p_document_data -> 'paymentMethod') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(p_document_data ->> 'paymentMethod')) NOT BETWEEN 1 AND 80
      ))
     OR (p_document_data ? 'invoiceReference' AND (
        pg_catalog.jsonb_typeof(p_document_data -> 'invoiceReference') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(p_document_data ->> 'invoiceReference')) NOT BETWEEN 1 AND 128
      ))
     OR (p_document_data ? 'paymentInfo'
         AND pg_catalog.jsonb_typeof(p_document_data -> 'paymentInfo') NOT IN ('string', 'object')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DATA_INVALID';
  END IF;

  SELECT pg_catalog.round(pg_catalog.sum(
    (item.value ->> 'quantity')::NUMERIC * (item.value ->> 'price')::NUMERIC
  ), 2)
  INTO v_total_before_vat
  FROM pg_catalog.jsonb_array_elements(p_document_data -> 'items') AS item(value);
  IF v_total_before_vat IS NULL OR v_total_before_vat > 999999999999.99 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_TOTAL_INVALID';
  END IF;
  v_vat_amount := pg_catalog.round(v_total_before_vat * 0.18, 2);
  v_total_with_vat := v_total_before_vat + v_vat_amount;

  SELECT pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'name', COALESCE(profile.he_name, profile.en_name, ''),
    'nameHe', profile.he_name,
    'nameEn', profile.en_name,
    'email', profile.business_email,
    'phone', profile.business_phone,
    'address', NULLIF(pg_catalog.concat_ws(' ', profile.address, profile.city), ''),
    'vatNumber', profile.vat_number
  ))
  INTO v_company
  FROM (SELECT 1) AS seed
  LEFT JOIN public.company_profiles AS profile
    ON profile.company_id = p_company_id;

  IF p_membership_id IS NULL THEN
    v_creator := '{}'::JSONB;
  ELSE
    SELECT pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'wid', membership.member_no::TEXT,
      'name', COALESCE(membership.display_name, app_user.display_name, app_user.email)
    ))
    INTO v_creator
    FROM public.company_memberships AS membership
    LEFT JOIN public.app_users AS app_user ON app_user.id = membership.user_id
    WHERE membership.id = p_membership_id
      AND membership.company_id = p_company_id;
  END IF;

  RETURN pg_catalog.jsonb_strip_nulls(
    p_document_data
    || pg_catalog.jsonb_build_object(
      'client', v_client,
      'company', COALESCE(v_company, '{}'::JSONB),
      'creator', COALESCE(v_creator, '{}'::JSONB),
      'date', pg_catalog.to_char(v_document_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'totalBeforeVat', v_total_before_vat,
      'vatAmount', v_vat_amount,
      'totalWithVat', v_total_with_vat,
      'totals', pg_catalog.jsonb_build_object(
        'totalBeforeVat', v_total_before_vat,
        'vatAmount', v_vat_amount,
        'totalWithVat', v_total_with_vat
      )
    )
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_document_preview_task(
  p_company_id UUID,
  p_document_type SMALLINT,
  p_document_data JSONB,
  p_created_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS TABLE (
  task_key TEXT,
  task_status public.document_generation_status,
  document_id UUID,
  document_code TEXT,
  entity_version BIGINT,
  dispatch_payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_task_id UUID := extensions.gen_random_uuid();
  v_uid TEXT := private.app_auth_uid();
  v_public_company_id BIGINT;
  v_data JSONB;
  v_dispatch JSONB;
BEGIN
  IF p_document_type NOT IN (10, 200, 210, 305, 330, 400) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_TYPE_INVALID';
  END IF;
  v_membership_id := private.require_api_document_mutation_access(p_company_id, false);
  SELECT company.public_company_id
  INTO v_public_company_id
  FROM public.companies AS company
  WHERE company.id = p_company_id;
  v_data := private.prepare_api_document_data(p_company_id, v_membership_id, p_document_data);
  v_dispatch := pg_catalog.jsonb_build_object(
    'taskId', v_task_id::TEXT,
    'documentType', p_document_type,
    'documentData', v_data,
    'uid', v_uid,
    'companyId', v_public_company_id
  );

  INSERT INTO public.document_tasks (
    id, task_key, lock_key, company_id, user_id, document_id,
    task_type, document_type, status, request_payload, expire_at,
    next_dispatch_at, created_at
  ) VALUES (
    v_task_id, v_task_id::TEXT, 'task:' || v_task_id::TEXT, p_company_id, v_uid, NULL,
    'preview', p_document_type, 'pending', v_dispatch, p_created_at + interval '1 hour',
    p_created_at, p_created_at
  );

  task_key := v_task_id::TEXT;
  task_status := 'pending';
  document_id := NULL;
  document_code := NULL;
  entity_version := NULL;
  dispatch_payload := v_dispatch;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_document_generation_task(
  p_company_id UUID,
  p_document_type SMALLINT,
  p_document_data JSONB,
  p_created_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS TABLE (
  task_key TEXT,
  task_status public.document_generation_status,
  document_id UUID,
  document_code TEXT,
  entity_version BIGINT,
  dispatch_payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_task_id UUID := extensions.gen_random_uuid();
  v_document_id UUID := extensions.gen_random_uuid();
  v_uid TEXT := private.app_auth_uid();
  v_public_company_id BIGINT;
  v_document_number INTEGER;
  v_document_code TEXT;
  v_suffix TEXT;
  v_data JSONB;
  v_dispatch JSONB;
  v_client_id UUID;
BEGIN
  IF p_document_type NOT IN (10, 200, 210, 330, 400) THEN
    IF p_document_type = 305 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_WORKFLOW_REQUIRED';
    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_TYPE_INVALID';
  END IF;
  v_membership_id := private.require_api_document_mutation_access(p_company_id, false);
  SELECT company.public_company_id
  INTO v_public_company_id
  FROM public.companies AS company
  WHERE company.id = p_company_id;

  v_data := private.prepare_api_document_data(p_company_id, v_membership_id, p_document_data);
  v_document_number := private.allocate_company_counter(p_company_id, 'doc_' || p_document_type::TEXT);
  v_suffix := CASE p_document_type
    WHEN 10 THEN 'PP'
    WHEN 200 THEN 'DN'
    WHEN 210 THEN 'RC'
    WHEN 330 THEN 'RD'
    WHEN 400 THEN 'RT'
  END;
  v_document_code := v_suffix || v_document_number::TEXT || '-' || v_public_company_id::TEXT;
  v_data := v_data || pg_catalog.jsonb_build_object('documentNumber', v_document_number);
  IF v_data #>> '{client,clientId}' IS NOT NULL THEN
    v_client_id := (v_data #>> '{client,clientId}')::UUID;
  END IF;

  INSERT INTO public.documents (
    id, company_id, document_type, document_number, document_code,
    generation_status, tax_authority_status, client_id, created_by_membership_id,
    language, document_date, notes, total_before_vat, vat_amount, total_with_vat,
    company_name_snapshot, company_vat_snapshot, company_address_snapshot,
    client_name_snapshot, client_phone_snapshot, client_city_snapshot, client_vat_snapshot,
    payload, created_at, updated_at
  ) VALUES (
    v_document_id, p_company_id, p_document_type, v_document_number, v_document_code,
    'pending', 'none', v_client_id, v_membership_id,
    v_data ->> 'language', (v_data ->> 'date')::TIMESTAMPTZ, NULLIF(v_data ->> 'notes', ''),
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
      (item.value ->> 'quantity')::NUMERIC * (item.value ->> 'price')::NUMERIC,
      2
    )::NUMERIC(14, 2),
    part.id,
    CASE WHEN item.value ? 'partNo'
      THEN pg_catalog.jsonb_build_object('partNo', (item.value ->> 'partNo')::INTEGER)
      ELSE '{}'::JSONB
    END
  FROM pg_catalog.jsonb_array_elements(v_data -> 'items') WITH ORDINALITY AS item(value, line_no)
  LEFT JOIN public.inventory_parts AS part
    ON part.company_id = p_company_id
   AND part.part_no = CASE WHEN item.value ? 'partNo'
     THEN (item.value ->> 'partNo')::INTEGER ELSE NULL END;

  v_dispatch := pg_catalog.jsonb_build_object(
    'taskId', v_task_id::TEXT,
    'documentType', p_document_type,
    'documentData', v_data,
    'uid', v_uid,
    'companyId', v_public_company_id,
    'documentId', v_document_code,
    'documentNumber', v_document_number
  );
  INSERT INTO public.document_tasks (
    id, task_key, lock_key, company_id, user_id, document_id,
    task_type, document_type, status, request_payload, expire_at,
    next_dispatch_at, created_at
  ) VALUES (
    v_task_id, v_task_id::TEXT, 'document:' || v_document_id::TEXT,
    p_company_id, v_uid, v_document_id,
    'generate', p_document_type, 'pending', v_dispatch, p_created_at + interval '24 hours',
    p_created_at, p_created_at
  );

  PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  task_key := v_task_id::TEXT;
  task_status := 'pending';
  document_id := v_document_id;
  document_code := v_document_code;
  entity_version := 1;
  dispatch_payload := v_dispatch;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.delete_api_document(
  p_company_id UUID,
  p_document_id UUID,
  p_expected_entity_version BIGINT
) RETURNS TABLE (
  document_id UUID,
  document_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_document public.documents%ROWTYPE;
BEGIN
  PERFORM private.require_api_document_mutation_access(p_company_id, true);
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_ENTITY_VERSION_INVALID';
  END IF;
  SELECT document.*
  INTO v_document
  FROM public.documents AS document
  WHERE document.id = p_document_id
    AND document.company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DOCUMENT_NOT_FOUND';
  END IF;
  IF v_document.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'DOCUMENT_ENTITY_VERSION_CONFLICT';
  END IF;
  IF v_document.document_type = 305 AND v_document.tax_authority_status = 'approved' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'APPROVED_TAX_DOCUMENT_IMMUTABLE';
  END IF;
  IF v_document.storage_path IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'GENERATED_DOCUMENT_DELETE_REQUIRES_CLEANUP';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.document_tasks AS task
    WHERE task.document_id = v_document.id
      AND task.status IN ('pending', 'queued', 'processing')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'DOCUMENT_TASK_ACTIVE';
  END IF;

  DELETE FROM public.documents AS document
  WHERE document.id = v_document.id
    AND document.company_id = p_company_id;
  PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  document_id := v_document.id;
  document_code := v_document.document_code;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_api_document_dispatch_batch(
  p_lease_token UUID,
  p_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 30,
  p_task_key TEXT DEFAULT NULL
) RETURNS TABLE (
  task_key TEXT,
  task_type public.document_task_type,
  user_id TEXT,
  dispatch_attempt INTEGER,
  dispatch_payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_lease_token IS NULL
     OR p_limit NOT BETWEEN 1 AND 100
     OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DISPATCH_CLAIM_INVALID';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT task.id
    FROM public.document_tasks AS task
    WHERE task.status = 'pending'
      AND task.dispatched_at IS NULL
      AND (p_task_key IS NULL OR task.task_key = p_task_key)
      AND task.next_dispatch_at <= pg_catalog.clock_timestamp()
      AND (
        task.dispatch_lease_until IS NULL
        OR task.dispatch_lease_until <= pg_catalog.clock_timestamp()
      )
    ORDER BY task.next_dispatch_at, task.created_at, task.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.document_tasks AS task
    SET dispatch_attempts = task.dispatch_attempts + 1,
        dispatch_lease_token = p_lease_token,
        dispatch_lease_until = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_lease_seconds),
        dispatch_error = NULL
    FROM candidates
    WHERE task.id = candidates.id
    RETURNING task.task_key, task.task_type, task.user_id,
      task.dispatch_attempts, task.request_payload
  )
  SELECT claimed.task_key::TEXT, claimed.task_type, claimed.user_id,
    claimed.dispatch_attempts, claimed.request_payload
  FROM claimed;
END;
$$;--> statement-breakpoint

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
  SET status = 'queued',
      dispatched_at = p_dispatched_at,
      dispatch_lease_token = NULL,
      dispatch_lease_until = NULL,
      dispatch_error = NULL
  WHERE task.task_key = p_task_key
    AND task.status = 'pending'
    AND task.dispatched_at IS NULL
    AND task.dispatch_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.retry_api_document_dispatch(
  p_task_key TEXT,
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DISPATCH_RETRY_INVALID';
  END IF;
  UPDATE public.document_tasks AS task
  SET next_dispatch_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_retry_after_seconds),
      dispatch_lease_token = NULL,
      dispatch_lease_until = NULL,
      dispatch_error = pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'Dispatch failed'), 2000)
  WHERE task.task_key = p_task_key
    AND task.status = 'pending'
    AND task.dispatched_at IS NULL
    AND task.dispatch_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.increment_document_entity_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.require_api_document_mutation_access(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.prepare_api_document_data(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.create_api_document_preview_task(UUID, SMALLINT, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.create_api_document_generation_task(UUID, SMALLINT, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.delete_api_document(UUID, UUID, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.claim_api_document_dispatch_batch(UUID, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.complete_api_document_dispatch(TEXT, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.retry_api_document_dispatch(TEXT, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION private.create_api_document_preview_task(UUID, SMALLINT, JSONB, TIMESTAMPTZ)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.create_api_document_generation_task(UUID, SMALLINT, JSONB, TIMESTAMPTZ)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.delete_api_document(UUID, UUID, BIGINT)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.claim_api_document_dispatch_batch(UUID, INTEGER, INTEGER, TEXT)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.complete_api_document_dispatch(TEXT, UUID, TIMESTAMPTZ)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.retry_api_document_dispatch(TEXT, UUID, TEXT, INTEGER)
  TO smart_job_api;
