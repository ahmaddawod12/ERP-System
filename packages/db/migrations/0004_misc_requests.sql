CREATE TABLE IF NOT EXISTS upgrade_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid TEXT,
  email VARCHAR(320),
  company_id VARCHAR(32),
  role VARCHAR(32),
  current_tier VARCHAR(32) NOT NULL,
  requested_tier VARCHAR(32) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moderated_at TIMESTAMPTZ,
  moderated_by_uid TEXT,
  moderated_by_name VARCHAR(200),
  moderation_note TEXT,
  applied_at TIMESTAMPTZ,
  applied_by_uid TEXT
);

CREATE INDEX IF NOT EXISTS upgrade_requests_created_at_idx ON upgrade_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS upgrade_requests_status_idx ON upgrade_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS contact_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(320) NOT NULL,
  company VARCHAR(140) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expire_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS contact_requests_created_at_idx ON contact_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS contact_requests_expire_at_idx ON contact_requests (expire_at);