-- Extend the canonical private company-file bucket to generated documents.
-- The bucket remains private and create-only behavior is enforced by the
-- trusted PDF worker rather than by granting client overwrite policies.

INSERT INTO storage.buckets AS bucket (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) VALUES (
  'smart-job-company-files',
  'smart-job-company-files',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types,
    updated_at = pg_catalog.clock_timestamp()
WHERE bucket.name IS DISTINCT FROM EXCLUDED.name
   OR bucket.public IS DISTINCT FROM false
   OR bucket.file_size_limit IS DISTINCT FROM EXCLUDED.file_size_limit
   OR bucket.allowed_mime_types IS DISTINCT FROM EXCLUDED.allowed_mime_types;
