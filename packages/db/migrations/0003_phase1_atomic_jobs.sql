-- Phase 1: atomic job creation.
-- Replaces the edge handler's multi-step insert/rollback with a single transaction.

CREATE OR REPLACE FUNCTION private.create_job_with_details(
  p_company_id UUID,
  p_job_no INTEGER,
  p_status public.job_status,
  p_title VARCHAR(240),
  p_description TEXT,
  p_notes TEXT,
  p_location VARCHAR(240),
  p_address VARCHAR(500),
  p_category VARCHAR(120),
  p_priority VARCHAR(40),
  p_due_at TIMESTAMPTZ,
  p_client_id UUID,
  p_assigned_membership_id UUID,
  p_created_by_membership_id UUID,
  p_accepted_by_user_id TEXT,
  p_accepted_at TIMESTAMPTZ,
  p_finished_at TIMESTAMPTZ,
  p_client_name_snapshot VARCHAR(240),
  p_client_phone_snapshot VARCHAR(40),
  p_assigned_member_name_snapshot VARCHAR(200),
  p_created_by_name_snapshot VARCHAR(200),
  p_idempotency_key VARCHAR(128),
  p_meta JSONB,
  p_created_at TIMESTAMPTZ,
  p_parts JSONB DEFAULT '[]'::jsonb,
  p_attachments JSONB DEFAULT '[]'::jsonb,
  p_consume_inventory BOOLEAN DEFAULT FALSE,
  p_consumer_membership_id UUID DEFAULT NULL,
  p_consume_parts JSONB DEFAULT '[]'::jsonb
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status public.job_status,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
  v_part RECORD;
  v_attachment RECORD;
BEGIN
  INSERT INTO jobs (
    company_id,
    job_no,
    status,
    title,
    description,
    notes,
    location,
    address,
    category,
    priority,
    due_at,
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
    idempotency_key,
    meta,
    created_at,
    updated_at
  ) VALUES (
    p_company_id,
    p_job_no,
    p_status,
    p_title,
    p_description,
    p_notes,
    p_location,
    p_address,
    p_category,
    p_priority,
    p_due_at,
    p_client_id,
    p_assigned_membership_id,
    p_created_by_membership_id,
    p_accepted_by_user_id,
    p_accepted_at,
    p_finished_at,
    p_client_name_snapshot,
    p_client_phone_snapshot,
    p_assigned_member_name_snapshot,
    p_created_by_name_snapshot,
    p_idempotency_key,
    COALESCE(p_meta, '{}'::jsonb),
    p_created_at,
    p_created_at
  )
  RETURNING id INTO v_job_id;

  IF p_parts IS NOT NULL AND jsonb_typeof(p_parts) = 'array' AND jsonb_array_length(p_parts) > 0 THEN
    FOR v_part IN
      SELECT *
      FROM jsonb_to_recordset(p_parts) AS part(
        inventory_part_id UUID,
        part_name_snapshot VARCHAR(240),
        quantity NUMERIC
      )
    LOOP
      INSERT INTO job_part_usages (
        job_id,
        inventory_part_id,
        part_name_snapshot,
        quantity,
        created_at
      ) VALUES (
        v_job_id,
        v_part.inventory_part_id,
        v_part.part_name_snapshot,
        v_part.quantity,
        p_created_at
      );
    END LOOP;
  END IF;

  IF p_attachments IS NOT NULL AND jsonb_typeof(p_attachments) = 'array' AND jsonb_array_length(p_attachments) > 0 THEN
    FOR v_attachment IN
      SELECT *
      FROM jsonb_to_recordset(p_attachments) AS attachment(
        storage_path VARCHAR(1024),
        kind public.job_attachment_kind,
        uploaded_by_user_id TEXT
      )
    LOOP
      INSERT INTO job_attachments (
        job_id,
        storage_path,
        kind,
        uploaded_by_user_id,
        created_at
      ) VALUES (
        v_job_id,
        v_attachment.storage_path,
        v_attachment.kind,
        v_attachment.uploaded_by_user_id,
        p_created_at
      );
    END LOOP;
  END IF;

  IF p_consume_inventory AND p_status = 'finished' AND p_consumer_membership_id IS NOT NULL AND p_consume_parts IS NOT NULL THEN
    PERFORM *
    FROM private.apply_job_inventory_consumption_batch(
      p_company_id,
      p_consumer_membership_id,
      v_job_id,
      p_created_by_membership_id,
      p_consume_parts,
      p_created_at
    );
  END IF;

  RETURN QUERY
  SELECT
    j.id,
    j.job_no,
    j.status,
    j.created_at,
    j.updated_at
  FROM jobs j
  WHERE j.id = v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_job_with_details(
  p_company_id UUID,
  p_job_no INTEGER,
  p_status public.job_status,
  p_title VARCHAR(240),
  p_description TEXT,
  p_notes TEXT,
  p_location VARCHAR(240),
  p_address VARCHAR(500),
  p_category VARCHAR(120),
  p_priority VARCHAR(40),
  p_due_at TIMESTAMPTZ,
  p_client_id UUID,
  p_assigned_membership_id UUID,
  p_created_by_membership_id UUID,
  p_accepted_by_user_id TEXT,
  p_accepted_at TIMESTAMPTZ,
  p_finished_at TIMESTAMPTZ,
  p_client_name_snapshot VARCHAR(240),
  p_client_phone_snapshot VARCHAR(40),
  p_assigned_member_name_snapshot VARCHAR(200),
  p_created_by_name_snapshot VARCHAR(200),
  p_idempotency_key VARCHAR(128),
  p_meta JSONB,
  p_created_at TIMESTAMPTZ,
  p_parts JSONB DEFAULT '[]'::jsonb,
  p_attachments JSONB DEFAULT '[]'::jsonb,
  p_consume_inventory BOOLEAN DEFAULT FALSE,
  p_consumer_membership_id UUID DEFAULT NULL,
  p_consume_parts JSONB DEFAULT '[]'::jsonb
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status public.job_status,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT *
  FROM private.create_job_with_details(
    p_company_id,
    p_job_no,
    p_status,
    p_title,
    p_description,
    p_notes,
    p_location,
    p_address,
    p_category,
    p_priority,
    p_due_at,
    p_client_id,
    p_assigned_membership_id,
    p_created_by_membership_id,
    p_accepted_by_user_id,
    p_accepted_at,
    p_finished_at,
    p_client_name_snapshot,
    p_client_phone_snapshot,
    p_assigned_member_name_snapshot,
    p_created_by_name_snapshot,
    p_idempotency_key,
    p_meta,
    p_created_at,
    p_parts,
    p_attachments,
    p_consume_inventory,
    p_consumer_membership_id,
    p_consume_parts
  );
$$;
