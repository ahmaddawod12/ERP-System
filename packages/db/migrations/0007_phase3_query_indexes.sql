CREATE INDEX IF NOT EXISTS jobs_company_created_idx
  ON jobs (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS jobs_company_assignee_created_idx
  ON jobs (company_id, assigned_membership_id, created_at DESC);

CREATE INDEX IF NOT EXISTS jobs_company_status_created_idx
  ON jobs (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS jobs_company_updated_created_idx
  ON jobs (company_id, updated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS jobs_company_finished_created_idx
  ON jobs (company_id, finished_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS jobs_company_due_created_idx
  ON jobs (company_id, due_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS documents_company_status_created_idx
  ON documents (company_id, generation_status, created_at DESC);

CREATE INDEX IF NOT EXISTS documents_company_type_created_idx
  ON documents (company_id, document_type, created_at DESC);

CREATE INDEX IF NOT EXISTS documents_company_creator_created_idx
  ON documents (company_id, created_by_membership_id, created_at DESC);

CREATE INDEX IF NOT EXISTS documents_company_updated_created_idx
  ON documents (company_id, updated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS documents_company_document_date_created_idx
  ON documents (company_id, document_date DESC, created_at DESC);
