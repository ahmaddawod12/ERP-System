-- API job creation and the canonical private company-file bucket.
-- All public identifiers are resolved inside the authenticated tenant and all
-- writes (counter, job details, inventory, attachments, upload consumption,
-- and sync versions) share the caller's transaction.

INSERT INTO storage.buckets AS bucket (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) VALUES (
  'smart-job-company-files',
  'smart-job-company-files',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types,
    updated_at = pg_catalog.clock_timestamp()
WHERE bucket.name IS DISTINCT FROM EXCLUDED.name
   OR bucket.public IS DISTINCT FROM false
   OR bucket.file_size_limit IS DISTINCT FROM EXCLUDED.file_size_limit
   OR bucket.allowed_mime_types IS DISTINCT FROM EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION private.create_api_job_with_details(
  p_company_id UUID,
  p_status public.job_status,
  p_title TEXT,
  p_description TEXT,
  p_location TEXT DEFAULT NULL,
  p_client_id TEXT DEFAULT NULL,
  p_assignee_member_no INTEGER DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb,
  p_parts JSONB DEFAULT NULL,
  p_upload_session_id UUID DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status public.job_status,
  entity_version BIGINT,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_uid_text TEXT := private.app_auth_uid();
  v_is_dev BOOLEAN := false;
  v_jobs_enabled BOOLEAN := false;
  v_membership public.company_memberships%ROWTYPE;
  v_effective_role TEXT;
  v_client public.clients%ROWTYPE;
  v_client_identifier TEXT := NULLIF(pg_catalog.btrim(p_client_id), '');
  v_assignee public.company_memberships%ROWTYPE;
  v_upload private.file_upload_sessions%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_job_no INTEGER;
  v_details JSONB := COALESCE(p_details, '{}'::jsonb);
  v_parts JSONB := COALESCE(p_parts, '[]'::jsonb);
  v_consumption_parts JSONB := '[]'::jsonb;
  v_created_by_name TEXT;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'AUTH_CONTEXT_REQUIRED';
  END IF;

  BEGIN
    v_uid := v_uid_text::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING
        ERRCODE = '28000',
        MESSAGE = 'AUTH_CONTEXT_INVALID';
  END;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_REQUIRED';
  END IF;
  IF p_created_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CREATED_AT_REQUIRED';
  END IF;

  PERFORM 1
  FROM public.companies AS company
  WHERE company.id = p_company_id
    AND company.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'COMPANY_NOT_FOUND';
  END IF;

  SELECT private.app_is_dev()
  INTO v_is_dev;

  SELECT membership.*
  INTO v_membership
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid::text
    AND membership.status = 'active'
  ORDER BY membership.joined_at, membership.created_at, membership.id
  LIMIT 1;

  IF v_membership.id IS NULL AND NOT v_is_dev THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMPANY_MEMBERSHIP_REQUIRED';
  END IF;

  v_effective_role := CASE
    WHEN v_is_dev THEN 'dev'
    ELSE v_membership.role::text
  END;

  IF v_effective_role NOT IN ('manager', 'user', 'dev') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'JOB_CREATION_FORBIDDEN';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('pending', 'finished') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'JOB_STATUS_INVALID';
  END IF;
  IF v_effective_role = 'user' AND p_status <> 'finished' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'SOLO_PENDING_JOB_FORBIDDEN';
  END IF;

  SELECT entitlement.jobs_enabled
  INTO v_jobs_enabled
  FROM private.get_company_module_entitlements(p_company_id) AS entitlement;
  IF NOT COALESCE(v_jobs_enabled, false) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'JOBS_MODULE_DISABLED';
  END IF;

  IF p_title IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_title)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_TITLE_INVALID';
  END IF;
  IF p_description IS NULL OR pg_catalog.char_length(p_description) > 10000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DESCRIPTION_INVALID';
  END IF;
  IF p_location IS NOT NULL
    AND pg_catalog.char_length(pg_catalog.btrim(p_location)) > 240 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_LOCATION_INVALID';
  END IF;

  IF pg_catalog.jsonb_typeof(v_details) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DETAILS_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(v_details) AS detail_key(key)
    WHERE detail_key.key <> ALL (
      ARRAY['timeFrom', 'timeTo', 'signingPerson', 'travelDistance']::text[]
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DETAILS_UNKNOWN_FIELD';
  END IF;
  IF v_details ? 'timeFrom'
    AND pg_catalog.jsonb_typeof(v_details -> 'timeFrom') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_FROM_INVALID';
  END IF;
  IF v_details ? 'timeTo'
    AND pg_catalog.jsonb_typeof(v_details -> 'timeTo') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_TO_INVALID';
  END IF;
  IF v_details ? 'signingPerson'
    AND pg_catalog.jsonb_typeof(v_details -> 'signingPerson') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SIGNING_PERSON_INVALID';
  END IF;
  IF v_details ? 'travelDistance'
    AND pg_catalog.jsonb_typeof(v_details -> 'travelDistance') NOT IN ('number', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRAVEL_DISTANCE_INVALID';
  END IF;
  IF pg_catalog.jsonb_typeof(v_details -> 'timeFrom') = 'string'
    AND (v_details ->> 'timeFrom') !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_FROM_INVALID';
  END IF;
  IF pg_catalog.jsonb_typeof(v_details -> 'timeTo') = 'string'
    AND (v_details ->> 'timeTo') !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_TO_INVALID';
  END IF;
  IF COALESCE(v_details ->> 'timeFrom', '') <> ''
    AND COALESCE(v_details ->> 'timeTo', '') <> ''
    AND (v_details ->> 'timeTo')::time < (v_details ->> 'timeFrom')::time THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_RANGE_INVALID';
  END IF;
  IF pg_catalog.jsonb_typeof(v_details -> 'signingPerson') = 'string'
    AND (
      pg_catalog.char_length(pg_catalog.btrim(v_details ->> 'signingPerson')) < 1
      OR pg_catalog.char_length(v_details ->> 'signingPerson') > 200
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SIGNING_PERSON_INVALID';
  END IF;
  IF pg_catalog.jsonb_typeof(v_details -> 'travelDistance') = 'number'
    AND (
      (v_details ->> 'travelDistance')::numeric < 0
      OR (v_details ->> 'travelDistance')::numeric > 10000000
      OR pg_catalog.trunc((v_details ->> 'travelDistance')::numeric * 1000)
        <> (v_details ->> 'travelDistance')::numeric * 1000
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRAVEL_DISTANCE_INVALID';
  END IF;

  IF pg_catalog.jsonb_typeof(v_parts) <> 'array'
    OR pg_catalog.jsonb_array_length(v_parts) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PARTS_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_parts) AS part(item)
    WHERE pg_catalog.jsonb_typeof(part.item) <> 'object'
      OR NOT (part.item ? 'partId' AND part.item ? 'quantity')
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_object_keys(part.item) AS field(key)
        WHERE field.key <> ALL (ARRAY['partId', 'quantity']::text[])
      )
      OR pg_catalog.jsonb_typeof(part.item -> 'partId') <> 'number'
      OR pg_catalog.jsonb_typeof(part.item -> 'quantity') <> 'number'
      OR (part.item ->> 'partId') !~ '^[1-9][0-9]*$'
      OR (part.item ->> 'partId')::numeric > 2147483647
      OR (part.item ->> 'quantity')::numeric <= 0
      OR (part.item ->> 'quantity')::numeric > 99999999999.999
      OR pg_catalog.trunc((part.item ->> 'quantity')::numeric * 1000)
        <> (part.item ->> 'quantity')::numeric * 1000
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PART_INVALID';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.jsonb_array_elements(v_parts)
  ) <> (
    SELECT pg_catalog.count(DISTINCT (part.item ->> 'partId')::integer)
    FROM pg_catalog.jsonb_array_elements(v_parts) AS part(item)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PART_DUPLICATE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_parts) AS part(item)
    LEFT JOIN public.inventory_parts AS inventory_part
      ON inventory_part.company_id = p_company_id
     AND inventory_part.part_no = (part.item ->> 'partId')::integer
     AND inventory_part.active
     AND inventory_part.archived_at IS NULL
    WHERE inventory_part.id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;

  IF v_client_identifier IS NOT NULL THEN
    IF v_client_identifier ~ '^[1-9][0-9]*$' THEN
      IF pg_catalog.char_length(v_client_identifier) > 10
        OR v_client_identifier::numeric > 2147483647 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_ID_INVALID';
      END IF;
      SELECT client.*
      INTO v_client
      FROM public.clients AS client
      WHERE client.company_id = p_company_id
        AND client.client_no = v_client_identifier::integer
      LIMIT 1;
    ELSIF v_client_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT client.*
      INTO v_client
      FROM public.clients AS client
      WHERE client.company_id = p_company_id
        AND client.id = v_client_identifier::uuid
      LIMIT 1;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_ID_INVALID';
    END IF;
    IF v_client.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CLIENT_NOT_FOUND';
    END IF;
  END IF;

  IF v_effective_role = 'user' THEN
    IF p_assignee_member_no IS NOT NULL
      AND p_assignee_member_no <> v_membership.member_no THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'SOLO_ASSIGNEE_FORBIDDEN';
    END IF;
    v_assignee := v_membership;
  ELSIF p_assignee_member_no IS NOT NULL THEN
    IF p_assignee_member_no < 1 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ASSIGNEE_MEMBER_NO_INVALID';
    END IF;
    SELECT membership.*
    INTO v_assignee
    FROM public.company_memberships AS membership
    WHERE membership.company_id = p_company_id
      AND membership.member_no = p_assignee_member_no
      AND membership.status = 'active'
    LIMIT 1;
    IF v_assignee.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ASSIGNEE_NOT_FOUND';
    END IF;
  END IF;

  IF p_upload_session_id IS NOT NULL THEN
    IF p_status <> 'finished' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'UPLOAD_SESSION_REQUIRES_FINISHED_JOB';
    END IF;

    SELECT upload_session.*
    INTO v_upload
    FROM private.file_upload_sessions AS upload_session
    WHERE upload_session.id = p_upload_session_id
    FOR UPDATE;

    IF v_upload.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPLOAD_SESSION_NOT_FOUND';
    END IF;
    IF v_upload.user_id <> v_uid
      OR v_upload.company_id <> p_company_id
      OR v_upload.purpose <> 'job.create_finished'
      OR v_upload.target_job_id IS NOT NULL
      OR v_upload.bucket_id <> 'smart-job-company-files' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPLOAD_SESSION_FORBIDDEN';
    END IF;
    IF v_upload.status <> 'pending' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'UPLOAD_SESSION_ALREADY_CONSUMED';
    END IF;
    IF v_upload.expires_at <= pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_EXPIRED';
    END IF;

    IF pg_catalog.jsonb_typeof(v_upload.expected_manifest) <> 'array'
      OR pg_catalog.jsonb_array_length(v_upload.expected_manifest) NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_INVALID';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
      WHERE pg_catalog.jsonb_typeof(attachment.item) <> 'object'
        OR NOT (
          attachment.item ? 'attachmentId'
          AND attachment.item ? 'kind'
          AND attachment.item ? 'fileName'
          AND attachment.item ? 'mimeType'
          AND attachment.item ? 'sizeBytes'
          AND attachment.item ? 'sha256'
          AND attachment.item ? 'objectPath'
        )
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_object_keys(attachment.item) AS field(key)
          WHERE field.key <> ALL (
            ARRAY[
              'attachmentId',
              'kind',
              'fileName',
              'mimeType',
              'sizeBytes',
              'sha256',
              'objectPath'
            ]::text[]
          )
        )
        OR pg_catalog.jsonb_typeof(attachment.item -> 'attachmentId') <> 'string'
        OR (attachment.item ->> 'attachmentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR pg_catalog.jsonb_typeof(attachment.item -> 'kind') <> 'string'
        OR (attachment.item ->> 'kind') NOT IN ('photo', 'signature')
        OR pg_catalog.jsonb_typeof(attachment.item -> 'fileName') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(attachment.item ->> 'fileName')) NOT BETWEEN 1 AND 255
        OR pg_catalog.jsonb_typeof(attachment.item -> 'mimeType') <> 'string'
        OR (attachment.item ->> 'mimeType') NOT IN (
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/heic',
          'image/heif'
        )
        OR pg_catalog.jsonb_typeof(attachment.item -> 'sizeBytes') <> 'number'
        OR (attachment.item ->> 'sizeBytes') !~ '^[1-9][0-9]*$'
        OR (attachment.item ->> 'sizeBytes')::numeric > 10485760
        OR pg_catalog.jsonb_typeof(attachment.item -> 'sha256') <> 'string'
        OR (attachment.item ->> 'sha256') !~* '^[0-9a-f]{64}$'
        OR pg_catalog.jsonb_typeof(attachment.item -> 'objectPath') <> 'string'
        OR pg_catalog.char_length(attachment.item ->> 'objectPath') NOT BETWEEN 1 AND 1024
        OR pg_catalog.left(
          attachment.item ->> 'objectPath',
          pg_catalog.char_length(v_upload.object_prefix) + 1
        ) <> v_upload.object_prefix || '/'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_INVALID';
    END IF;
    IF (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest)
    ) <> (
      SELECT pg_catalog.count(DISTINCT attachment.item ->> 'attachmentId')
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
    ) OR (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest)
    ) <> (
      SELECT pg_catalog.count(DISTINCT attachment.item ->> 'objectPath')
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
    ) OR (
      SELECT COALESCE(
        pg_catalog.sum((attachment.item ->> 'sizeBytes')::bigint),
        0
      )
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
    ) > 52428800 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_INVALID';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
      LEFT JOIN storage.objects AS stored_object
        ON stored_object.bucket_id = v_upload.bucket_id
       AND stored_object.name = attachment.item ->> 'objectPath'
      WHERE stored_object.id IS NULL
        OR COALESCE(stored_object.metadata ->> 'mimetype', '')
          <> attachment.item ->> 'mimeType'
        OR CASE
          WHEN COALESCE(stored_object.metadata ->> 'size', '') ~ '^[0-9]+$'
          THEN (stored_object.metadata ->> 'size')::numeric
            <> (attachment.item ->> 'sizeBytes')::numeric
          ELSE true
        END
        OR (
          stored_object.user_metadata ? 'sha256'
          AND pg_catalog.lower(stored_object.user_metadata ->> 'sha256')
            <> pg_catalog.lower(attachment.item ->> 'sha256')
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_OBJECT_MISMATCH';
    END IF;
  END IF;

  SELECT COALESCE(membership.display_name, app_user.display_name)
  INTO v_created_by_name
  FROM public.app_users AS app_user
  LEFT JOIN public.company_memberships AS membership
    ON membership.id = v_membership.id
  WHERE app_user.id = v_uid::text
  LIMIT 1;

  INSERT INTO public.company_counters AS counter (
    company_id,
    counter_key,
    next_value,
    updated_at
  ) VALUES (
    p_company_id,
    'job_no'::public.counter_key,
    2,
    p_created_at
  )
  ON CONFLICT (company_id, counter_key) DO UPDATE
  SET next_value = counter.next_value + 1,
      updated_at = EXCLUDED.updated_at
  RETURNING counter.next_value - 1 INTO v_job_no;

  INSERT INTO public.jobs AS created_job (
    company_id,
    job_no,
    status,
    title,
    description,
    location,
    client_id,
    assigned_membership_id,
    created_by_membership_id,
    accepted_by_user_id,
    accepted_at,
    finished_at,
    client_name_snapshot,
    client_phone_snapshot,
    assigned_member_name_snapshot,
    created_by_name_snapshot,
    meta,
    created_at,
    updated_at
  ) VALUES (
    p_company_id,
    v_job_no,
    p_status,
    pg_catalog.btrim(p_title),
    p_description,
    NULLIF(pg_catalog.btrim(p_location), ''),
    v_client.id,
    v_assignee.id,
    v_membership.id,
    CASE WHEN p_status = 'finished' THEN v_uid::text ELSE NULL END,
    CASE WHEN p_status = 'finished' THEN p_created_at ELSE NULL END,
    CASE WHEN p_status = 'finished' THEN p_created_at ELSE NULL END,
    v_client.name,
    v_client.phone,
    v_assignee.display_name,
    v_created_by_name,
    v_details,
    p_created_at,
    p_created_at
  )
  RETURNING created_job.* INTO v_job;

  INSERT INTO public.job_part_usages (
    job_id,
    inventory_part_id,
    part_name_snapshot,
    quantity,
    created_at
  )
  SELECT
    v_job.id,
    inventory_part.id,
    inventory_part.name,
    (part.item ->> 'quantity')::numeric,
    p_created_at
  FROM pg_catalog.jsonb_array_elements(v_parts) AS part(item)
  INNER JOIN public.inventory_parts AS inventory_part
    ON inventory_part.company_id = p_company_id
   AND inventory_part.part_no = (part.item ->> 'partId')::integer
   AND inventory_part.active
   AND inventory_part.archived_at IS NULL;

  IF v_effective_role = 'user'
    AND p_status = 'finished'
    AND pg_catalog.jsonb_array_length(v_parts) > 0 THEN
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'part_id', inventory_part.id,
          'part_no', inventory_part.part_no,
          'quantity', (part.item ->> 'quantity')::numeric
        )
        ORDER BY inventory_part.part_no, inventory_part.id
      ),
      '[]'::jsonb
    )
    INTO v_consumption_parts
    FROM pg_catalog.jsonb_array_elements(v_parts) AS part(item)
    INNER JOIN public.inventory_parts AS inventory_part
      ON inventory_part.company_id = p_company_id
     AND inventory_part.part_no = (part.item ->> 'partId')::integer
     AND inventory_part.active
     AND inventory_part.archived_at IS NULL;

    PERFORM 1
    FROM private.apply_job_inventory_consumption_batch(
      p_company_id,
      v_membership.id,
      v_job.id,
      v_membership.id,
      v_consumption_parts,
      p_created_at
    );

    PERFORM private.bump_company_sync_version(
      p_company_id,
      'company_inventory_version'
    );
  END IF;

  IF p_upload_session_id IS NOT NULL THEN
    INSERT INTO public.job_attachments (
      id,
      job_id,
      storage_path,
      kind,
      uploaded_by_user_id,
      created_at
    )
    SELECT
      (attachment.item ->> 'attachmentId')::uuid,
      v_job.id,
      attachment.item ->> 'objectPath',
      (attachment.item ->> 'kind')::public.job_attachment_kind,
      v_uid::text,
      p_created_at
    FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest) AS attachment(item);

    UPDATE private.file_upload_sessions AS upload_session
    SET status = 'consumed',
        consumed_at = p_created_at,
        consumed_by_job_id = v_job.id,
        updated_at = p_created_at
    WHERE upload_session.id = p_upload_session_id;
  END IF;

  PERFORM private.bump_company_sync_version(p_company_id, 'jobs_version');

  job_id := v_job.id;
  job_no := v_job.job_no;
  status := v_job.status;
  entity_version := v_job.entity_version;
  finished_at := v_job.finished_at;
  created_at := v_job.created_at;
  updated_at := v_job.updated_at;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.create_api_job_with_details(
  UUID,
  public.job_status,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  JSONB,
  JSONB,
  UUID,
  TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.create_api_job_with_details(
  UUID,
  public.job_status,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  JSONB,
  JSONB,
  UUID,
  TIMESTAMPTZ
) TO smart_job_api, service_role;
