-- 0010_fixes.sql
-- Accumulated correctness fixes applied across backend, DB, and edge layers.

-- ── 1. Fix document_number / document_code immutability trigger ─────────────
-- Original trigger blocked ALL mutations including the initial 0 → real-number
-- transition needed by the tax reservation flow.
-- Fix: only enforce immutability once the value has already been assigned (> 0).
CREATE OR REPLACE FUNCTION prevent_document_number_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.document_number > 0 AND NEW.document_number IS DISTINCT FROM OLD.document_number THEN
    RAISE EXCEPTION 'document_number is immutable once assigned';
  END IF;
  IF OLD.document_number > 0 AND NEW.document_code IS DISTINCT FROM OLD.document_code THEN
    RAISE EXCEPTION 'document_code is immutable once assigned';
  END IF;
  RETURN NEW;
END;
$$;
-- Trigger binding already exists in 0008; replacing the function is sufficient.

-- ── 2. Fix document_tasks RLS: wrong column name ────────────────────────────
-- 0008 referenced non-existent column `created_by_user_id`; correct column is `user_id`.
DROP POLICY IF EXISTS document_tasks_company_read_policy ON document_tasks;
CREATE POLICY document_tasks_company_read_policy
  ON document_tasks
  FOR SELECT
  USING (app_has_company_access(company_id) OR user_id = app_auth_uid());

-- ── 3. Fix support_conversations RLS: NULL company_id guard ─────────────────
-- A conversation with no company association (pre-onboarding support) must still
-- be readable by the owning user. The previous USING clause passed NULL into
-- app_has_company_access() which always returns false for NULL.
DROP POLICY IF EXISTS support_conversations_company_read_policy ON support_conversations;
CREATE POLICY support_conversations_company_read_policy
  ON support_conversations
  FOR SELECT
  USING (company_id IS NULL OR app_has_company_access(company_id));

-- ── 4. Migrate upgrade_requests.company_id to UUID ──────────────────────────
-- 0004 declared this column as VARCHAR(32), storing a numeric public_company_id
-- string. All writes now store the internal UUID (internalCompanyId).
-- Existing rows with non-UUID values are set to NULL to avoid casting errors.
ALTER TABLE upgrade_requests
  ALTER COLUMN company_id TYPE UUID
  USING CASE
    WHEN company_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN company_id::UUID
    ELSE NULL
  END;

-- ── 5. Fix document_tasks active-lock index ──────────────────────────────────
-- 0001 index was on (company_id, task_type, document_type), which blocks two
-- different documents of the same type from being processed simultaneously.
-- Correct key is document_id so the lock is per-document.
DROP INDEX IF EXISTS document_tasks_active_company_type_unique;
CREATE UNIQUE INDEX IF NOT EXISTS document_tasks_active_company_doc_unique
  ON document_tasks (company_id, task_type, document_id)
  WHERE status IN ('pending', 'queued', 'processing');

-- ── 6. Add subject column to contact_requests ────────────────────────────────
ALTER TABLE contact_requests
  ADD COLUMN IF NOT EXISTS subject VARCHAR(500);

-- ── 7. Add part_no to counter_key enum ───────────────────────────────────────
ALTER TYPE counter_key ADD VALUE IF NOT EXISTS 'part_no';

-- ── 8. allocate_company_counter RPC ─────────────────────────────────────────
-- Atomically reserves the next value for a per-company sequential counter.
-- Returns the allocated value (i.e. next_value BEFORE increment).
-- On first use for a key, starts at 1 and returns 1.
CREATE OR REPLACE FUNCTION allocate_company_counter(
  p_company_id  UUID,
  p_counter_key TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allocated INTEGER;
BEGIN
  INSERT INTO company_counters (company_id, counter_key, next_value, updated_at)
    VALUES (p_company_id, p_counter_key::counter_key, 2, NOW())
  ON CONFLICT (company_id, counter_key) DO UPDATE
    SET next_value = company_counters.next_value + 1,
        updated_at = NOW()
  RETURNING next_value - 1 INTO v_allocated;

  RETURN v_allocated;
END;
$$;

-- ── 9. allocate_system_counter RPC ───────────────────────────────────────────
-- Atomically reserves the next value for a system-wide sequential counter.
-- Returns the allocated value.  p_start_at controls the seed for first use.
CREATE OR REPLACE FUNCTION allocate_system_counter(
  p_counter_key TEXT,
  p_start_at    INTEGER DEFAULT 1
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allocated INTEGER;
BEGIN
  INSERT INTO system_counters (counter_key, next_value, updated_at)
    VALUES (p_counter_key, p_start_at + 1, NOW())
  ON CONFLICT (counter_key) DO UPDATE
    SET next_value = system_counters.next_value + 1,
        updated_at = NOW()
  RETURNING next_value - 1 INTO v_allocated;

  RETURN v_allocated;
END;
$$;

-- ── 10. increment_rate_limit_bucket RPC ──────────────────────────────────────
-- Atomically upserts a rate-limit bucket and returns the new hit_count.
-- Called by the edge-function rate-limit helper for each incoming request.
CREATE OR REPLACE FUNCTION increment_rate_limit_bucket(
  p_bucket_key        VARCHAR(160),
  p_hashed_key        VARCHAR(160),
  p_window_started_at TIMESTAMPTZ,
  p_expire_at         TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit_count INTEGER;
BEGIN
  INSERT INTO rate_limit_buckets
    (bucket_key, hashed_key, window_started_at, hit_count, expire_at, updated_at)
  VALUES
    (p_bucket_key, p_hashed_key, p_window_started_at, 1, p_expire_at, NOW())
  ON CONFLICT (bucket_key) DO UPDATE
    SET hit_count  = rate_limit_buckets.hit_count + 1,
        updated_at = NOW()
  RETURNING hit_count INTO v_hit_count;

  RETURN v_hit_count;
END;
$$;
