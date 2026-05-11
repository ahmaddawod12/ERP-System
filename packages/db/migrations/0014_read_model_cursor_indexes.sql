CREATE INDEX IF NOT EXISTS jobs_company_created_cursor_idx
  ON jobs (company_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS jobs_company_updated_cursor_idx
  ON jobs (company_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS jobs_company_assignee_created_cursor_idx
  ON jobs (company_id, assigned_membership_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS jobs_company_assignee_updated_cursor_idx
  ON jobs (company_id, assigned_membership_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS jobs_company_status_created_cursor_idx
  ON jobs (company_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS jobs_company_status_updated_cursor_idx
  ON jobs (company_id, status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS documents_company_created_cursor_idx
  ON documents (company_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS documents_company_updated_cursor_idx
  ON documents (company_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS documents_company_document_date_cursor_idx
  ON documents (company_id, document_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS documents_company_status_created_cursor_idx
  ON documents (company_id, generation_status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS documents_company_type_created_cursor_idx
  ON documents (company_id, document_type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS documents_company_creator_created_cursor_idx
  ON documents (company_id, created_by_membership_id, created_at DESC, id DESC);
