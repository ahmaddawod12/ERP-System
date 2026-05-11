-- Phase 3 hardening: split task result URLs by task type.
-- preview_url is for preview tasks.
-- generate_url is for generate tasks.

ALTER TABLE document_tasks
ADD COLUMN IF NOT EXISTS generate_url VARCHAR(2048);
