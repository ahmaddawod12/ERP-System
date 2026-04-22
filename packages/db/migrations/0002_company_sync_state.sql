CREATE TABLE IF NOT EXISTS company_sync_state (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  jobs_version INTEGER NOT NULL DEFAULT 0,
  documents_version INTEGER NOT NULL DEFAULT 0,
  clients_version INTEGER NOT NULL DEFAULT 0,
  workers_version INTEGER NOT NULL DEFAULT 0,
  company_inventory_version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);