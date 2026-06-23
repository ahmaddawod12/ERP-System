-- Phase 1: cap unbounded RPC reads
-- Updates private page RPCs so the default page size is 50 and pagination is always enforced.
-- Public wrappers remain thin SECURITY INVOKER delegations to the private implementations.

CREATE OR REPLACE FUNCTION private.get_clients_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT 50,
  p_after_client_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_search TEXT := REGEXP_REPLACE(LOWER(BTRIM(COALESCE(p_search, ''))), '[%,*().]', '', 'g');
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 10000);
  v_items JSONB := '[]'::jsonb;
  v_fetched_count INTEGER := 0;
  v_last_client_no INTEGER;
  v_last_id UUID;
  v_next_cursor TEXT := NULL;
BEGIN
  WITH candidate AS (
    SELECT
      c.id,
      c.client_no,
      c.name,
      c.email,
      c.phone,
      c.address,
      c.notes,
      c.city,
      c.vat_number,
      c.created_at,
      c.updated_at
    FROM public.clients c
    WHERE c.company_id = p_company_id
      AND (
        v_search = ''
        OR LOWER(c.name) LIKE v_search || '%'
        OR c.phone LIKE v_search || '%'
        OR LOWER(COALESCE(c.email, '')) LIKE v_search || '%'
      )
      AND (
        p_after_client_no IS NULL
        OR p_after_id IS NULL
        OR c.client_no < p_after_client_no
        OR (c.client_no = p_after_client_no AND c.id < p_after_id)
      )
    ORDER BY c.client_no DESC, c.id DESC
    LIMIT v_limit + 1
  ),
  visible AS (
    SELECT *
    FROM candidate
    ORDER BY client_no DESC, id DESC
    LIMIT v_limit
  ),
  aggregate AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'numericId', client_no,
          'name', name,
          'email', COALESCE(email, ''),
          'phone', COALESCE(phone, ''),
          'address', COALESCE(address, ''),
          'notes', COALESCE(notes, ''),
          'city', COALESCE(city, ''),
          'vatNumber', COALESCE(vat_number, ''),
          'createdAt', created_at,
          'updatedAt', updated_at
        )
        ORDER BY client_no DESC, id DESC
      ),
      '[]'::jsonb
    ) AS items
    FROM visible
  ),
  fetched AS (
    SELECT COUNT(*)::integer AS row_count FROM candidate
  ),
  last_row AS (
    SELECT client_no, id
    FROM visible
    ORDER BY client_no ASC, id ASC
    LIMIT 1
  )
  SELECT aggregate.items, fetched.row_count, last_row.client_no, last_row.id
  INTO v_items, v_fetched_count, v_last_client_no, v_last_id
  FROM aggregate
  CROSS JOIN fetched
  LEFT JOIN last_row ON TRUE;

  IF v_fetched_count > v_limit AND v_last_client_no IS NOT NULL AND v_last_id IS NOT NULL THEN
    v_next_cursor := v_last_client_no::text || '|' || v_last_id::text;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'nextCursor', v_next_cursor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_clients_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT 50,
  p_after_client_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_clients_page(p_company_id, p_page_size, p_after_client_no, p_after_id, p_search);
$$;

CREATE OR REPLACE FUNCTION private.get_company_inventory_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT 50,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_location_id UUID;
  v_next_value INTEGER := 1;
  v_search TEXT := LOWER(BTRIM(COALESCE(p_search, '')));
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 10000);
  v_parts JSONB := '[]'::jsonb;
  v_fetched_count INTEGER := 0;
  v_last_part_no INTEGER;
  v_last_id UUID;
  v_next_cursor TEXT := NULL;
BEGIN
  SELECT id
  INTO v_location_id
  FROM public.inventory_locations
  WHERE company_id = p_company_id
    AND location_type = 'company'
    AND membership_id IS NULL
  LIMIT 1;

  SELECT next_value
  INTO v_next_value
  FROM public.company_counters
  WHERE company_id = p_company_id
    AND counter_key = 'part_no'
  LIMIT 1;

  IF v_location_id IS NULL THEN
    RETURN jsonb_build_object(
      'parts', '[]'::jsonb,
      'nextId', COALESCE(v_next_value, 1),
      'lastUpdated', NOW(),
      'nextCursor', NULL
    );
  END IF;

  WITH candidate AS (
    SELECT
      p.id,
      p.part_no,
      p.name,
      p.active,
      p.low_threshold,
      p.created_at,
      COALESCE(b.quantity_on_hand, 0) AS quantity_on_hand
    FROM public.inventory_parts p
    LEFT JOIN public.inventory_balances b
      ON b.part_id = p.id
      AND b.location_id = v_location_id
    WHERE p.company_id = p_company_id
      AND p.archived_at IS NULL
      AND (
        v_search = ''
        OR LOWER(p.name) LIKE '%' || v_search || '%'
        OR p.part_no::text LIKE v_search || '%'
      )
      AND (
        p_after_part_no IS NULL
        OR p_after_id IS NULL
        OR p.part_no > p_after_part_no
        OR (p.part_no = p_after_part_no AND p.id > p_after_id)
      )
    ORDER BY p.part_no ASC, p.id ASC
    LIMIT v_limit + 1
  ),
  visible AS (
    SELECT *
    FROM candidate
    ORDER BY part_no ASC, id ASC
    LIMIT v_limit
  ),
  aggregate AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', part_no,
          'name', name,
          'active', active,
          'quantity', quantity_on_hand,
          'lowThreshold', low_threshold,
          'dateAdded', created_at
        )
        ORDER BY part_no ASC, id ASC
      ),
      '[]'::jsonb
    ) AS parts
    FROM visible
  ),
  fetched AS (
    SELECT COUNT(*)::integer AS row_count FROM candidate
  ),
  last_row AS (
    SELECT part_no, id
    FROM visible
    ORDER BY part_no DESC, id DESC
    LIMIT 1
  )
  SELECT aggregate.parts, fetched.row_count, last_row.part_no, last_row.id
  INTO v_parts, v_fetched_count, v_last_part_no, v_last_id
  FROM aggregate
  CROSS JOIN fetched
  LEFT JOIN last_row ON TRUE;

  IF v_fetched_count > v_limit AND v_last_part_no IS NOT NULL AND v_last_id IS NOT NULL THEN
    v_next_cursor := v_last_part_no::text || '|' || v_last_id::text;
  END IF;

  RETURN jsonb_build_object(
    'parts', v_parts,
    'nextId', COALESCE(v_next_value, 1),
    'lastUpdated', NOW(),
    'nextCursor', v_next_cursor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_inventory_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT 50,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_company_inventory_page(p_company_id, p_page_size, p_after_part_no, p_after_id, p_search);
$$;

CREATE OR REPLACE FUNCTION private.get_member_inventory_page(
  p_company_id UUID,
  p_target_uid TEXT,
  p_page_size INTEGER DEFAULT 50,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_location_id UUID;
  v_next_value INTEGER := 1;
  v_search TEXT := LOWER(BTRIM(COALESCE(p_search, '')));
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 10000);
  v_parts JSONB := '[]'::jsonb;
  v_fetched_count INTEGER := 0;
  v_last_part_no INTEGER;
  v_last_id UUID;
  v_next_cursor TEXT := NULL;
BEGIN
  SELECT id
  INTO v_membership_id
  FROM public.company_memberships
  WHERE company_id = p_company_id
    AND user_id = BTRIM(COALESCE(p_target_uid, ''))
    AND status = 'active'
  LIMIT 1;

  SELECT next_value
  INTO v_next_value
  FROM public.company_counters
  WHERE company_id = p_company_id
    AND counter_key = 'part_no'
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    RETURN jsonb_build_object(
      'parts', '[]'::jsonb,
      'nextId', COALESCE(v_next_value, 1),
      'lastUpdated', NOW(),
      'nextCursor', NULL
    );
  END IF;

  SELECT id
  INTO v_location_id
  FROM public.inventory_locations
  WHERE company_id = p_company_id
    AND location_type = 'member'
    AND membership_id = v_membership_id
  LIMIT 1;

  IF v_location_id IS NULL THEN
    RETURN jsonb_build_object(
      'parts', '[]'::jsonb,
      'nextId', COALESCE(v_next_value, 1),
      'lastUpdated', NOW(),
      'nextCursor', NULL
    );
  END IF;

  WITH candidate AS (
    SELECT
      p.id,
      p.part_no,
      p.name,
      p.low_threshold,
      p.created_at,
      b.quantity_on_hand
    FROM public.inventory_balances b
    INNER JOIN public.inventory_parts p
      ON p.id = b.part_id
    WHERE b.location_id = v_location_id
      AND p.company_id = p_company_id
      AND p.archived_at IS NULL
      AND (
        v_search = ''
        OR LOWER(p.name) LIKE '%' || v_search || '%'
        OR p.part_no::text LIKE v_search || '%'
      )
      AND (
        p_after_part_no IS NULL
        OR p_after_id IS NULL
        OR p.part_no > p_after_part_no
        OR (p.part_no = p_after_part_no AND p.id > p_after_id)
      )
    ORDER BY p.part_no ASC, p.id ASC
    LIMIT v_limit + 1
  ),
  visible AS (
    SELECT *
    FROM candidate
    ORDER BY part_no ASC, id ASC
    LIMIT v_limit
  ),
  aggregate AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', part_no,
          'name', name,
          'quantity', quantity_on_hand,
          'lowThreshold', low_threshold,
          'dateAdded', created_at
        )
        ORDER BY part_no ASC, id ASC
      ),
      '[]'::jsonb
    ) AS parts
    FROM visible
  ),
  fetched AS (
    SELECT COUNT(*)::integer AS row_count FROM candidate
  ),
  last_row AS (
    SELECT part_no, id
    FROM visible
    ORDER BY part_no DESC, id DESC
    LIMIT 1
  )
  SELECT aggregate.parts, fetched.row_count, last_row.part_no, last_row.id
  INTO v_parts, v_fetched_count, v_last_part_no, v_last_id
  FROM aggregate
  CROSS JOIN fetched
  LEFT JOIN last_row ON TRUE;

  IF v_fetched_count > v_limit AND v_last_part_no IS NOT NULL AND v_last_id IS NOT NULL THEN
    v_next_cursor := v_last_part_no::text || '|' || v_last_id::text;
  END IF;

  RETURN jsonb_build_object(
    'parts', v_parts,
    'nextId', COALESCE(v_next_value, 1),
    'lastUpdated', NOW(),
    'nextCursor', v_next_cursor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_member_inventory_page(
  p_company_id UUID,
  p_target_uid TEXT,
  p_page_size INTEGER DEFAULT 50,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_member_inventory_page(p_company_id, p_target_uid, p_page_size, p_after_part_no, p_after_id, p_search);
$$;
