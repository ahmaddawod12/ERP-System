CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE account_type AS ENUM ('solo', 'business');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE workspace_status AS ENUM ('active', 'disabled', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE subscription_tier AS ENUM ('Basic', 'Solo', 'Team', 'Enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('active', 'trial', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE membership_role AS ENUM ('manager', 'worker', 'user', 'basic');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE membership_status AS ENUM ('active', 'disabled', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE system_role AS ENUM ('dev');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE counter_key AS ENUM ('member_no', 'client_no', 'job_no', 'doc_10', 'doc_200', 'doc_210', 'doc_305', 'doc_330', 'doc_400');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE client_status AS ENUM ('active', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('pending', 'waiting', 'finished', 'denied');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE document_generation_status AS ENUM ('pending', 'queued', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE tax_authority_status AS ENUM ('none', 'reserved', 'approved', 'rejected', 'failed', 'burned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE job_attachment_kind AS ENUM ('photo', 'signature');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE inventory_location_type AS ENUM ('company', 'member', 'consumed', 'adjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE inventory_movement_type AS ENUM ('add', 'adjust', 'pick', 'return', 'job_consumption', 'manual_replace');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE invite_status AS ENUM ('active', 'used', 'expired', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE tax_invoice_reservation_status AS ENUM ('reserved', 'approved', 'generated', 'failed', 'burned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE idempotency_status AS ENUM ('in_progress', 'approved', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE document_task_type AS ENUM ('preview', 'generate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE support_conversation_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE support_sender_type AS ENUM ('user', 'dev');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE notification_delivery_status AS ENUM ('claimed', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE archive_run_status AS ENUM ('pending', 'uploaded_not_deleted', 'deleted', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS system_counters (
  counter_key VARCHAR(64) PRIMARY KEY,
  next_value INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  display_name VARCHAR(200),
  phone_number VARCHAR(40),
  system_role system_role,
  push_token VARCHAR(500),
  push_token_platform VARCHAR(32),
  push_token_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique ON app_users (email);

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_company_id BIGINT NOT NULL,
  account_type account_type NOT NULL,
  status workspace_status NOT NULL DEFAULT 'active',
  created_by_user_id TEXT REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_public_company_id_unique ON companies (public_company_id);

CREATE TABLE IF NOT EXISTS company_profiles (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  he_name VARCHAR(200),
  en_name VARCHAR(200),
  vat_number VARCHAR(32),
  business_type VARCHAR(120),
  city VARCHAR(120),
  address VARCHAR(500),
  business_email VARCHAR(320),
  business_phone VARCHAR(40),
  business_fax VARCHAR(40),
  accountant_name VARCHAR(200),
  accountant_email VARCHAR(320),
  accountant_phone VARCHAR(40),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registered_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_profiles_vat_number_unique ON company_profiles (vat_number);

CREATE TABLE IF NOT EXISTS company_subscriptions (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  tier subscription_tier NOT NULL,
  status subscription_status NOT NULL DEFAULT 'active',
  enabled_modules JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  member_no INTEGER NOT NULL,
  role membership_role NOT NULL,
  status membership_status NOT NULL DEFAULT 'active',
  display_name VARCHAR(200),
  phone_number VARCHAR(40),
  invited_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_memberships_company_user_unique ON company_memberships (company_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS company_memberships_company_member_no_unique ON company_memberships (company_id, member_no);
CREATE INDEX IF NOT EXISTS company_memberships_company_role_idx ON company_memberships (company_id, role, status);

CREATE TABLE IF NOT EXISTS company_counters (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  counter_key counter_key NOT NULL,
  next_value INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_counters_pk PRIMARY KEY (company_id, counter_key)
);

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_no INTEGER NOT NULL,
  status client_status NOT NULL DEFAULT 'active',
  name VARCHAR(240) NOT NULL,
  phone VARCHAR(40),
  email VARCHAR(320),
  address VARCHAR(500),
  city VARCHAR(120),
  vat_number VARCHAR(32),
  notes TEXT,
  created_by_membership_id UUID REFERENCES company_memberships(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS clients_company_client_no_unique ON clients (company_id, client_no);
CREATE INDEX IF NOT EXISTS clients_company_name_idx ON clients (company_id, name);
CREATE INDEX IF NOT EXISTS clients_company_phone_idx ON clients (company_id, phone);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_no INTEGER NOT NULL,
  status job_status NOT NULL,
  title VARCHAR(240),
  description TEXT,
  notes TEXT,
  location VARCHAR(240),
  address VARCHAR(500),
  category VARCHAR(120),
  priority VARCHAR(40),
  due_at TIMESTAMPTZ,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  assigned_membership_id UUID REFERENCES company_memberships(id) ON DELETE SET NULL,
  created_by_membership_id UUID REFERENCES company_memberships(id) ON DELETE SET NULL,
  accepted_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ,
  denied_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  is_cert BOOLEAN NOT NULL DEFAULT FALSE,
  idempotency_key VARCHAR(128),
  client_name_snapshot VARCHAR(240),
  client_phone_snapshot VARCHAR(40),
  assigned_member_name_snapshot VARCHAR(200),
  created_by_name_snapshot VARCHAR(200),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_company_job_no_unique ON jobs (company_id, job_no);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_company_idempotency_unique ON jobs (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_company_status_updated_idx ON jobs (company_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS jobs_company_assignee_status_updated_idx ON jobs (company_id, assigned_membership_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS job_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  storage_path VARCHAR(1024) NOT NULL,
  kind job_attachment_kind NOT NULL,
  uploaded_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS job_attachments_storage_path_unique ON job_attachments (storage_path);
CREATE INDEX IF NOT EXISTS job_attachments_job_kind_idx ON job_attachments (job_id, kind);

CREATE TABLE IF NOT EXISTS job_part_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  inventory_part_id UUID,
  part_name_snapshot VARCHAR(240),
  quantity NUMERIC(14, 3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS job_part_usages_job_idx ON job_part_usages (job_id);

CREATE TABLE IF NOT EXISTS inventory_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_type inventory_location_type NOT NULL,
  membership_id UUID REFERENCES company_memberships(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_company_location_unique ON inventory_locations (company_id, location_type, membership_id);

CREATE TABLE IF NOT EXISTS inventory_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  part_no INTEGER NOT NULL,
  name VARCHAR(240) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  low_threshold NUMERIC(14, 3) NOT NULL DEFAULT 0,
  unit VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_parts_company_part_no_unique ON inventory_parts (company_id, part_no);
CREATE INDEX IF NOT EXISTS inventory_parts_company_active_idx ON inventory_parts (company_id, active);

CREATE TABLE IF NOT EXISTS inventory_balances (
  location_id UUID NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  part_id UUID NOT NULL REFERENCES inventory_parts(id) ON DELETE CASCADE,
  quantity_on_hand NUMERIC(14, 3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_balances_pk PRIMARY KEY (location_id, part_id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  part_id UUID NOT NULL REFERENCES inventory_parts(id) ON DELETE RESTRICT,
  quantity NUMERIC(14, 3) NOT NULL,
  from_location_id UUID REFERENCES inventory_locations(id) ON DELETE SET NULL,
  to_location_id UUID REFERENCES inventory_locations(id) ON DELETE SET NULL,
  movement_type inventory_movement_type NOT NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  document_id UUID,
  created_by_membership_id UUID REFERENCES company_memberships(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(128),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_company_idempotency_unique ON inventory_movements (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_movements_company_part_created_idx ON inventory_movements (company_id, part_id, created_at DESC);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_type SMALLINT NOT NULL,
  document_number INTEGER NOT NULL,
  document_code VARCHAR(64) NOT NULL,
  generation_status document_generation_status NOT NULL DEFAULT 'pending',
  tax_authority_status tax_authority_status NOT NULL DEFAULT 'none',
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  created_by_membership_id UUID REFERENCES company_memberships(id) ON DELETE SET NULL,
  source_price_proposal_id UUID,
  storage_path VARCHAR(1024),
  language VARCHAR(8),
  document_date TIMESTAMPTZ,
  notes TEXT,
  total_before_vat NUMERIC(14, 2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_with_vat NUMERIC(14, 2) NOT NULL DEFAULT 0,
  confirmation_number VARCHAR(128),
  tax_authority_response JSONB,
  email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  company_name_snapshot VARCHAR(240),
  company_vat_snapshot VARCHAR(32),
  company_address_snapshot VARCHAR(500),
  client_name_snapshot VARCHAR(240),
  client_phone_snapshot VARCHAR(40),
  client_city_snapshot VARCHAR(120),
  client_vat_snapshot VARCHAR(32),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS documents_company_type_number_unique ON documents (company_id, document_type, document_number);
CREATE UNIQUE INDEX IF NOT EXISTS documents_company_code_unique ON documents (company_id, document_code);
CREATE INDEX IF NOT EXISTS documents_company_created_idx ON documents (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS document_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  description VARCHAR(240) NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL,
  unit_price NUMERIC(14, 2) NOT NULL,
  line_total NUMERIC(14, 2) NOT NULL,
  source_inventory_part_id UUID REFERENCES inventory_parts(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS document_items_document_line_no_unique ON document_items (document_id, line_no);

CREATE TABLE IF NOT EXISTS document_job_links (
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_job_links_pk PRIMARY KEY (document_id, job_id)
);

CREATE TABLE IF NOT EXISTS proposal_usage (
  proposal_document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  consumer_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  used_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code VARCHAR(80) NOT NULL,
  target_role membership_role NOT NULL,
  status invite_status NOT NULL DEFAULT 'active',
  invited_email VARCHAR(320),
  created_by_membership_id UUID REFERENCES company_memberships(id) ON DELETE SET NULL,
  used_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_invites_code_unique ON company_invites (code);
CREATE INDEX IF NOT EXISTS company_invites_company_status_expires_idx ON company_invites (company_id, status, expires_at);

CREATE TABLE IF NOT EXISTS tax_invoice_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_number INTEGER NOT NULL,
  status tax_invoice_reservation_status NOT NULL DEFAULT 'reserved',
  reserved_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  client_name_snapshot VARCHAR(240),
  external_confirmation_number VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_invoice_reservations_document_unique ON tax_invoice_reservations (document_id);
CREATE UNIQUE INDEX IF NOT EXISTS tax_invoice_reservations_company_number_unique ON tax_invoice_reservations (company_id, document_number);

CREATE TABLE IF NOT EXISTS tax_invoice_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  idempotency_hash VARCHAR(128) NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status idempotency_status NOT NULL,
  reservation_id UUID REFERENCES tax_invoice_reservations(id) ON DELETE SET NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  request_hash VARCHAR(128),
  result_payload JSONB,
  locked_at TIMESTAMPTZ,
  expire_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_invoice_idempotency_company_key_unique ON tax_invoice_idempotency (company_id, idempotency_hash);

CREATE TABLE IF NOT EXISTS document_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key VARCHAR(160) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  task_type document_task_type NOT NULL,
  document_type SMALLINT NOT NULL,
  status document_generation_status NOT NULL DEFAULT 'pending',
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  preview_url VARCHAR(2048),
  storage_path VARCHAR(1024),
  pdf_size INTEGER,
  error TEXT,
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expire_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS document_tasks_task_key_unique ON document_tasks (task_key);
CREATE INDEX IF NOT EXISTS document_tasks_user_status_idx ON document_tasks (user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS tax_authority_tokens (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  authorized_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tax_oauth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  state VARCHAR(512) NOT NULL,
  state_nonce VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_oauth_sessions_state_unique ON tax_oauth_sessions (state);

CREATE TABLE IF NOT EXISTS tax_oauth_callbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oauth_session_id UUID NOT NULL REFERENCES tax_oauth_sessions(id) ON DELETE CASCADE,
  code_hash VARCHAR(128) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used BOOLEAN NOT NULL DEFAULT FALSE,
  token_exchange_success BOOLEAN,
  token_exchange_error TEXT,
  token_exchange_attempted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  category VARCHAR(64) NOT NULL DEFAULT 'general',
  status support_conversation_status NOT NULL DEFAULT 'open',
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unread_for_user_count INTEGER NOT NULL DEFAULT 0,
  unread_for_dev_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS support_conversations_user_status_idx ON support_conversations (user_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_conversations_status_queue_idx ON support_conversations (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  sender_type support_sender_type NOT NULL,
  sender_name_snapshot VARCHAR(200),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS support_messages_conversation_created_idx ON support_messages (conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  related_entity_type VARCHAR(40) NOT NULL,
  related_entity_id VARCHAR(128) NOT NULL,
  delivery_type VARCHAR(40) NOT NULL,
  recipient_user_id TEXT REFERENCES app_users(id) ON DELETE CASCADE,
  dedup_key VARCHAR(160) NOT NULL,
  status notification_delivery_status NOT NULL DEFAULT 'claimed',
  provider_message_id VARCHAR(160),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  expire_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_dedup_key_unique ON notification_deliveries (dedup_key);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key VARCHAR(160) PRIMARY KEY,
  hashed_key VARCHAR(160) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  expire_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_expire_at_idx ON rate_limit_buckets (expire_at);

CREATE TABLE IF NOT EXISTS archive_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  archive_key VARCHAR(32) NOT NULL,
  data_type VARCHAR(32) NOT NULL,
  status archive_run_status NOT NULL DEFAULT 'pending',
  doc_count INTEGER NOT NULL DEFAULT 0,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  storage_path VARCHAR(1024),
  checksum VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS archive_runs_company_archive_type_unique ON archive_runs (company_id, archive_key, data_type);