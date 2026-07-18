-- Accepting a submitted job must consume its recorded inventory-backed parts
-- in the same transaction, before the job becomes finished. The locked job row
-- is the exactly-once gate for concurrent acceptance attempts.

CREATE OR REPLACE FUNCTION private.accept_api_job(
  p_company_id UUID,
  p_job_id UUID,
  p_expected_entity_version BIGINT,
  p_accepted_at TIMESTAMPTZ
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status TEXT,
  title TEXT,
  description TEXT,
  notes TEXT,
  location TEXT,
  address TEXT,
  category TEXT,
  priority TEXT,
  due_at TIMESTAMPTZ,
  client_id UUID,
  client_name TEXT,
  client_phone TEXT,
  assignee_member_no INTEGER,
  assignee_display_name TEXT,
  creator_uid UUID,
  creator_member_no INTEGER,
  creator_display_name TEXT,
  is_certificate BOOLEAN,
  meta JSONB,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_actor_user_id TEXT;
  v_actor_membership_id UUID;
  v_actor_role TEXT;
  v_consumer_membership_id UUID;
  v_consumption_parts JSONB := '[]'::JSONB;
  v_accepted_at TIMESTAMPTZ := COALESCE(
    p_accepted_at,
    pg_catalog.clock_timestamp()
  );
BEGIN
  IF p_company_id IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMPANY_AND_JOB_REQUIRED';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ENTITY_VERSION_INVALID';
  END IF;

  SELECT
    actor.actor_user_id,
    actor.actor_membership_id,
    actor.actor_role
  INTO v_actor_user_id, v_actor_membership_id, v_actor_role
  FROM private.require_api_job_mutation_actor(p_company_id) AS actor;
  IF v_actor_role NOT IN ('manager', 'dev') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'JOB_ACCEPT_FORBIDDEN';
  END IF;

  SELECT job.*
  INTO v_job
  FROM public.jobs AS job
  WHERE job.company_id = p_company_id
    AND job.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'JOB_NOT_FOUND';
  END IF;
  IF v_job.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'ENTITY_VERSION_CONFLICT';
  END IF;
  IF v_job.status NOT IN ('pending', 'waiting') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_NOT_ACCEPTABLE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.job_part_usages AS usage
    WHERE usage.job_id = v_job.id
      AND usage.inventory_part_id IS NOT NULL
      AND usage.quantity > 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.inventory_parts AS part
        WHERE part.id = usage.inventory_part_id
          AND part.company_id = p_company_id
          AND part.active
          AND part.archived_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'part_id', consumption.inventory_part_id,
        'part_no', consumption.part_no,
        'quantity', consumption.quantity
      )
      ORDER BY consumption.inventory_part_id
    ),
    '[]'::JSONB
  )
  INTO v_consumption_parts
  FROM (
    SELECT
      usage.inventory_part_id,
      part.part_no,
      pg_catalog.sum(usage.quantity)::NUMERIC AS quantity
    FROM public.job_part_usages AS usage
    INNER JOIN public.inventory_parts AS part
      ON part.id = usage.inventory_part_id
     AND part.company_id = p_company_id
     AND part.active
     AND part.archived_at IS NULL
    WHERE usage.job_id = v_job.id
      AND usage.inventory_part_id IS NOT NULL
      AND usage.quantity > 0
    GROUP BY usage.inventory_part_id, part.part_no
  ) AS consumption;

  IF pg_catalog.jsonb_array_length(v_consumption_parts) > 0 THEN
    v_consumer_membership_id := COALESCE(
      v_job.assigned_membership_id,
      v_actor_membership_id
    );
    IF v_consumer_membership_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'INVENTORY_CONSUMER_MEMBERSHIP_REQUIRED';
    END IF;

    PERFORM 1
    FROM private.apply_job_inventory_consumption_batch(
      p_company_id,
      v_consumer_membership_id,
      p_job_id,
      COALESCE(
        v_actor_membership_id,
        v_job.created_by_membership_id,
        v_consumer_membership_id
      ),
      v_consumption_parts,
      v_accepted_at
    );
  END IF;

  UPDATE public.jobs AS job
  SET
    status = 'finished',
    accepted_by_user_id = v_actor_user_id,
    accepted_at = v_accepted_at,
    finished_at = v_accepted_at,
    denied_at = NULL,
    denied_by_user_id = NULL,
    updated_at = v_accepted_at
  WHERE job.id = p_job_id
    AND job.company_id = p_company_id
  RETURNING job.* INTO v_job;

  IF pg_catalog.jsonb_array_length(v_consumption_parts) > 0 THEN
    PERFORM private.bump_company_sync_version(
      p_company_id,
      'company_inventory_version'
    );
  END IF;
  PERFORM private.bump_company_sync_version(p_company_id, 'jobs_version');

  RETURN QUERY
  SELECT result.*
  FROM private.get_api_job_mutation_result(p_company_id, p_job_id) AS result;
END;
$$;

REVOKE ALL ON FUNCTION private.accept_api_job(UUID, UUID, BIGINT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.accept_api_job(UUID, UUID, BIGINT, TIMESTAMPTZ)
  TO smart_job_api;
