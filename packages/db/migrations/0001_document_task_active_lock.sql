CREATE UNIQUE INDEX IF NOT EXISTS document_tasks_active_company_type_unique
  ON document_tasks (company_id, task_type, document_type)
  WHERE status IN ('pending', 'queued', 'processing');