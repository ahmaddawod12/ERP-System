-- 0012_bump_sync_version.sql
-- Adds an atomic INSERT-or-increment RPC for company_sync_state version fields.
-- Replaces the non-atomic SELECT → UPDATE pattern used in backend handlers.

CREATE OR REPLACE FUNCTION bump_company_sync_version(
  p_company_id UUID,
  p_field      TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_field NOT IN (
    'jobs_version',
    'documents_version',
    'clients_version',
    'workers_version',
    'company_inventory_version'
  ) THEN
    RAISE EXCEPTION 'Invalid sync version field: %', p_field;
  END IF;

  INSERT INTO company_sync_state (
    company_id,
    jobs_version,
    documents_version,
    clients_version,
    workers_version,
    company_inventory_version,
    updated_at
  ) VALUES (
    p_company_id,
    CASE WHEN p_field = 'jobs_version'              THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'documents_version'         THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'clients_version'           THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'workers_version'           THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'company_inventory_version' THEN 1 ELSE 0 END,
    NOW()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    jobs_version = CASE WHEN p_field = 'jobs_version'
      THEN company_sync_state.jobs_version + 1
      ELSE company_sync_state.jobs_version END,
    documents_version = CASE WHEN p_field = 'documents_version'
      THEN company_sync_state.documents_version + 1
      ELSE company_sync_state.documents_version END,
    clients_version = CASE WHEN p_field = 'clients_version'
      THEN company_sync_state.clients_version + 1
      ELSE company_sync_state.clients_version END,
    workers_version = CASE WHEN p_field = 'workers_version'
      THEN company_sync_state.workers_version + 1
      ELSE company_sync_state.workers_version END,
    company_inventory_version = CASE WHEN p_field = 'company_inventory_version'
      THEN company_sync_state.company_inventory_version + 1
      ELSE company_sync_state.company_inventory_version END,
    updated_at = NOW();
END;
$$;
