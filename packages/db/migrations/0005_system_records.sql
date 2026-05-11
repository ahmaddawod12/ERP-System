CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action VARCHAR(80) NOT NULL,
  performed_by TEXT,
  document_id VARCHAR(128),
  document_type VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_company_created_at_idx ON audit_logs (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orphaned_user_cleanup_markers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid TEXT NOT NULL,
  email VARCHAR(320),
  company_id VARCHAR(32),
  reason VARCHAR(64) NOT NULL,
  cleanup_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orphaned_user_cleanup_markers_created_at_idx ON orphaned_user_cleanup_markers (created_at DESC);