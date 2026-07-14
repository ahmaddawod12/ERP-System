-- Secure, versioned, and atomic inventory mutations for the Node API.

ALTER TABLE public.inventory_parts
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT inventory_parts_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

ALTER TABLE public.inventory_balances
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT inventory_balances_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.increment_inventory_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER inventory_parts_increment_entity_version
BEFORE UPDATE ON public.inventory_parts
FOR EACH ROW
EXECUTE FUNCTION private.increment_inventory_entity_version();--> statement-breakpoint

CREATE TRIGGER inventory_balances_increment_entity_version
BEFORE UPDATE ON public.inventory_balances
FOR EACH ROW
EXECUTE FUNCTION private.increment_inventory_entity_version();--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.require_api_inventory_access(
  p_company_id UUID,
  p_manager_required BOOLEAN
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_membership_id UUID;
  v_inventory_enabled BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_company_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.companies AS company
    WHERE company.id = p_company_id AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_COMPANY_NOT_FOUND';
  END IF;

  SELECT entitlement.inventory_enabled
  INTO v_inventory_enabled
  FROM private.get_company_module_entitlements(p_company_id) AS entitlement;
  IF NOT COALESCE(v_inventory_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_MODULE_DISABLED';
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
    AND membership.role IN ('manager', 'worker', 'user')
    AND (NOT p_manager_required OR membership.role = 'manager')
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_MUTATION_FORBIDDEN';
  END IF;
  RETURN v_membership_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.ensure_api_inventory_location(
  p_company_id UUID,
  p_location_type public.inventory_location_type,
  p_membership_id UUID,
  p_created_at TIMESTAMPTZ
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_location_id UUID;
BEGIN
  IF p_location_type NOT IN ('company', 'member', 'adjustment') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_LOCATION_TYPE_INVALID';
  END IF;
  IF (p_location_type = 'member') <> (p_membership_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_LOCATION_MEMBERSHIP_INVALID';
  END IF;
  IF p_membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_memberships AS membership
    WHERE membership.id = p_membership_id
      AND membership.company_id = p_company_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_MEMBER_NOT_FOUND';
  END IF;

  INSERT INTO public.inventory_locations AS location (
    company_id, location_type, membership_id, name, created_at
  ) VALUES (
    p_company_id,
    p_location_type,
    p_membership_id,
    CASE p_location_type
      WHEN 'company' THEN 'Company Inventory'
      WHEN 'adjustment' THEN 'Inventory Adjustments'
      ELSE 'Member Inventory'
    END,
    COALESCE(p_created_at, pg_catalog.clock_timestamp())
  ) ON CONFLICT DO NOTHING;

  SELECT location.id INTO v_location_id
  FROM public.inventory_locations AS location
  WHERE location.company_id = p_company_id
    AND location.location_type = p_location_type
    AND location.membership_id IS NOT DISTINCT FROM p_membership_id
  LIMIT 1;
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_LOCATION_NOT_FOUND';
  END IF;
  RETURN v_location_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.get_api_inventory_snapshot(
  p_company_id UUID,
  p_part_id UUID,
  p_location_id UUID
) RETURNS TABLE (
  part_id UUID,
  part_no INTEGER,
  status TEXT,
  name TEXT,
  active BOOLEAN,
  quantity_on_hand NUMERIC,
  low_threshold NUMERIC,
  unit TEXT,
  entity_version BIGINT,
  stock_entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    part.id,
    part.part_no,
    CASE
      WHEN part.archived_at IS NOT NULL THEN 'archived'
      WHEN part.active THEN 'active'
      ELSE 'inactive'
    END,
    part.name::TEXT,
    part.active,
    COALESCE(balance.quantity_on_hand, 0),
    part.low_threshold,
    part.unit::TEXT,
    part.entity_version,
    COALESCE(balance.entity_version, 1),
    part.created_at,
    GREATEST(part.updated_at, COALESCE(balance.updated_at, part.updated_at)),
    part.archived_at
  FROM public.inventory_parts AS part
  LEFT JOIN public.inventory_balances AS balance
    ON balance.location_id = p_location_id
   AND balance.part_id = part.id
  WHERE part.company_id = p_company_id
    AND part.id = p_part_id;
$$;--> statement-breakpoint

-- Harden the shared movement primitive used by API inventory, legacy Edge, and
-- atomic job completion. Every referenced entity must belong to one tenant and
-- both balance rows are locked in canonical location order.
CREATE OR REPLACE FUNCTION private.apply_inventory_movement(
  p_company_id UUID,
  p_part_id UUID,
  p_quantity NUMERIC,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_movement_type public.inventory_movement_type,
  p_created_by_membership_id UUID,
  p_job_id UUID DEFAULT NULL,
  p_document_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT pg_catalog.now()
) RETURNS TABLE (
  movement_id UUID,
  from_quantity NUMERIC,
  to_quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from_quantity NUMERIC := NULL;
  v_to_quantity NUMERIC := NULL;
  v_created_at TIMESTAMPTZ := COALESCE(p_created_at, pg_catalog.clock_timestamp());
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0
     OR p_quantity > 99999999999.999
     OR p_quantity <> pg_catalog.round(p_quantity, 3) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_QUANTITY_INVALID';
  END IF;
  IF p_from_location_id IS NULL AND p_to_location_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_LOCATION_REQUIRED';
  END IF;
  IF p_from_location_id IS NOT NULL AND p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_LOCATIONS_IDENTICAL';
  END IF;
  IF p_note IS NOT NULL AND pg_catalog.char_length(p_note) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_NOTE_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_parts AS part
    WHERE part.id = p_part_id AND part.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES (p_from_location_id), (p_to_location_id)) AS wanted(id)
    WHERE wanted.id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_locations AS location
        WHERE location.id = wanted.id AND location.company_id = p_company_id
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_LOCATION_TENANT_MISMATCH';
  END IF;
  IF p_created_by_membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_memberships AS membership
    WHERE membership.id = p_created_by_membership_id
      AND membership.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_CREATOR_TENANT_MISMATCH';
  END IF;
  IF p_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.jobs AS job
    WHERE job.id = p_job_id AND job.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_JOB_TENANT_MISMATCH';
  END IF;
  IF p_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.documents AS document
    WHERE document.id = p_document_id AND document.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_DOCUMENT_TENANT_MISMATCH';
  END IF;

  INSERT INTO public.inventory_balances AS balance (
    location_id, part_id, quantity_on_hand, updated_at
  )
  SELECT location_id, p_part_id, 0, v_created_at
  FROM (VALUES (p_from_location_id), (p_to_location_id)) AS wanted(location_id)
  WHERE wanted.location_id IS NOT NULL
  ON CONFLICT ON CONSTRAINT inventory_balances_pk DO NOTHING;

  PERFORM balance.location_id
  FROM public.inventory_balances AS balance
  WHERE balance.part_id = p_part_id
    AND balance.location_id IN (p_from_location_id, p_to_location_id)
  ORDER BY balance.location_id
  FOR UPDATE;

  IF p_from_location_id IS NOT NULL THEN
    UPDATE public.inventory_balances AS balance
    SET quantity_on_hand = balance.quantity_on_hand - p_quantity,
        updated_at = v_created_at
    WHERE balance.location_id = p_from_location_id
      AND balance.part_id = p_part_id
      AND balance.quantity_on_hand >= p_quantity
    RETURNING balance.quantity_on_hand INTO v_from_quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'inventory_insufficient_stock';
    END IF;
  END IF;

  IF p_to_location_id IS NOT NULL THEN
    UPDATE public.inventory_balances AS balance
    SET quantity_on_hand = balance.quantity_on_hand + p_quantity,
        updated_at = v_created_at
    WHERE balance.location_id = p_to_location_id
      AND balance.part_id = p_part_id
    RETURNING balance.quantity_on_hand INTO v_to_quantity;
  END IF;

  INSERT INTO public.inventory_movements AS movement (
    company_id, part_id, quantity, from_location_id, to_location_id,
    movement_type, job_id, document_id, created_by_membership_id, note, created_at
  ) VALUES (
    p_company_id, p_part_id, p_quantity, p_from_location_id, p_to_location_id,
    p_movement_type, p_job_id, p_document_id, p_created_by_membership_id,
    NULLIF(pg_catalog.btrim(p_note), ''), v_created_at
  ) RETURNING movement.id INTO movement_id;

  from_quantity := v_from_quantity;
  to_quantity := v_to_quantity;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.apply_inventory_pick_batch(
  p_company_id UUID,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_created_by_membership_id UUID,
  p_picks JSONB,
  p_created_at TIMESTAMPTZ DEFAULT pg_catalog.now()
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pick RECORD;
  v_movement RECORD;
  v_count INTEGER;
  v_distinct_count INTEGER;
BEGIN
  IF p_picks IS NULL OR pg_catalog.jsonb_typeof(p_picks) <> 'array'
     OR pg_catalog.jsonb_array_length(p_picks) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICKS_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations AS location
    WHERE location.id = p_from_location_id
      AND location.company_id = p_company_id
      AND location.location_type = 'company'
      AND location.membership_id IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.inventory_locations AS location
    WHERE location.id = p_to_location_id
      AND location.company_id = p_company_id
      AND location.location_type = 'member'
      AND location.membership_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_PICK_LOCATION_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_picks) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_object_keys(item.value) AS key(name)
         WHERE key.name NOT IN ('part_id', 'part_no', 'quantity')
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICK_FIELDS_INVALID';
  END IF;

  SELECT pg_catalog.count(*), pg_catalog.count(DISTINCT parsed.part_id)
  INTO v_count, v_distinct_count
  FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
    part_id UUID, part_no INTEGER, quantity NUMERIC
  );
  IF v_count <> v_distinct_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICK_DUPLICATE_PART';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
      part_id UUID, part_no INTEGER, quantity NUMERIC
    )
    LEFT JOIN public.inventory_parts AS part
      ON part.id = parsed.part_id AND part.company_id = p_company_id
    WHERE parsed.part_id IS NULL
       OR parsed.quantity IS NULL OR parsed.quantity <= 0
       OR parsed.quantity > 99999999999.999
       OR parsed.quantity <> pg_catalog.round(parsed.quantity, 3)
       OR part.id IS NULL OR part.archived_at IS NOT NULL OR NOT part.active
       OR (parsed.part_no IS NOT NULL AND parsed.part_no <> part.part_no)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICK_ITEM_INVALID';
  END IF;

  INSERT INTO public.inventory_balances AS balance (
    location_id, part_id, quantity_on_hand, updated_at
  )
  SELECT p_from_location_id, parsed.part_id, 0, COALESCE(p_created_at, pg_catalog.clock_timestamp())
  FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
    part_id UUID, part_no INTEGER, quantity NUMERIC
  )
  ON CONFLICT ON CONSTRAINT inventory_balances_pk DO NOTHING;

  PERFORM balance.part_id
  FROM public.inventory_balances AS balance
  WHERE balance.location_id = p_from_location_id
    AND balance.part_id IN (
      SELECT parsed.part_id
      FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
        part_id UUID, part_no INTEGER, quantity NUMERIC
      )
    )
  ORDER BY balance.part_id
  FOR UPDATE;

  FOR v_pick IN
    SELECT parsed.part_id, part.part_no, parsed.quantity
    FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
      part_id UUID, part_no INTEGER, quantity NUMERIC
    )
    INNER JOIN public.inventory_parts AS part
      ON part.id = parsed.part_id AND part.company_id = p_company_id
    ORDER BY parsed.part_id
  LOOP
    SELECT movement.* INTO v_movement
    FROM private.apply_inventory_movement(
      p_company_id,
      v_pick.part_id,
      v_pick.quantity,
      p_from_location_id,
      p_to_location_id,
      'pick'::public.inventory_movement_type,
      p_created_by_membership_id,
      NULL,
      NULL,
      'Picked part #' || v_pick.part_no::TEXT,
      p_created_at
    ) AS movement;
    movement_id := v_movement.movement_id;
    part_id := v_pick.part_id;
    part_no := v_pick.part_no;
    quantity := v_pick.quantity;
    RETURN NEXT;
  END LOOP;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.adjust_api_inventory_stock(
  p_company_id UUID,
  p_part_id UUID,
  p_scope TEXT,
  p_expected_stock_entity_version BIGINT,
  p_quantity_delta NUMERIC,
  p_note TEXT,
  p_adjusted_at TIMESTAMPTZ
) RETURNS TABLE (
  part_id UUID, part_no INTEGER, status TEXT, name TEXT, active BOOLEAN,
  quantity_on_hand NUMERIC, low_threshold NUMERIC, unit TEXT,
  entity_version BIGINT, stock_entity_version BIGINT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_location_id UUID;
  v_adjustment_location_id UUID;
  v_balance public.inventory_balances%ROWTYPE;
  v_adjusted_at TIMESTAMPTZ := COALESCE(p_adjusted_at, pg_catalog.clock_timestamp());
BEGIN
  IF p_scope NOT IN ('company', 'member')
     OR p_expected_stock_entity_version IS NULL OR p_expected_stock_entity_version < 1
     OR p_quantity_delta IS NULL OR p_quantity_delta = 0
     OR pg_catalog.abs(p_quantity_delta) > 99999999999.999
     OR p_quantity_delta <> pg_catalog.round(p_quantity_delta, 3)
     OR (p_note IS NOT NULL AND pg_catalog.char_length(p_note) > 500) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_ADJUSTMENT_INVALID';
  END IF;
  v_membership_id := private.require_api_inventory_access(
    p_company_id, p_scope = 'company'
  );
  IF p_scope = 'member' AND v_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_MEMBER_MUTATION_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_parts AS part
    WHERE part.id = p_part_id AND part.company_id = p_company_id
      AND part.archived_at IS NULL AND part.active
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;

  v_location_id := private.ensure_api_inventory_location(
    p_company_id,
    CASE WHEN p_scope = 'company'
      THEN 'company'::public.inventory_location_type
      ELSE 'member'::public.inventory_location_type
    END,
    CASE WHEN p_scope = 'member' THEN v_membership_id ELSE NULL END,
    v_adjusted_at
  );
  INSERT INTO public.inventory_balances AS balance (
    location_id, part_id, quantity_on_hand, updated_at
  ) VALUES (v_location_id, p_part_id, 0, v_adjusted_at)
  ON CONFLICT ON CONSTRAINT inventory_balances_pk DO NOTHING;
  SELECT balance.* INTO v_balance
  FROM public.inventory_balances AS balance
  WHERE balance.location_id = v_location_id AND balance.part_id = p_part_id
  FOR UPDATE;
  IF v_balance.entity_version <> p_expected_stock_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'INVENTORY_STOCK_VERSION_CONFLICT';
  END IF;

  IF p_quantity_delta > 0 THEN
    PERFORM 1 FROM private.apply_inventory_movement(
      p_company_id, p_part_id, p_quantity_delta, NULL, v_location_id,
      'adjust'::public.inventory_movement_type, v_membership_id,
      NULL, NULL, p_note, v_adjusted_at
    );
  ELSE
    v_adjustment_location_id := private.ensure_api_inventory_location(
      p_company_id, 'adjustment'::public.inventory_location_type, NULL, v_adjusted_at
    );
    PERFORM 1 FROM private.apply_inventory_movement(
      p_company_id, p_part_id, pg_catalog.abs(p_quantity_delta),
      v_location_id, v_adjustment_location_id,
      'adjust'::public.inventory_movement_type, v_membership_id,
      NULL, NULL, p_note, v_adjusted_at
    );
  END IF;
  PERFORM private.bump_company_sync_version(p_company_id, 'company_inventory_version');
  RETURN QUERY SELECT * FROM private.get_api_inventory_snapshot(
    p_company_id, p_part_id, v_location_id
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.transfer_api_inventory_stock(
  p_company_id UUID,
  p_part_id UUID,
  p_member_no INTEGER,
  p_direction TEXT,
  p_quantity NUMERIC,
  p_expected_source_stock_entity_version BIGINT,
  p_note TEXT,
  p_transferred_at TIMESTAMPTZ
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC,
  source_quantity NUMERIC,
  source_stock_entity_version BIGINT,
  destination_quantity NUMERIC,
  destination_stock_entity_version BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_requester_membership_id UUID;
  v_target_membership_id UUID;
  v_company_location_id UUID;
  v_member_location_id UUID;
  v_source_location_id UUID;
  v_destination_location_id UUID;
  v_source_balance public.inventory_balances%ROWTYPE;
  v_movement RECORD;
  v_part_no INTEGER;
  v_transferred_at TIMESTAMPTZ := COALESCE(p_transferred_at, pg_catalog.clock_timestamp());
BEGIN
  IF p_member_no IS NULL OR p_member_no < 1
     OR p_direction NOT IN ('company_to_member', 'member_to_company')
     OR p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 99999999999.999
     OR p_quantity <> pg_catalog.round(p_quantity, 3)
     OR p_expected_source_stock_entity_version IS NULL
     OR p_expected_source_stock_entity_version < 1
     OR (p_note IS NOT NULL AND pg_catalog.char_length(p_note) > 500) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_TRANSFER_INVALID';
  END IF;
  v_requester_membership_id := private.require_api_inventory_access(p_company_id, true);
  SELECT membership.id INTO v_target_membership_id
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.member_no = p_member_no
    AND membership.status = 'active'
  LIMIT 1;
  IF v_target_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_MEMBER_NOT_FOUND';
  END IF;
  SELECT part.part_no INTO v_part_no
  FROM public.inventory_parts AS part
  WHERE part.id = p_part_id AND part.company_id = p_company_id
    AND part.archived_at IS NULL AND part.active;
  IF v_part_no IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;
  v_company_location_id := private.ensure_api_inventory_location(
    p_company_id, 'company'::public.inventory_location_type, NULL, v_transferred_at
  );
  v_member_location_id := private.ensure_api_inventory_location(
    p_company_id, 'member'::public.inventory_location_type,
    v_target_membership_id, v_transferred_at
  );
  IF p_direction = 'company_to_member' THEN
    v_source_location_id := v_company_location_id;
    v_destination_location_id := v_member_location_id;
  ELSE
    v_source_location_id := v_member_location_id;
    v_destination_location_id := v_company_location_id;
  END IF;
  INSERT INTO public.inventory_balances AS balance (
    location_id, part_id, quantity_on_hand, updated_at
  ) VALUES (v_source_location_id, p_part_id, 0, v_transferred_at)
  ON CONFLICT ON CONSTRAINT inventory_balances_pk DO NOTHING;
  SELECT balance.* INTO v_source_balance
  FROM public.inventory_balances AS balance
  WHERE balance.location_id = v_source_location_id AND balance.part_id = p_part_id
  FOR UPDATE;
  IF v_source_balance.entity_version <> p_expected_source_stock_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'INVENTORY_STOCK_VERSION_CONFLICT';
  END IF;
  SELECT movement.* INTO v_movement
  FROM private.apply_inventory_movement(
    p_company_id, p_part_id, p_quantity,
    v_source_location_id, v_destination_location_id,
    CASE WHEN p_direction = 'company_to_member'
      THEN 'pick'::public.inventory_movement_type
      ELSE 'return'::public.inventory_movement_type
    END,
    v_requester_membership_id, NULL, NULL, p_note, v_transferred_at
  ) AS movement;
  PERFORM private.bump_company_sync_version(p_company_id, 'company_inventory_version');

  RETURN QUERY
  SELECT
    v_movement.movement_id,
    p_part_id,
    v_part_no,
    p_quantity,
    source_balance.quantity_on_hand,
    source_balance.entity_version,
    destination_balance.quantity_on_hand,
    destination_balance.entity_version
  FROM public.inventory_balances AS source_balance
  INNER JOIN public.inventory_balances AS destination_balance
    ON destination_balance.location_id = v_destination_location_id
   AND destination_balance.part_id = p_part_id
  WHERE source_balance.location_id = v_source_location_id
    AND source_balance.part_id = p_part_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.pick_api_inventory_stock(
  p_company_id UUID,
  p_member_no INTEGER,
  p_picks JSONB,
  p_picked_at TIMESTAMPTZ
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC,
  source_quantity NUMERIC,
  source_stock_entity_version BIGINT,
  destination_quantity NUMERIC,
  destination_stock_entity_version BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_requester_membership_id UUID;
  v_target_membership_id UUID;
  v_company_location_id UUID;
  v_member_location_id UUID;
  v_count INTEGER;
  v_distinct_count INTEGER;
  v_applied JSONB := '[]'::JSONB;
  v_movement RECORD;
  v_picked_at TIMESTAMPTZ := COALESCE(p_picked_at, pg_catalog.clock_timestamp());
BEGIN
  IF p_member_no IS NULL OR p_member_no < 1
     OR p_picks IS NULL OR pg_catalog.jsonb_typeof(p_picks) <> 'array'
     OR pg_catalog.jsonb_array_length(p_picks) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICKS_INVALID';
  END IF;
  v_requester_membership_id := private.require_api_inventory_access(p_company_id, true);
  SELECT membership.id INTO v_target_membership_id
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.member_no = p_member_no
    AND membership.status = 'active'
  LIMIT 1;
  IF v_target_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_MEMBER_NOT_FOUND';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_picks) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_object_keys(item.value) AS key(name)
         WHERE key.name NOT IN ('partId', 'quantity', 'expectedStockEntityVersion')
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICK_FIELDS_INVALID';
  END IF;
  SELECT pg_catalog.count(*), pg_catalog.count(DISTINCT parsed."partId")
  INTO v_count, v_distinct_count
  FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
    "partId" UUID, quantity NUMERIC, "expectedStockEntityVersion" BIGINT
  );
  IF v_count <> v_distinct_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICK_DUPLICATE_PART';
  END IF;

  v_company_location_id := private.ensure_api_inventory_location(
    p_company_id, 'company'::public.inventory_location_type, NULL, v_picked_at
  );
  v_member_location_id := private.ensure_api_inventory_location(
    p_company_id, 'member'::public.inventory_location_type,
    v_target_membership_id, v_picked_at
  );
  INSERT INTO public.inventory_balances AS balance (
    location_id, part_id, quantity_on_hand, updated_at
  )
  SELECT v_company_location_id, parsed."partId", 0, v_picked_at
  FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
    "partId" UUID, quantity NUMERIC, "expectedStockEntityVersion" BIGINT
  )
  ON CONFLICT ON CONSTRAINT inventory_balances_pk DO NOTHING;

  PERFORM balance.part_id
  FROM public.inventory_balances AS balance
  WHERE balance.location_id = v_company_location_id
    AND balance.part_id IN (
      SELECT parsed."partId"
      FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
        "partId" UUID, quantity NUMERIC, "expectedStockEntityVersion" BIGINT
      )
    )
  ORDER BY balance.part_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
      "partId" UUID, quantity NUMERIC, "expectedStockEntityVersion" BIGINT
    )
    LEFT JOIN public.inventory_parts AS part
      ON part.id = parsed."partId" AND part.company_id = p_company_id
    LEFT JOIN public.inventory_balances AS balance
      ON balance.location_id = v_company_location_id AND balance.part_id = parsed."partId"
    WHERE parsed."partId" IS NULL OR parsed.quantity IS NULL OR parsed.quantity <= 0
       OR parsed.quantity > 99999999999.999
       OR parsed.quantity <> pg_catalog.round(parsed.quantity, 3)
       OR parsed."expectedStockEntityVersion" IS NULL
       OR parsed."expectedStockEntityVersion" < 1
       OR part.id IS NULL OR part.archived_at IS NOT NULL OR NOT part.active
       OR balance.entity_version <> parsed."expectedStockEntityVersion"
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
        "partId" UUID, quantity NUMERIC, "expectedStockEntityVersion" BIGINT
      )
      INNER JOIN public.inventory_balances AS balance
        ON balance.location_id = v_company_location_id AND balance.part_id = parsed."partId"
      WHERE balance.entity_version <> parsed."expectedStockEntityVersion"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'INVENTORY_STOCK_VERSION_CONFLICT';
    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICK_ITEM_INVALID';
  END IF;

  FOR v_movement IN
    SELECT movement.*
    FROM private.apply_inventory_pick_batch(
      p_company_id,
      v_company_location_id,
      v_member_location_id,
      v_requester_membership_id,
      (
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'part_id', part.id,
          'part_no', part.part_no,
          'quantity', parsed.quantity
        ) ORDER BY part.id)
        FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
          "partId" UUID, quantity NUMERIC, "expectedStockEntityVersion" BIGINT
        )
        INNER JOIN public.inventory_parts AS part
          ON part.id = parsed."partId" AND part.company_id = p_company_id
      ),
      v_picked_at
    ) AS movement
  LOOP
    v_applied := v_applied || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'movement_id', v_movement.movement_id,
      'part_id', v_movement.part_id,
      'part_no', v_movement.part_no,
      'quantity', v_movement.quantity
    ));
  END LOOP;

  RETURN QUERY
  SELECT
    applied.movement_id,
    applied.part_id,
    applied.part_no,
    applied.quantity,
    source_balance.quantity_on_hand,
    source_balance.entity_version,
    destination_balance.quantity_on_hand,
    destination_balance.entity_version
  FROM pg_catalog.jsonb_to_recordset(v_applied) AS applied(
    movement_id UUID, part_id UUID, part_no INTEGER, quantity NUMERIC
  )
  INNER JOIN public.inventory_balances AS source_balance
    ON source_balance.location_id = v_company_location_id
   AND source_balance.part_id = applied.part_id
  INNER JOIN public.inventory_balances AS destination_balance
    ON destination_balance.location_id = v_member_location_id
   AND destination_balance.part_id = applied.part_id
  ORDER BY applied.part_no;
  PERFORM private.bump_company_sync_version(p_company_id, 'company_inventory_version');
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_inventory_part(
  p_company_id UUID,
  p_payload JSONB,
  p_created_at TIMESTAMPTZ
) RETURNS TABLE (
  part_id UUID, part_no INTEGER, status TEXT, name TEXT, active BOOLEAN,
  quantity_on_hand NUMERIC, low_threshold NUMERIC, unit TEXT,
  entity_version BIGINT, stock_entity_version BIGINT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_location_id UUID;
  v_part_id UUID;
  v_part_no INTEGER;
  v_name TEXT;
  v_unit TEXT;
  v_initial_quantity NUMERIC := 0;
  v_low_threshold NUMERIC := 0;
  v_created_at TIMESTAMPTZ := COALESCE(p_created_at, pg_catalog.clock_timestamp());
BEGIN
  v_membership_id := private.require_api_inventory_access(p_company_id, true);
  IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_object_keys(p_payload) AS key(name)
       WHERE key.name NOT IN ('name', 'initialQuantity', 'lowThreshold', 'unit')
     )
     OR pg_catalog.jsonb_typeof(p_payload -> 'name') <> 'string' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_PAYLOAD_INVALID';
  END IF;
  v_name := pg_catalog.btrim(p_payload ->> 'name');
  IF v_name = '' OR pg_catalog.char_length(v_name) > 240 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_NAME_INVALID';
  END IF;
  IF p_payload ? 'initialQuantity' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'initialQuantity') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_QUANTITY_INVALID';
    END IF;
    v_initial_quantity := (p_payload ->> 'initialQuantity')::NUMERIC;
  END IF;
  IF p_payload ? 'lowThreshold' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'lowThreshold') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_THRESHOLD_INVALID';
    END IF;
    v_low_threshold := (p_payload ->> 'lowThreshold')::NUMERIC;
  END IF;
  IF v_initial_quantity < 0 OR v_initial_quantity > 99999999999.999
     OR v_initial_quantity <> pg_catalog.round(v_initial_quantity, 3) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_QUANTITY_INVALID';
  END IF;
  IF v_low_threshold < 0 OR v_low_threshold > 99999999999.999
     OR v_low_threshold <> pg_catalog.round(v_low_threshold, 3) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_THRESHOLD_INVALID';
  END IF;
  IF p_payload ? 'unit' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'unit') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_UNIT_INVALID';
    END IF;
    v_unit := NULLIF(pg_catalog.btrim(p_payload ->> 'unit'), '');
    IF v_unit IS NOT NULL AND (pg_catalog.char_length(v_unit) > 40 OR v_unit ~ '[[:cntrl:]]') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_UNIT_INVALID';
    END IF;
  END IF;

  v_part_no := private.allocate_company_counter(p_company_id, 'part_no');
  INSERT INTO public.inventory_parts AS part (
    company_id, part_no, name, active, low_threshold, unit, created_at, updated_at
  ) VALUES (
    p_company_id, v_part_no, v_name, true, v_low_threshold, v_unit, v_created_at, v_created_at
  ) RETURNING part.id INTO v_part_id;

  v_location_id := private.ensure_api_inventory_location(
    p_company_id, 'company'::public.inventory_location_type, NULL, v_created_at
  );
  INSERT INTO public.inventory_balances AS balance (
    location_id, part_id, quantity_on_hand, updated_at
  ) VALUES (v_location_id, v_part_id, 0, v_created_at);
  IF v_initial_quantity > 0 THEN
    PERFORM 1 FROM private.apply_inventory_movement(
      p_company_id, v_part_id, v_initial_quantity, NULL, v_location_id,
      'add'::public.inventory_movement_type, v_membership_id,
      NULL, NULL, 'Initial company inventory', v_created_at
    );
  END IF;
  PERFORM private.bump_company_sync_version(p_company_id, 'company_inventory_version');
  RETURN QUERY SELECT * FROM private.get_api_inventory_snapshot(
    p_company_id, v_part_id, v_location_id
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.update_api_inventory_part(
  p_company_id UUID,
  p_part_id UUID,
  p_expected_entity_version BIGINT,
  p_payload JSONB,
  p_updated_at TIMESTAMPTZ
) RETURNS TABLE (
  part_id UUID, part_no INTEGER, status TEXT, name TEXT, active BOOLEAN,
  quantity_on_hand NUMERIC, low_threshold NUMERIC, unit TEXT,
  entity_version BIGINT, stock_entity_version BIGINT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_part public.inventory_parts%ROWTYPE;
  v_location_id UUID;
  v_updated_at TIMESTAMPTZ := COALESCE(p_updated_at, pg_catalog.clock_timestamp());
  v_name TEXT;
  v_unit TEXT;
  v_threshold NUMERIC;
BEGIN
  PERFORM private.require_api_inventory_access(p_company_id, true);
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1
     OR p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
     OR p_payload = '{}'::JSONB
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_object_keys(p_payload) AS key(name)
       WHERE key.name NOT IN ('name', 'active', 'lowThreshold', 'unit')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_PAYLOAD_INVALID';
  END IF;
  SELECT part.* INTO v_part
  FROM public.inventory_parts AS part
  WHERE part.company_id = p_company_id AND part.id = p_part_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;
  IF v_part.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'INVENTORY_PART_VERSION_CONFLICT';
  END IF;
  IF v_part.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40900', MESSAGE = 'INVENTORY_PART_ARCHIVED';
  END IF;

  IF p_payload ? 'name' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'name') <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_NAME_INVALID';
    END IF;
    v_name := pg_catalog.btrim(p_payload ->> 'name');
    IF v_name = '' OR pg_catalog.char_length(v_name) > 240 OR v_name ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_NAME_INVALID';
    END IF;
  END IF;
  IF p_payload ? 'active' AND pg_catalog.jsonb_typeof(p_payload -> 'active') <> 'boolean' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_ACTIVE_INVALID';
  END IF;
  IF p_payload ? 'lowThreshold' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'lowThreshold') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_THRESHOLD_INVALID';
    END IF;
    v_threshold := (p_payload ->> 'lowThreshold')::NUMERIC;
    IF v_threshold < 0 OR v_threshold > 99999999999.999
       OR v_threshold <> pg_catalog.round(v_threshold, 3) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_THRESHOLD_INVALID';
    END IF;
  END IF;
  IF p_payload ? 'unit' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'unit') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_UNIT_INVALID';
    END IF;
    v_unit := NULLIF(pg_catalog.btrim(p_payload ->> 'unit'), '');
    IF v_unit IS NOT NULL AND (pg_catalog.char_length(v_unit) > 40 OR v_unit ~ '[[:cntrl:]]') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_UNIT_INVALID';
    END IF;
  END IF;

  UPDATE public.inventory_parts AS part
  SET name = CASE WHEN p_payload ? 'name' THEN v_name ELSE part.name END,
      active = CASE WHEN p_payload ? 'active' THEN (p_payload ->> 'active')::BOOLEAN ELSE part.active END,
      low_threshold = CASE WHEN p_payload ? 'lowThreshold' THEN v_threshold ELSE part.low_threshold END,
      unit = CASE WHEN p_payload ? 'unit' THEN v_unit ELSE part.unit END,
      updated_at = v_updated_at
  WHERE part.company_id = p_company_id AND part.id = p_part_id;

  v_location_id := private.ensure_api_inventory_location(
    p_company_id, 'company'::public.inventory_location_type, NULL, v_updated_at
  );
  PERFORM private.bump_company_sync_version(p_company_id, 'company_inventory_version');
  RETURN QUERY SELECT * FROM private.get_api_inventory_snapshot(
    p_company_id, p_part_id, v_location_id
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.archive_api_inventory_part(
  p_company_id UUID,
  p_part_id UUID,
  p_expected_entity_version BIGINT,
  p_archived_at TIMESTAMPTZ
) RETURNS TABLE (
  part_id UUID, part_no INTEGER, status TEXT, name TEXT, active BOOLEAN,
  quantity_on_hand NUMERIC, low_threshold NUMERIC, unit TEXT,
  entity_version BIGINT, stock_entity_version BIGINT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_part public.inventory_parts%ROWTYPE;
  v_location_id UUID;
  v_archived_at TIMESTAMPTZ := COALESCE(p_archived_at, pg_catalog.clock_timestamp());
BEGIN
  PERFORM private.require_api_inventory_access(p_company_id, true);
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_VERSION_INVALID';
  END IF;
  SELECT part.* INTO v_part
  FROM public.inventory_parts AS part
  WHERE part.company_id = p_company_id AND part.id = p_part_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;
  IF v_part.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'INVENTORY_PART_VERSION_CONFLICT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_balances AS balance
    INNER JOIN public.inventory_locations AS location ON location.id = balance.location_id
    WHERE location.company_id = p_company_id
      AND location.location_type IN ('company', 'member')
      AND balance.part_id = p_part_id
      AND balance.quantity_on_hand > 0
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVENTORY_STOCK_REMAINS';
  END IF;
  UPDATE public.inventory_parts AS part
  SET active = false,
      archived_at = COALESCE(part.archived_at, v_archived_at),
      updated_at = v_archived_at
  WHERE part.company_id = p_company_id AND part.id = p_part_id;
  v_location_id := private.ensure_api_inventory_location(
    p_company_id, 'company'::public.inventory_location_type, NULL, v_archived_at
  );
  PERFORM private.bump_company_sync_version(p_company_id, 'company_inventory_version');
  RETURN QUERY SELECT * FROM private.get_api_inventory_snapshot(
    p_company_id, p_part_id, v_location_id
  );
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.increment_inventory_entity_version()
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.require_api_inventory_access(UUID, BOOLEAN)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.ensure_api_inventory_location(UUID, public.inventory_location_type, UUID, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.get_api_inventory_snapshot(UUID, UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.apply_inventory_movement(UUID, UUID, NUMERIC, UUID, UUID, public.inventory_movement_type, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.apply_inventory_pick_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.create_api_inventory_part(UUID, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.update_api_inventory_part(UUID, UUID, BIGINT, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.archive_api_inventory_part(UUID, UUID, BIGINT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.adjust_api_inventory_stock(UUID, UUID, TEXT, BIGINT, NUMERIC, TEXT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.transfer_api_inventory_stock(UUID, UUID, INTEGER, TEXT, NUMERIC, BIGINT, TEXT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.pick_api_inventory_stock(UUID, INTEGER, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.apply_inventory_movement(UUID, UUID, NUMERIC, UUID, UUID, public.inventory_movement_type, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
TO service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.apply_inventory_pick_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)
TO service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.create_api_inventory_part(UUID, JSONB, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.update_api_inventory_part(UUID, UUID, BIGINT, JSONB, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.archive_api_inventory_part(UUID, UUID, BIGINT, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.adjust_api_inventory_stock(UUID, UUID, TEXT, BIGINT, NUMERIC, TEXT, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.transfer_api_inventory_stock(UUID, UUID, INTEGER, TEXT, NUMERIC, BIGINT, TEXT, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.pick_api_inventory_stock(UUID, INTEGER, JSONB, TIMESTAMPTZ)
TO smart_job_api;
