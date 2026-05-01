-- 0011_runtime_hardening.sql
-- Aligns runtime schema and SQL helpers with the active backend semantics.

-- ── 1. document_tasks lock semantics ────────────────────────────────────────
ALTER TABLE document_tasks
  ADD COLUMN IF NOT EXISTS lock_key VARCHAR(220);

UPDATE document_tasks
SET lock_key = CASE
  WHEN document_id IS NOT NULL THEN CONCAT('document:', document_id::text)
  WHEN task_type = 'preview' THEN CONCAT('preview:', document_type::text)
  ELSE CONCAT('task:', task_type::text, ':', document_type::text)
END
WHERE lock_key IS NULL OR btrim(lock_key) = '';

ALTER TABLE document_tasks
  ALTER COLUMN lock_key SET NOT NULL;

DROP INDEX IF EXISTS document_tasks_active_company_type_unique;
DROP INDEX IF EXISTS document_tasks_active_company_doc_unique;
DROP INDEX IF EXISTS document_tasks_active_company_lock_unique;

CREATE UNIQUE INDEX document_tasks_active_company_lock_unique
  ON document_tasks (company_id, task_type, lock_key)
  WHERE status IN ('pending', 'queued', 'processing');

-- ── 1b. Atomic tax idempotency claim RPC ────────────────────────────────────
CREATE OR REPLACE FUNCTION claim_tax_invoice_idempotency(
  p_company_id       UUID,
  p_user_id          TEXT,
  p_idempotency_hash VARCHAR(128),
  p_request_hash     VARCHAR(128),
  p_expire_at        TIMESTAMPTZ
) RETURNS TABLE (
  claim_status TEXT,
  result_payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  SELECT status, result_payload, expire_at
  INTO v_existing
  FROM tax_invoice_idempotency
  WHERE company_id = p_company_id
    AND idempotency_hash = p_idempotency_hash
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO tax_invoice_idempotency (
      company_id,
      idempotency_hash,
      user_id,
      status,
      request_hash,
      locked_at,
      expire_at,
      created_at,
      updated_at
    ) VALUES (
      p_company_id,
      p_idempotency_hash,
      p_user_id,
      'in_progress',
      p_request_hash,
      NOW(),
      p_expire_at,
      NOW(),
      NOW()
    );

    claim_status := 'acquired';
    result_payload := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_existing.status = 'approved' THEN
    claim_status := 'approved';
    result_payload := v_existing.result_payload;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_existing.status = 'in_progress' AND (v_existing.expire_at IS NULL OR v_existing.expire_at > NOW()) THEN
    claim_status := 'in_progress';
    result_payload := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE tax_invoice_idempotency
  SET user_id = p_user_id,
      status = 'in_progress',
      request_hash = p_request_hash,
      result_payload = NULL,
      locked_at = NOW(),
      expire_at = p_expire_at,
      updated_at = NOW()
  WHERE company_id = p_company_id
    AND idempotency_hash = p_idempotency_hash;

  claim_status := 'acquired';
  result_payload := NULL;
  RETURN NEXT;
END;
$$;

-- ── 1c. Active membership invariants and atomic inventory movement RPC ──────
DROP INDEX IF EXISTS company_memberships_company_user_unique;
CREATE UNIQUE INDEX IF NOT EXISTS company_memberships_company_user_active_unique
  ON company_memberships (company_id, user_id)
  WHERE status = 'active';

DROP INDEX IF EXISTS inventory_locations_company_location_unique;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_company_null_membership_unique
  ON inventory_locations (company_id, location_type)
  WHERE membership_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_company_membership_unique
  ON inventory_locations (company_id, location_type, membership_id)
  WHERE membership_id IS NOT NULL;

CREATE OR REPLACE FUNCTION apply_inventory_movement(
  p_company_id UUID,
  p_part_id UUID,
  p_quantity NUMERIC,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_movement_type inventory_movement_type,
  p_created_by_membership_id UUID,
  p_job_id UUID DEFAULT NULL,
  p_document_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  movement_id UUID,
  from_quantity NUMERIC,
  to_quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_quantity NUMERIC := NULL;
  v_to_quantity NUMERIC := NULL;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'inventory_invalid_quantity';
  END IF;

  IF p_from_location_id IS NULL AND p_to_location_id IS NULL THEN
    RAISE EXCEPTION 'inventory_missing_location';
  END IF;

  IF p_from_location_id IS NOT NULL THEN
    INSERT INTO inventory_balances (location_id, part_id, quantity_on_hand, updated_at)
    VALUES (p_from_location_id, p_part_id, 0, p_created_at)
    ON CONFLICT (location_id, part_id) DO NOTHING;

    UPDATE inventory_balances
    SET quantity_on_hand = quantity_on_hand - p_quantity,
        updated_at = p_created_at
    WHERE location_id = p_from_location_id
      AND part_id = p_part_id
      AND quantity_on_hand >= p_quantity
    RETURNING quantity_on_hand INTO v_from_quantity;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'inventory_insufficient_stock';
    END IF;
  END IF;

  IF p_to_location_id IS NOT NULL THEN
    INSERT INTO inventory_balances (location_id, part_id, quantity_on_hand, updated_at)
    VALUES (p_to_location_id, p_part_id, p_quantity, p_created_at)
    ON CONFLICT (location_id, part_id) DO UPDATE
      SET quantity_on_hand = inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
          updated_at = EXCLUDED.updated_at
    RETURNING quantity_on_hand INTO v_to_quantity;
  END IF;

  INSERT INTO inventory_movements (
    company_id,
    part_id,
    quantity,
    from_location_id,
    to_location_id,
    movement_type,
    job_id,
    document_id,
    created_by_membership_id,
    note,
    created_at
  ) VALUES (
    p_company_id,
    p_part_id,
    p_quantity,
    p_from_location_id,
    p_to_location_id,
    p_movement_type,
    p_job_id,
    p_document_id,
    p_created_by_membership_id,
    p_note,
    p_created_at
  ) RETURNING id INTO movement_id;

  from_quantity := v_from_quantity;
  to_quantity := v_to_quantity;
  RETURN NEXT;
END;
$$;

-- ── 2. Atomic invite redemption RPC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION redeem_company_invite(
  p_invite_code   VARCHAR(80),
  p_uid           TEXT,
  p_display_name  VARCHAR(200) DEFAULT NULL,
  p_phone_number  VARCHAR(40) DEFAULT NULL,
  p_email         VARCHAR(320) DEFAULT NULL
) RETURNS TABLE (
  company_id UUID,
  public_company_id BIGINT,
  membership_id UUID,
  member_no INTEGER,
  role membership_role,
  display_name VARCHAR(200),
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_invite RECORD;
  v_existing RECORD;
  v_member_no INTEGER;
  v_membership RECORD;
BEGIN
  SELECT
    i.id,
    i.company_id,
    i.target_role,
    i.status,
    i.used_by_user_id,
    i.expires_at,
    i.invited_email,
    c.public_company_id
  INTO v_invite
  FROM company_invites i
  INNER JOIN companies c ON c.id = i.company_id
  WHERE UPPER(i.code) = UPPER(BTRIM(p_invite_code))
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF v_invite.expires_at <= v_now THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;

  IF v_invite.invited_email IS NOT NULL AND p_email IS NOT NULL AND LOWER(v_invite.invited_email) <> LOWER(p_email) THEN
    RAISE EXCEPTION 'invite_email_mismatch';
  END IF;

  SELECT
    m.id,
    m.company_id,
    m.member_no,
    m.role,
    m.display_name,
    m.joined_at
  INTO v_existing
  FROM company_memberships m
  WHERE m.user_id = p_uid
    AND m.status = 'active'
  ORDER BY m.joined_at ASC, m.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.company_id = v_invite.company_id THEN
      IF v_invite.status = 'used' AND v_invite.used_by_user_id = p_uid THEN
        company_id := v_existing.company_id;
        public_company_id := v_invite.public_company_id;
        membership_id := v_existing.id;
        member_no := v_existing.member_no;
        role := v_existing.role;
        display_name := v_existing.display_name;
        joined_at := v_existing.joined_at;
        RETURN NEXT;
        RETURN;
      END IF;
      RAISE EXCEPTION 'user_already_in_company';
    END IF;

    RAISE EXCEPTION 'user_already_in_other_company';
  END IF;

  IF v_invite.status <> 'active' THEN
    RAISE EXCEPTION 'invite_inactive';
  END IF;

  IF v_invite.target_role NOT IN ('manager', 'worker', 'user', 'basic') THEN
    RAISE EXCEPTION 'invite_role_invalid';
  END IF;

  INSERT INTO app_users (id, email, display_name, phone_number, created_at, updated_at)
  VALUES (p_uid, NULLIF(BTRIM(p_email), ''), NULLIF(BTRIM(p_display_name), ''), NULLIF(BTRIM(p_phone_number), ''), v_now, v_now)
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, app_users.email),
        display_name = COALESCE(EXCLUDED.display_name, app_users.display_name),
        phone_number = COALESCE(EXCLUDED.phone_number, app_users.phone_number),
        updated_at = v_now;

  v_member_no := allocate_company_counter(v_invite.company_id, 'member_no');

  INSERT INTO company_memberships (
    company_id,
    user_id,
    member_no,
    role,
    status,
    display_name,
    phone_number,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    v_invite.company_id,
    p_uid,
    v_member_no,
    v_invite.target_role,
    'active',
    NULLIF(BTRIM(p_display_name), ''),
    NULLIF(BTRIM(p_phone_number), ''),
    v_now,
    v_now,
    v_now
  ) RETURNING id, company_id, member_no, role, display_name, joined_at
  INTO v_membership;

  INSERT INTO inventory_locations (company_id, location_type, membership_id, name, created_at)
  VALUES (
    v_invite.company_id,
    'member',
    v_membership.id,
    COALESCE(NULLIF(BTRIM(p_display_name), ''), NULLIF(BTRIM(p_email), ''), CONCAT('Member ', v_member_no::text)),
    v_now
  )
  ON CONFLICT DO NOTHING;

  UPDATE company_invites
  SET status = 'used',
      used_by_user_id = p_uid,
      used_at = v_now
  WHERE id = v_invite.id;

  company_id := v_membership.company_id;
  public_company_id := v_invite.public_company_id;
  membership_id := v_membership.id;
  member_no := v_membership.member_no;
  role := v_membership.role;
  display_name := v_membership.display_name;
  joined_at := v_membership.joined_at;
  RETURN NEXT;
END;
$$;
