-- Smart-Job ERP consolidated development baseline.
--
-- This pre-production squash preserves the exact ordered SQL from migrations
-- 0000 through 0035, including the working-tree fixes that existed in 0033
-- and 0034 when the baseline was created. Reset development databases before
-- applying this baseline; never apply it over a partially migrated database.
-- ============================================================================
-- Consolidated source: 0000_optimized_baseline.sql
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE account_type AS ENUM ('solo', 'business');
CREATE TYPE workspace_status AS ENUM ('active', 'disabled', 'archived');
CREATE TYPE subscription_tier AS ENUM ('Basic', 'Solo', 'Team', 'Enterprise');
CREATE TYPE subscription_status AS ENUM ('active', 'trial', 'expired');
CREATE TYPE membership_role AS ENUM ('manager', 'worker', 'user', 'basic');
CREATE TYPE membership_status AS ENUM ('active', 'disabled', 'pending');
CREATE TYPE system_role AS ENUM ('dev');
CREATE TYPE counter_key AS ENUM (
  'member_no',
  'client_no',
  'job_no',
  'part_no',
  'doc_10',
  'doc_200',
  'doc_210',
  'doc_305',
  'doc_330',
  'doc_400'
);
CREATE TYPE client_status AS ENUM ('active', 'archived');
CREATE TYPE job_status AS ENUM ('pending', 'waiting', 'finished', 'denied');
CREATE TYPE document_generation_status AS ENUM ('pending', 'queued', 'processing', 'completed', 'failed');
CREATE TYPE tax_authority_status AS ENUM ('none', 'reserved', 'approved', 'rejected', 'failed', 'burned');
CREATE TYPE job_attachment_kind AS ENUM ('photo', 'signature');
CREATE TYPE inventory_location_type AS ENUM ('company', 'member', 'consumed', 'adjustment');
CREATE TYPE inventory_movement_type AS ENUM ('add', 'adjust', 'pick', 'return', 'job_consumption', 'manual_replace');
CREATE TYPE invite_status AS ENUM ('active', 'used', 'expired', 'revoked');
CREATE TYPE tax_invoice_reservation_status AS ENUM (
  'reserved',
  'approved',
  'generated',
  'failed',
  'burned',
  'rejected',
  'validation_failed',
  'submission_failed',
  'approval_received_needs_reconcile'
);
CREATE TYPE idempotency_status AS ENUM ('in_progress', 'approved', 'failed');
CREATE TYPE document_task_type AS ENUM ('preview', 'generate');
CREATE TYPE support_conversation_status AS ENUM ('open', 'closed');
CREATE TYPE support_sender_type AS ENUM ('user', 'dev');
CREATE TYPE notification_delivery_status AS ENUM ('claimed', 'sent', 'failed');
CREATE TYPE archive_run_status AS ENUM ('pending', 'uploaded_not_deleted', 'deleted', 'failed');

CREATE TABLE system_counters (
  counter_key VARCHAR(64) PRIMARY KEY,
  next_value INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_users (
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
CREATE UNIQUE INDEX app_users_email_unique ON app_users (email);

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_company_id BIGINT NOT NULL,
  account_type account_type NOT NULL,
  status workspace_status NOT NULL DEFAULT 'active',
  created_by_user_id TEXT REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX companies_public_company_id_unique ON companies (public_company_id);

CREATE TABLE company_profiles (
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
CREATE UNIQUE INDEX company_profiles_vat_number_unique ON company_profiles (vat_number);

CREATE TABLE company_subscriptions (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  tier subscription_tier NOT NULL,
  status subscription_status NOT NULL DEFAULT 'active',
  enabled_modules JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE company_sync_state (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  jobs_version INTEGER NOT NULL DEFAULT 0,
  documents_version INTEGER NOT NULL DEFAULT 0,
  clients_version INTEGER NOT NULL DEFAULT 0,
  workers_version INTEGER NOT NULL DEFAULT 0,
  company_inventory_version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE company_memberships (
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
CREATE UNIQUE INDEX company_memberships_company_user_active_unique
  ON company_memberships (company_id, user_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX company_memberships_company_member_no_unique ON company_memberships (company_id, member_no);
CREATE INDEX company_memberships_company_role_idx ON company_memberships (company_id, role, status);
CREATE INDEX company_memberships_user_active_joined_idx ON company_memberships (user_id, status, joined_at ASC, created_at ASC);

CREATE TABLE company_counters (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  counter_key counter_key NOT NULL,
  next_value INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_counters_pk PRIMARY KEY (company_id, counter_key)
);

CREATE TABLE clients (
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
CREATE UNIQUE INDEX clients_company_client_no_unique ON clients (company_id, client_no);
CREATE INDEX clients_company_name_idx ON clients (company_id, name);
CREATE INDEX clients_company_phone_idx ON clients (company_id, phone);
CREATE INDEX clients_company_email_idx ON clients (company_id, email);
CREATE INDEX clients_company_client_no_cursor_idx ON clients (company_id, client_no DESC, id DESC);
CREATE INDEX clients_company_lower_name_idx ON clients (company_id, lower(name) text_pattern_ops);

CREATE TABLE jobs (
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
CREATE UNIQUE INDEX jobs_company_job_no_unique ON jobs (company_id, job_no);
CREATE UNIQUE INDEX jobs_company_idempotency_unique ON jobs (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX jobs_company_created_idx ON jobs (company_id, created_at DESC);
CREATE INDEX jobs_company_assignee_created_idx ON jobs (company_id, assigned_membership_id, created_at DESC);
CREATE INDEX jobs_company_status_created_idx ON jobs (company_id, status, created_at DESC);
CREATE INDEX jobs_company_updated_created_idx ON jobs (company_id, updated_at DESC, created_at DESC);
CREATE INDEX jobs_company_finished_created_idx ON jobs (company_id, finished_at DESC, created_at DESC);
CREATE INDEX jobs_company_due_created_idx ON jobs (company_id, due_at DESC, created_at DESC);
CREATE INDEX jobs_company_status_updated_idx ON jobs (company_id, status, updated_at DESC);
CREATE INDEX jobs_company_assignee_status_updated_idx ON jobs (company_id, assigned_membership_id, status, updated_at DESC);
CREATE INDEX jobs_company_created_cursor_idx ON jobs (company_id, created_at DESC, id DESC);
CREATE INDEX jobs_company_updated_cursor_idx ON jobs (company_id, updated_at DESC, id DESC);
CREATE INDEX jobs_company_assignee_created_cursor_idx ON jobs (company_id, assigned_membership_id, created_at DESC, id DESC);
CREATE INDEX jobs_company_assignee_updated_cursor_idx ON jobs (company_id, assigned_membership_id, updated_at DESC, id DESC);
CREATE INDEX jobs_company_status_created_cursor_idx ON jobs (company_id, status, created_at DESC, id DESC);
CREATE INDEX jobs_company_status_updated_cursor_idx ON jobs (company_id, status, updated_at DESC, id DESC);
CREATE INDEX jobs_company_finished_cursor_idx ON jobs (company_id, finished_at DESC, id DESC) WHERE finished_at IS NOT NULL;
CREATE INDEX jobs_company_assignee_finished_cursor_idx ON jobs (company_id, assigned_membership_id, finished_at DESC, id DESC) WHERE finished_at IS NOT NULL;
CREATE INDEX jobs_company_assignee_due_cursor_idx ON jobs (company_id, assigned_membership_id, due_at DESC, id DESC) WHERE due_at IS NOT NULL;
CREATE INDEX jobs_company_assignee_status_finished_cursor_idx ON jobs (company_id, assigned_membership_id, status, finished_at DESC, id DESC) WHERE finished_at IS NOT NULL;

CREATE TABLE job_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  storage_path VARCHAR(1024) NOT NULL,
  kind job_attachment_kind NOT NULL,
  uploaded_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX job_attachments_storage_path_unique ON job_attachments (storage_path);
CREATE INDEX job_attachments_job_kind_idx ON job_attachments (job_id, kind);

CREATE TABLE job_part_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  inventory_part_id UUID,
  part_name_snapshot VARCHAR(240),
  quantity NUMERIC(14, 3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_part_usages_quantity_non_negative_check CHECK (quantity >= 0)
);
CREATE INDEX job_part_usages_job_idx ON job_part_usages (job_id);

CREATE TABLE inventory_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_type inventory_location_type NOT NULL,
  membership_id UUID REFERENCES company_memberships(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX inventory_locations_company_null_membership_unique
  ON inventory_locations (company_id, location_type)
  WHERE membership_id IS NULL;
CREATE UNIQUE INDEX inventory_locations_company_membership_unique
  ON inventory_locations (company_id, location_type, membership_id)
  WHERE membership_id IS NOT NULL;

CREATE TABLE inventory_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  part_no INTEGER NOT NULL,
  name VARCHAR(240) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  low_threshold NUMERIC(14, 3) NOT NULL DEFAULT 0,
  unit VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT inventory_parts_low_threshold_non_negative_check CHECK (low_threshold >= 0)
);
CREATE UNIQUE INDEX inventory_parts_company_part_no_unique ON inventory_parts (company_id, part_no);
CREATE INDEX inventory_parts_company_active_idx ON inventory_parts (company_id, active);
CREATE INDEX inventory_parts_company_archived_part_no_idx ON inventory_parts (company_id, archived_at, part_no);
CREATE INDEX inventory_parts_company_active_archived_part_no_idx ON inventory_parts (company_id, active, archived_at, part_no);

CREATE TABLE inventory_balances (
  location_id UUID NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  part_id UUID NOT NULL REFERENCES inventory_parts(id) ON DELETE CASCADE,
  quantity_on_hand NUMERIC(14, 3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_balances_pk PRIMARY KEY (location_id, part_id),
  CONSTRAINT inventory_balances_quantity_on_hand_non_negative_check CHECK (quantity_on_hand >= 0)
);

CREATE TABLE inventory_movements (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_movements_quantity_positive_check CHECK (quantity > 0)
);
CREATE UNIQUE INDEX inventory_movements_company_idempotency_unique ON inventory_movements (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX inventory_movements_company_part_created_idx ON inventory_movements (company_id, part_id, created_at DESC);

CREATE TABLE documents (
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT documents_total_before_vat_non_negative_check CHECK (total_before_vat >= 0),
  CONSTRAINT documents_vat_amount_non_negative_check CHECK (vat_amount >= 0),
  CONSTRAINT documents_total_with_vat_non_negative_check CHECK (total_with_vat >= 0),
  CONSTRAINT documents_total_consistency_check CHECK (total_before_vat + vat_amount = total_with_vat)
);
CREATE UNIQUE INDEX documents_company_type_number_unique ON documents (company_id, document_type, document_number);
CREATE UNIQUE INDEX documents_company_code_unique ON documents (company_id, document_code);
CREATE INDEX documents_company_created_idx ON documents (company_id, created_at DESC);
CREATE INDEX documents_company_status_created_idx ON documents (company_id, generation_status, created_at DESC);
CREATE INDEX documents_company_type_created_idx ON documents (company_id, document_type, created_at DESC);
CREATE INDEX documents_company_creator_created_idx ON documents (company_id, created_by_membership_id, created_at DESC);
CREATE INDEX documents_company_updated_created_idx ON documents (company_id, updated_at DESC, created_at DESC);
CREATE INDEX documents_company_document_date_created_idx ON documents (company_id, document_date DESC, created_at DESC);
CREATE INDEX documents_company_created_cursor_idx ON documents (company_id, created_at DESC, id DESC);
CREATE INDEX documents_company_updated_cursor_idx ON documents (company_id, updated_at DESC, id DESC);
CREATE INDEX documents_company_document_date_cursor_idx ON documents (company_id, document_date DESC, id DESC);
CREATE INDEX documents_company_status_created_cursor_idx ON documents (company_id, generation_status, created_at DESC, id DESC);
CREATE INDEX documents_company_type_created_cursor_idx ON documents (company_id, document_type, created_at DESC, id DESC);
CREATE INDEX documents_company_creator_created_cursor_idx ON documents (company_id, created_by_membership_id, created_at DESC, id DESC);
CREATE INDEX documents_company_status_document_date_cursor_idx ON documents (company_id, generation_status, document_date DESC, id DESC) WHERE document_date IS NOT NULL;
CREATE INDEX documents_company_type_document_date_cursor_idx ON documents (company_id, document_type, document_date DESC, id DESC) WHERE document_date IS NOT NULL;
CREATE INDEX documents_company_creator_document_date_cursor_idx ON documents (company_id, created_by_membership_id, document_date DESC, id DESC) WHERE document_date IS NOT NULL;
CREATE INDEX documents_company_type_status_document_date_cursor_idx ON documents (company_id, document_type, generation_status, document_date DESC, id DESC) WHERE document_date IS NOT NULL;

CREATE TABLE document_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  description VARCHAR(240) NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL,
  unit_price NUMERIC(14, 2) NOT NULL,
  line_total NUMERIC(14, 2) NOT NULL,
  source_inventory_part_id UUID REFERENCES inventory_parts(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT document_items_quantity_positive_check CHECK (quantity > 0),
  CONSTRAINT document_items_unit_price_non_negative_check CHECK (unit_price >= 0),
  CONSTRAINT document_items_line_total_non_negative_check CHECK (line_total >= 0)
);
CREATE UNIQUE INDEX document_items_document_line_no_unique ON document_items (document_id, line_no);

CREATE TABLE document_job_links (
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_job_links_pk PRIMARY KEY (document_id, job_id)
);

CREATE TABLE proposal_usage (
  proposal_document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  consumer_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  used_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE company_invites (
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
CREATE UNIQUE INDEX company_invites_code_unique ON company_invites (code);
CREATE INDEX company_invites_company_status_expires_idx ON company_invites (company_id, status, expires_at);

CREATE TABLE tax_invoice_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_number INTEGER NOT NULL,
  status tax_invoice_reservation_status NOT NULL DEFAULT 'reserved',
  reserved_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  client_name_snapshot VARCHAR(240),
  external_confirmation_number VARCHAR(128),
  status_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX tax_invoice_reservations_document_unique ON tax_invoice_reservations (document_id);
CREATE UNIQUE INDEX tax_invoice_reservations_company_number_unique ON tax_invoice_reservations (company_id, document_number);
CREATE INDEX tax_invoice_reservations_company_status_created_idx ON tax_invoice_reservations (company_id, status, created_at DESC);

CREATE TABLE tax_invoice_idempotency (
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
CREATE UNIQUE INDEX tax_invoice_idempotency_company_key_unique ON tax_invoice_idempotency (company_id, idempotency_hash);

CREATE TABLE document_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key VARCHAR(160) NOT NULL,
  lock_key VARCHAR(220) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  task_type document_task_type NOT NULL,
  document_type SMALLINT NOT NULL,
  status document_generation_status NOT NULL DEFAULT 'pending',
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  preview_url VARCHAR(2048),
  generate_url VARCHAR(2048),
  storage_path VARCHAR(1024),
  pdf_size INTEGER,
  error TEXT,
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expire_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX document_tasks_task_key_unique ON document_tasks (task_key);
CREATE UNIQUE INDEX document_tasks_active_company_lock_unique
  ON document_tasks (company_id, task_type, lock_key)
  WHERE status IN ('pending', 'queued', 'processing');
CREATE INDEX document_tasks_user_status_idx ON document_tasks (user_id, status, created_at DESC);

CREATE TABLE tax_authority_tokens (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  authorized_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tax_oauth_sessions (
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
CREATE UNIQUE INDEX tax_oauth_sessions_state_unique ON tax_oauth_sessions (state);

CREATE TABLE tax_oauth_callbacks (
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
CREATE INDEX tax_oauth_callbacks_session_created_idx ON tax_oauth_callbacks (oauth_session_id, created_at DESC);

CREATE TABLE support_conversations (
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
CREATE INDEX support_conversations_user_status_idx ON support_conversations (user_id, status, last_message_at DESC);
CREATE INDEX support_conversations_status_queue_idx ON support_conversations (status, last_message_at DESC);
CREATE INDEX support_conversations_last_message_idx ON support_conversations (last_message_at DESC);

CREATE TABLE support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  sender_type support_sender_type NOT NULL,
  sender_name_snapshot VARCHAR(200),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX support_messages_conversation_created_idx ON support_messages (conversation_id, created_at ASC);

CREATE TABLE notification_deliveries (
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
CREATE UNIQUE INDEX notification_deliveries_dedup_key_unique ON notification_deliveries (dedup_key);

CREATE TABLE rate_limit_buckets (
  bucket_key VARCHAR(160) PRIMARY KEY,
  hashed_key VARCHAR(160) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  expire_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX rate_limit_buckets_expire_at_idx ON rate_limit_buckets (expire_at);

CREATE TABLE upgrade_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid TEXT,
  email VARCHAR(320),
  company_id UUID,
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
CREATE INDEX upgrade_requests_created_at_idx ON upgrade_requests (created_at DESC);
CREATE INDEX upgrade_requests_status_idx ON upgrade_requests (status, created_at DESC);

CREATE TABLE contact_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(320) NOT NULL,
  company VARCHAR(140) NOT NULL,
  subject VARCHAR(500),
  message TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expire_at TIMESTAMPTZ
);
CREATE INDEX contact_requests_created_at_idx ON contact_requests (created_at DESC);
CREATE INDEX contact_requests_expire_at_idx ON contact_requests (expire_at);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action VARCHAR(80) NOT NULL,
  performed_by TEXT,
  document_id VARCHAR(128),
  document_type VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_logs_company_created_at_idx ON audit_logs (company_id, created_at DESC);

CREATE TABLE orphaned_user_cleanup_markers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid TEXT NOT NULL,
  email VARCHAR(320),
  company_id VARCHAR(32),
  reason VARCHAR(64) NOT NULL,
  cleanup_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX orphaned_user_cleanup_markers_created_at_idx ON orphaned_user_cleanup_markers (created_at DESC);

CREATE TABLE archive_runs (
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
CREATE UNIQUE INDEX archive_runs_company_archive_type_unique ON archive_runs (company_id, archive_key, data_type);

CREATE OR REPLACE FUNCTION app_auth_uid()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '');
$$;

CREATE OR REPLACE FUNCTION app_is_dev()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app_users u
    WHERE u.id = app_auth_uid()
      AND COALESCE(u.system_role::text, '') = 'dev'
  );
$$;

CREATE OR REPLACE FUNCTION app_has_company_access(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM company_memberships m
    WHERE m.company_id = target_company_id
      AND m.user_id = app_auth_uid()
      AND m.status = 'active'
  )
  OR app_is_dev();
$$;

CREATE OR REPLACE FUNCTION prevent_company_profile_vat_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.vat_number IS NOT NULL AND NEW.vat_number IS DISTINCT FROM OLD.vat_number THEN
    RAISE EXCEPTION 'vat_number is immutable after initial set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_company_profile_vat_immutable
  BEFORE UPDATE ON company_profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_company_profile_vat_update();

CREATE OR REPLACE FUNCTION prevent_document_number_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.document_number > 0 AND NEW.document_number IS DISTINCT FROM OLD.document_number THEN
    RAISE EXCEPTION 'document_number is immutable once assigned';
  END IF;
  IF OLD.document_number > 0 AND NEW.document_code IS DISTINCT FROM OLD.document_code THEN
    RAISE EXCEPTION 'document_code is immutable once assigned';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_document_number_immutable
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION prevent_document_number_mutation();

CREATE OR REPLACE FUNCTION allocate_company_counter(
  p_company_id UUID,
  p_counter_key TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allocated INTEGER;
BEGIN
  INSERT INTO company_counters (company_id, counter_key, next_value, updated_at)
    VALUES (p_company_id, p_counter_key::counter_key, 2, NOW())
  ON CONFLICT (company_id, counter_key) DO UPDATE
    SET next_value = company_counters.next_value + 1,
        updated_at = NOW()
  RETURNING next_value - 1 INTO v_allocated;

  RETURN v_allocated;
END;
$$;

CREATE OR REPLACE FUNCTION allocate_system_counter(
  p_counter_key TEXT,
  p_start_at INTEGER DEFAULT 1
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allocated INTEGER;
BEGIN
  INSERT INTO system_counters (counter_key, next_value, updated_at)
    VALUES (p_counter_key, p_start_at + 1, NOW())
  ON CONFLICT (counter_key) DO UPDATE
    SET next_value = system_counters.next_value + 1,
        updated_at = NOW()
  RETURNING next_value - 1 INTO v_allocated;

  RETURN v_allocated;
END;
$$;

CREATE OR REPLACE FUNCTION increment_rate_limit_bucket(
  p_bucket_key VARCHAR(160),
  p_hashed_key VARCHAR(160),
  p_window_started_at TIMESTAMPTZ,
  p_expire_at TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit_count INTEGER;
BEGIN
  INSERT INTO rate_limit_buckets
    (bucket_key, hashed_key, window_started_at, hit_count, expire_at, updated_at)
  VALUES
    (p_bucket_key, p_hashed_key, p_window_started_at, 1, p_expire_at, NOW())
  ON CONFLICT (bucket_key) DO UPDATE
    SET hit_count = rate_limit_buckets.hit_count + 1,
        updated_at = NOW()
  RETURNING hit_count INTO v_hit_count;

  RETURN v_hit_count;
END;
$$;

CREATE OR REPLACE FUNCTION claim_tax_invoice_idempotency(
  p_company_id UUID,
  p_user_id TEXT,
  p_idempotency_hash VARCHAR(128),
  p_request_hash VARCHAR(128),
  p_expire_at TIMESTAMPTZ
) RETURNS TABLE (
  claim_status TEXT,
  result_payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  SELECT
    idempotency.status,
    idempotency.result_payload,
    idempotency.expire_at
  INTO v_existing
  FROM tax_invoice_idempotency AS idempotency
  WHERE idempotency.company_id = p_company_id
    AND idempotency.idempotency_hash = p_idempotency_hash
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO tax_invoice_idempotency (
      company_id,
      idempotency_hash,
      user_id,
      status,
      request_hash,
      locked_at,
      expire_at,
      created_at,
      updated_at
    ) VALUES (
      p_company_id,
      p_idempotency_hash,
      p_user_id,
      'in_progress',
      p_request_hash,
      NOW(),
      p_expire_at,
      NOW(),
      NOW()
    );
    claim_status := 'acquired';
    result_payload := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_existing.status = 'approved' THEN
    claim_status := 'approved';
    result_payload := v_existing.result_payload;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_existing.status = 'in_progress' AND (v_existing.expire_at IS NULL OR v_existing.expire_at > NOW()) THEN
    claim_status := 'in_progress';
    result_payload := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE tax_invoice_idempotency AS idempotency
  SET user_id = p_user_id,
      status = 'in_progress',
      request_hash = p_request_hash,
      result_payload = NULL,
      locked_at = NOW(),
      expire_at = p_expire_at,
      updated_at = NOW()
  WHERE idempotency.company_id = p_company_id
    AND idempotency.idempotency_hash = p_idempotency_hash;

  claim_status := 'acquired';
  result_payload := NULL;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION apply_inventory_movement(
  p_company_id UUID,
  p_part_id UUID,
  p_quantity NUMERIC,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_movement_type inventory_movement_type,
  p_created_by_membership_id UUID,
  p_job_id UUID DEFAULT NULL,
  p_document_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  movement_id UUID,
  from_quantity NUMERIC,
  to_quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_quantity NUMERIC := NULL;
  v_to_quantity NUMERIC := NULL;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'inventory_invalid_quantity';
  END IF;

  IF p_from_location_id IS NULL AND p_to_location_id IS NULL THEN
    RAISE EXCEPTION 'inventory_missing_location';
  END IF;

  IF p_from_location_id IS NOT NULL THEN
    INSERT INTO inventory_balances (location_id, part_id, quantity_on_hand, updated_at)
    VALUES (p_from_location_id, p_part_id, 0, p_created_at)
    ON CONFLICT (location_id, part_id) DO NOTHING;

    UPDATE inventory_balances
    SET quantity_on_hand = quantity_on_hand - p_quantity,
        updated_at = p_created_at
    WHERE location_id = p_from_location_id
      AND part_id = p_part_id
      AND quantity_on_hand >= p_quantity
    RETURNING quantity_on_hand INTO v_from_quantity;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'inventory_insufficient_stock';
    END IF;
  END IF;

  IF p_to_location_id IS NOT NULL THEN
    INSERT INTO inventory_balances (location_id, part_id, quantity_on_hand, updated_at)
    VALUES (p_to_location_id, p_part_id, p_quantity, p_created_at)
    ON CONFLICT (location_id, part_id) DO UPDATE
      SET quantity_on_hand = inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
          updated_at = EXCLUDED.updated_at
    RETURNING quantity_on_hand INTO v_to_quantity;
  END IF;

  INSERT INTO inventory_movements (
    company_id,
    part_id,
    quantity,
    from_location_id,
    to_location_id,
    movement_type,
    job_id,
    document_id,
    created_by_membership_id,
    note,
    created_at
  ) VALUES (
    p_company_id,
    p_part_id,
    p_quantity,
    p_from_location_id,
    p_to_location_id,
    p_movement_type,
    p_job_id,
    p_document_id,
    p_created_by_membership_id,
    p_note,
    p_created_at
  ) RETURNING id INTO movement_id;

  from_quantity := v_from_quantity;
  to_quantity := v_to_quantity;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION apply_inventory_pick_batch(
  p_company_id UUID,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_created_by_membership_id UUID,
  p_picks JSONB,
  p_created_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pick RECORD;
  v_movement RECORD;
BEGIN
  IF p_picks IS NULL OR jsonb_typeof(p_picks) <> 'array' OR jsonb_array_length(p_picks) = 0 THEN
    RAISE EXCEPTION 'inventory_missing_picks';
  END IF;

  FOR v_pick IN
    SELECT *
    FROM jsonb_to_recordset(p_picks) AS pick(part_id UUID, part_no INTEGER, quantity NUMERIC)
  LOOP
    IF v_pick.part_id IS NULL OR v_pick.quantity IS NULL OR v_pick.quantity <= 0 THEN
      RAISE EXCEPTION 'inventory_invalid_pick';
    END IF;

    SELECT *
    INTO v_movement
    FROM apply_inventory_movement(
      p_company_id,
      v_pick.part_id,
      v_pick.quantity,
      p_from_location_id,
      p_to_location_id,
      'pick',
      p_created_by_membership_id,
      NULL,
      NULL,
      'Picked part #' || COALESCE(v_pick.part_no::text, ''),
      p_created_at
    );

    movement_id := v_movement.movement_id;
    part_id := v_pick.part_id;
    part_no := v_pick.part_no;
    quantity := v_pick.quantity;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION apply_job_inventory_consumption_batch(
  p_company_id UUID,
  p_membership_id UUID,
  p_job_id UUID,
  p_created_by_membership_id UUID,
  p_parts JSONB,
  p_created_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_location_id UUID;
  v_consumed_location_id UUID;
  v_pick RECORD;
  v_part RECORD;
  v_movement RECORD;
BEGIN
  IF p_parts IS NULL OR jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) = 0 THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jobs j
    WHERE j.id = p_job_id
      AND j.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'inventory_job_not_found';
  END IF;

  SELECT id
  INTO v_from_location_id
  FROM inventory_locations
  WHERE company_id = p_company_id
    AND location_type = 'member'
    AND membership_id = p_membership_id
  LIMIT 1;

  IF v_from_location_id IS NULL THEN
    RAISE EXCEPTION 'inventory_member_location_missing';
  END IF;

  INSERT INTO inventory_locations (company_id, location_type, membership_id, name, created_at)
  VALUES (p_company_id, 'consumed', NULL, 'Consumed Inventory', p_created_at)
  ON CONFLICT DO NOTHING;

  SELECT id
  INTO v_consumed_location_id
  FROM inventory_locations
  WHERE company_id = p_company_id
    AND location_type = 'consumed'
    AND membership_id IS NULL
  LIMIT 1;

  IF v_consumed_location_id IS NULL THEN
    RAISE EXCEPTION 'inventory_consumed_location_missing';
  END IF;

  FOR v_pick IN
    SELECT *
    FROM jsonb_to_recordset(p_parts) AS pick(part_id UUID, part_no INTEGER, quantity NUMERIC)
  LOOP
    IF v_pick.part_id IS NULL OR v_pick.quantity IS NULL OR v_pick.quantity <= 0 THEN
      RAISE EXCEPTION 'inventory_invalid_consumption';
    END IF;

    SELECT inventory_part.id, inventory_part.part_no
    INTO v_part
    FROM inventory_parts AS inventory_part
    WHERE inventory_part.id = v_pick.part_id
      AND inventory_part.company_id = p_company_id
      AND inventory_part.archived_at IS NULL
    LIMIT 1;

    IF v_part.id IS NULL THEN
      RAISE EXCEPTION 'inventory_part_not_found';
    END IF;

    SELECT *
    INTO v_movement
    FROM apply_inventory_movement(
      p_company_id,
      v_part.id,
      v_pick.quantity,
      v_from_location_id,
      v_consumed_location_id,
      'job_consumption',
      p_created_by_membership_id,
      p_job_id,
      NULL,
      'Consumed for job #' || COALESCE(v_pick.part_no::text, v_part.part_no::text, ''),
      p_created_at
    );

    movement_id := v_movement.movement_id;
    part_id := v_part.id;
    part_no := v_part.part_no;
    quantity := v_pick.quantity;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION get_clients_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT NULL,
  p_after_client_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search TEXT := REGEXP_REPLACE(LOWER(BTRIM(COALESCE(p_search, ''))), '[%,*().]', '', 'g');
  v_wants_page BOOLEAN := COALESCE(p_page_size, 0) > 0;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 10000);
  v_items JSONB := '[]'::jsonb;
  v_fetched_count INTEGER := 0;
  v_last_client_no INTEGER;
  v_last_id UUID;
  v_next_cursor TEXT := NULL;
BEGIN
  WITH candidate AS (
    SELECT
      c.id,
      c.client_no,
      c.name,
      c.email,
      c.phone,
      c.address,
      c.notes,
      c.city,
      c.vat_number,
      c.created_at,
      c.updated_at
    FROM clients c
    WHERE c.company_id = p_company_id
      AND (
        v_search = ''
        OR LOWER(c.name) LIKE v_search || '%'
        OR c.phone LIKE v_search || '%'
        OR LOWER(COALESCE(c.email, '')) LIKE v_search || '%'
      )
      AND (
        p_after_client_no IS NULL
        OR p_after_id IS NULL
        OR c.client_no < p_after_client_no
        OR (c.client_no = p_after_client_no AND c.id < p_after_id)
      )
    ORDER BY c.client_no DESC, c.id DESC
    LIMIT CASE WHEN v_wants_page THEN v_limit + 1 ELSE NULL END
  ),
  visible AS (
    SELECT *
    FROM candidate
    ORDER BY client_no DESC, id DESC
    LIMIT CASE WHEN v_wants_page THEN v_limit ELSE NULL END
  ),
  aggregate AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'numericId', client_no,
          'name', name,
          'email', COALESCE(email, ''),
          'phone', COALESCE(phone, ''),
          'address', COALESCE(address, ''),
          'notes', COALESCE(notes, ''),
          'city', COALESCE(city, ''),
          'vatNumber', COALESCE(vat_number, ''),
          'createdAt', created_at,
          'updatedAt', updated_at
        )
        ORDER BY client_no DESC, id DESC
      ),
      '[]'::jsonb
    ) AS items
    FROM visible
  ),
  fetched AS (
    SELECT COUNT(*)::integer AS row_count FROM candidate
  ),
  last_row AS (
    SELECT client_no, id
    FROM visible
    ORDER BY client_no ASC, id ASC
    LIMIT 1
  )
  SELECT aggregate.items, fetched.row_count, last_row.client_no, last_row.id
  INTO v_items, v_fetched_count, v_last_client_no, v_last_id
  FROM aggregate
  CROSS JOIN fetched
  LEFT JOIN last_row ON TRUE;

  IF v_wants_page AND v_fetched_count > v_limit AND v_last_client_no IS NOT NULL AND v_last_id IS NOT NULL THEN
    v_next_cursor := v_last_client_no::text || '|' || v_last_id::text;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'nextCursor', v_next_cursor
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_company_inventory_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT NULL,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location_id UUID;
  v_next_value INTEGER := 1;
  v_search TEXT := LOWER(BTRIM(COALESCE(p_search, '')));
  v_wants_page BOOLEAN := COALESCE(p_page_size, 0) > 0;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 10000);
  v_parts JSONB := '[]'::jsonb;
  v_fetched_count INTEGER := 0;
  v_last_part_no INTEGER;
  v_last_id UUID;
  v_next_cursor TEXT := NULL;
BEGIN
  SELECT id
  INTO v_location_id
  FROM inventory_locations
  WHERE company_id = p_company_id
    AND location_type = 'company'
    AND membership_id IS NULL
  LIMIT 1;

  SELECT next_value
  INTO v_next_value
  FROM company_counters
  WHERE company_id = p_company_id
    AND counter_key = 'part_no'
  LIMIT 1;

  IF v_location_id IS NULL THEN
    RETURN jsonb_build_object(
      'parts', '[]'::jsonb,
      'nextId', COALESCE(v_next_value, 1),
      'lastUpdated', NOW(),
      'nextCursor', NULL
    );
  END IF;

  WITH candidate AS (
    SELECT
      p.id,
      p.part_no,
      p.name,
      p.active,
      p.low_threshold,
      p.created_at,
      COALESCE(b.quantity_on_hand, 0) AS quantity_on_hand
    FROM inventory_parts p
    LEFT JOIN inventory_balances b
      ON b.part_id = p.id
      AND b.location_id = v_location_id
    WHERE p.company_id = p_company_id
      AND p.archived_at IS NULL
      AND (
        v_search = ''
        OR LOWER(p.name) LIKE '%' || v_search || '%'
        OR p.part_no::text LIKE v_search || '%'
      )
      AND (
        p_after_part_no IS NULL
        OR p_after_id IS NULL
        OR p.part_no > p_after_part_no
        OR (p.part_no = p_after_part_no AND p.id > p_after_id)
      )
    ORDER BY p.part_no ASC, p.id ASC
    LIMIT CASE WHEN v_wants_page THEN v_limit + 1 ELSE NULL END
  ),
  visible AS (
    SELECT *
    FROM candidate
    ORDER BY part_no ASC, id ASC
    LIMIT CASE WHEN v_wants_page THEN v_limit ELSE NULL END
  ),
  aggregate AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', part_no,
          'name', name,
          'active', active,
          'quantity', quantity_on_hand,
          'lowThreshold', low_threshold,
          'dateAdded', created_at
        )
        ORDER BY part_no ASC, id ASC
      ),
      '[]'::jsonb
    ) AS parts
    FROM visible
  ),
  fetched AS (
    SELECT COUNT(*)::integer AS row_count FROM candidate
  ),
  last_row AS (
    SELECT part_no, id
    FROM visible
    ORDER BY part_no DESC, id DESC
    LIMIT 1
  )
  SELECT aggregate.parts, fetched.row_count, last_row.part_no, last_row.id
  INTO v_parts, v_fetched_count, v_last_part_no, v_last_id
  FROM aggregate
  CROSS JOIN fetched
  LEFT JOIN last_row ON TRUE;

  IF v_wants_page AND v_fetched_count > v_limit AND v_last_part_no IS NOT NULL AND v_last_id IS NOT NULL THEN
    v_next_cursor := v_last_part_no::text || '|' || v_last_id::text;
  END IF;

  RETURN jsonb_build_object(
    'parts', v_parts,
    'nextId', COALESCE(v_next_value, 1),
    'lastUpdated', NOW(),
    'nextCursor', v_next_cursor
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_member_inventory_page(
  p_company_id UUID,
  p_target_uid TEXT,
  p_page_size INTEGER DEFAULT NULL,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membership_id UUID;
  v_location_id UUID;
  v_next_value INTEGER := 1;
  v_search TEXT := LOWER(BTRIM(COALESCE(p_search, '')));
  v_wants_page BOOLEAN := COALESCE(p_page_size, 0) > 0;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 10000);
  v_parts JSONB := '[]'::jsonb;
  v_fetched_count INTEGER := 0;
  v_last_part_no INTEGER;
  v_last_id UUID;
  v_next_cursor TEXT := NULL;
BEGIN
  SELECT id
  INTO v_membership_id
  FROM company_memberships
  WHERE company_id = p_company_id
    AND user_id = BTRIM(COALESCE(p_target_uid, ''))
    AND status = 'active'
  LIMIT 1;

  SELECT next_value
  INTO v_next_value
  FROM company_counters
  WHERE company_id = p_company_id
    AND counter_key = 'part_no'
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    RETURN jsonb_build_object(
      'parts', '[]'::jsonb,
      'nextId', COALESCE(v_next_value, 1),
      'lastUpdated', NOW(),
      'nextCursor', NULL
    );
  END IF;

  SELECT id
  INTO v_location_id
  FROM inventory_locations
  WHERE company_id = p_company_id
    AND location_type = 'member'
    AND membership_id = v_membership_id
  LIMIT 1;

  IF v_location_id IS NULL THEN
    RETURN jsonb_build_object(
      'parts', '[]'::jsonb,
      'nextId', COALESCE(v_next_value, 1),
      'lastUpdated', NOW(),
      'nextCursor', NULL
    );
  END IF;

  WITH candidate AS (
    SELECT
      p.id,
      p.part_no,
      p.name,
      p.low_threshold,
      p.created_at,
      b.quantity_on_hand
    FROM inventory_balances b
    INNER JOIN inventory_parts p
      ON p.id = b.part_id
    WHERE b.location_id = v_location_id
      AND p.company_id = p_company_id
      AND p.archived_at IS NULL
      AND (
        v_search = ''
        OR LOWER(p.name) LIKE '%' || v_search || '%'
        OR p.part_no::text LIKE v_search || '%'
      )
      AND (
        p_after_part_no IS NULL
        OR p_after_id IS NULL
        OR p.part_no > p_after_part_no
        OR (p.part_no = p_after_part_no AND p.id > p_after_id)
      )
    ORDER BY p.part_no ASC, p.id ASC
    LIMIT CASE WHEN v_wants_page THEN v_limit + 1 ELSE NULL END
  ),
  visible AS (
    SELECT *
    FROM candidate
    ORDER BY part_no ASC, id ASC
    LIMIT CASE WHEN v_wants_page THEN v_limit ELSE NULL END
  ),
  aggregate AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', part_no,
          'name', name,
          'quantity', quantity_on_hand,
          'lowThreshold', low_threshold,
          'dateAdded', created_at
        )
        ORDER BY part_no ASC, id ASC
      ),
      '[]'::jsonb
    ) AS parts
    FROM visible
  ),
  fetched AS (
    SELECT COUNT(*)::integer AS row_count FROM candidate
  ),
  last_row AS (
    SELECT part_no, id
    FROM visible
    ORDER BY part_no DESC, id DESC
    LIMIT 1
  )
  SELECT aggregate.parts, fetched.row_count, last_row.part_no, last_row.id
  INTO v_parts, v_fetched_count, v_last_part_no, v_last_id
  FROM aggregate
  CROSS JOIN fetched
  LEFT JOIN last_row ON TRUE;

  IF v_wants_page AND v_fetched_count > v_limit AND v_last_part_no IS NOT NULL AND v_last_id IS NOT NULL THEN
    v_next_cursor := v_last_part_no::text || '|' || v_last_id::text;
  END IF;

  RETURN jsonb_build_object(
    'parts', v_parts,
    'nextId', COALESCE(v_next_value, 1),
    'lastUpdated', NOW(),
    'nextCursor', v_next_cursor
  );
END;
$$;

CREATE OR REPLACE FUNCTION redeem_company_invite(
  p_invite_code VARCHAR(80),
  p_uid TEXT,
  p_display_name VARCHAR(200) DEFAULT NULL,
  p_phone_number VARCHAR(40) DEFAULT NULL,
  p_email VARCHAR(320) DEFAULT NULL
) RETURNS TABLE (
  company_id UUID,
  public_company_id BIGINT,
  membership_id UUID,
  member_no INTEGER,
  role membership_role,
  display_name VARCHAR(200),
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_invite RECORD;
  v_existing RECORD;
  v_member_no INTEGER;
  v_membership RECORD;
BEGIN
  SELECT
    i.id,
    i.company_id,
    i.target_role,
    i.status,
    i.used_by_user_id,
    i.expires_at,
    i.invited_email,
    c.public_company_id
  INTO v_invite
  FROM company_invites i
  INNER JOIN companies c ON c.id = i.company_id
  WHERE UPPER(i.code) = UPPER(BTRIM(p_invite_code))
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;
  IF v_invite.expires_at <= v_now THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;
  IF v_invite.invited_email IS NOT NULL AND p_email IS NOT NULL AND LOWER(v_invite.invited_email) <> LOWER(p_email) THEN
    RAISE EXCEPTION 'invite_email_mismatch';
  END IF;

  SELECT m.id, m.company_id, m.member_no, m.role, m.display_name, m.joined_at
  INTO v_existing
  FROM company_memberships m
  WHERE m.user_id = p_uid
    AND m.status = 'active'
  ORDER BY m.joined_at ASC, m.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.company_id = v_invite.company_id THEN
      IF v_invite.status = 'used' AND v_invite.used_by_user_id = p_uid THEN
        company_id := v_existing.company_id;
        public_company_id := v_invite.public_company_id;
        membership_id := v_existing.id;
        member_no := v_existing.member_no;
        role := v_existing.role;
        display_name := v_existing.display_name;
        joined_at := v_existing.joined_at;
        RETURN NEXT;
        RETURN;
      END IF;
      RAISE EXCEPTION 'user_already_in_company';
    END IF;
    RAISE EXCEPTION 'user_already_in_other_company';
  END IF;

  IF v_invite.status <> 'active' THEN
    RAISE EXCEPTION 'invite_inactive';
  END IF;
  IF v_invite.target_role NOT IN ('manager', 'worker', 'user', 'basic') THEN
    RAISE EXCEPTION 'invite_role_invalid';
  END IF;

  INSERT INTO app_users (id, email, display_name, phone_number, created_at, updated_at)
  VALUES (p_uid, NULLIF(BTRIM(p_email), ''), NULLIF(BTRIM(p_display_name), ''), NULLIF(BTRIM(p_phone_number), ''), v_now, v_now)
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, app_users.email),
        display_name = COALESCE(EXCLUDED.display_name, app_users.display_name),
        phone_number = COALESCE(EXCLUDED.phone_number, app_users.phone_number),
        updated_at = v_now;

  v_member_no := allocate_company_counter(v_invite.company_id, 'member_no');

  INSERT INTO company_memberships (
    company_id,
    user_id,
    member_no,
    role,
    status,
    display_name,
    phone_number,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    v_invite.company_id,
    p_uid,
    v_member_no,
    v_invite.target_role,
    'active',
    NULLIF(BTRIM(p_display_name), ''),
    NULLIF(BTRIM(p_phone_number), ''),
    v_now,
    v_now,
    v_now
  ) RETURNING
    company_memberships.id,
    company_memberships.company_id,
    company_memberships.member_no,
    company_memberships.role,
    company_memberships.display_name,
    company_memberships.joined_at
  INTO v_membership;

  INSERT INTO inventory_locations (company_id, location_type, membership_id, name, created_at)
  VALUES (
    v_invite.company_id,
    'member',
    v_membership.id,
    COALESCE(NULLIF(BTRIM(p_display_name), ''), NULLIF(BTRIM(p_email), ''), CONCAT('Member ', v_member_no::text)),
    v_now
  )
  ON CONFLICT DO NOTHING;

  UPDATE company_invites
  SET status = 'used',
      used_by_user_id = p_uid,
      used_at = v_now
  WHERE id = v_invite.id;

  company_id := v_membership.company_id;
  public_company_id := v_invite.public_company_id;
  membership_id := v_membership.id;
  member_no := v_membership.member_no;
  role := v_membership.role;
  display_name := v_membership.display_name;
  joined_at := v_membership.joined_at;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION bump_company_sync_version(
  p_company_id UUID,
  p_field TEXT
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
    CASE WHEN p_field = 'jobs_version' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'documents_version' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'clients_version' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'workers_version' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'company_inventory_version' THEN 1 ELSE 0 END,
    NOW()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    jobs_version = CASE WHEN p_field = 'jobs_version'
      THEN company_sync_state.jobs_version + 1 ELSE company_sync_state.jobs_version END,
    documents_version = CASE WHEN p_field = 'documents_version'
      THEN company_sync_state.documents_version + 1 ELSE company_sync_state.documents_version END,
    clients_version = CASE WHEN p_field = 'clients_version'
      THEN company_sync_state.clients_version + 1 ELSE company_sync_state.clients_version END,
    workers_version = CASE WHEN p_field = 'workers_version'
      THEN company_sync_state.workers_version + 1 ELSE company_sync_state.workers_version END,
    company_inventory_version = CASE WHEN p_field = 'company_inventory_version'
      THEN company_sync_state.company_inventory_version + 1 ELSE company_sync_state.company_inventory_version END,
    updated_at = NOW();
END;
$$;

ALTER TABLE system_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_part_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_job_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_invoice_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_invoice_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_authority_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_oauth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_oauth_callbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE upgrade_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orphaned_user_cleanup_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_memberships_company_read_policy
  ON company_memberships
  FOR SELECT
  USING (
    app_is_dev()
    OR user_id = app_auth_uid()
    OR EXISTS (
      SELECT 1
      FROM company_memberships requester
      WHERE requester.company_id = company_memberships.company_id
        AND requester.user_id = app_auth_uid()
        AND requester.status = 'active'
        AND requester.role = 'manager'
    )
  );

CREATE POLICY company_profiles_company_read_policy
  ON company_profiles
  FOR SELECT
  USING (app_has_company_access(company_id));

CREATE POLICY company_subscriptions_company_read_policy
  ON company_subscriptions
  FOR SELECT
  USING (app_has_company_access(company_id));

CREATE POLICY company_sync_state_company_read_policy
  ON company_sync_state
  FOR SELECT
  USING (app_has_company_access(company_id));

CREATE POLICY clients_company_read_policy
  ON clients
  FOR SELECT
  USING (app_has_company_access(company_id));

CREATE POLICY jobs_company_read_policy
  ON jobs
  FOR SELECT
  USING (
    app_is_dev()
    OR EXISTS (
      SELECT 1
      FROM company_memberships requester
      INNER JOIN companies c ON c.id = requester.company_id
      WHERE requester.company_id = jobs.company_id
        AND requester.user_id = app_auth_uid()
        AND requester.status = 'active'
        AND (
          requester.role = 'manager'
          OR (
            requester.role = 'user'
            AND (
              c.account_type = 'solo'
              OR jobs.assigned_membership_id = requester.id
            )
          )
          OR (
            requester.role = 'worker'
            AND jobs.assigned_membership_id = requester.id
          )
        )
    )
  );

CREATE POLICY job_attachments_company_read_policy
  ON job_attachments
  FOR SELECT
  USING (
    app_is_dev()
    OR EXISTS (
      SELECT 1
      FROM jobs j
      INNER JOIN company_memberships requester
        ON requester.company_id = j.company_id
      INNER JOIN companies c ON c.id = requester.company_id
      WHERE j.id = job_attachments.job_id
        AND requester.user_id = app_auth_uid()
        AND requester.status = 'active'
        AND (
          requester.role = 'manager'
          OR (
            requester.role = 'user'
            AND (
              c.account_type = 'solo'
              OR j.assigned_membership_id = requester.id
            )
          )
          OR (
            requester.role = 'worker'
            AND j.assigned_membership_id = requester.id
          )
        )
    )
  );

CREATE POLICY job_part_usages_company_read_policy
  ON job_part_usages
  FOR SELECT
  USING (
    app_is_dev()
    OR EXISTS (
      SELECT 1
      FROM jobs j
      INNER JOIN company_memberships requester
        ON requester.company_id = j.company_id
      INNER JOIN companies c ON c.id = requester.company_id
      WHERE j.id = job_part_usages.job_id
        AND requester.user_id = app_auth_uid()
        AND requester.status = 'active'
        AND (
          requester.role = 'manager'
          OR (
            requester.role = 'user'
            AND (
              c.account_type = 'solo'
              OR j.assigned_membership_id = requester.id
            )
          )
          OR (
            requester.role = 'worker'
            AND j.assigned_membership_id = requester.id
          )
        )
    )
  );

CREATE POLICY inventory_locations_company_read_policy
  ON inventory_locations
  FOR SELECT
  USING (app_has_company_access(company_id));

CREATE POLICY inventory_parts_company_read_policy
  ON inventory_parts
  FOR SELECT
  USING (app_has_company_access(company_id));

CREATE POLICY inventory_balances_company_read_policy
  ON inventory_balances
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM inventory_locations loc
      WHERE loc.id = inventory_balances.location_id
        AND app_has_company_access(loc.company_id)
    )
  );

CREATE POLICY inventory_movements_company_read_policy
  ON inventory_movements
  FOR SELECT
  USING (app_has_company_access(company_id));

CREATE POLICY documents_company_read_policy
  ON documents
  FOR SELECT
  USING (
    app_is_dev()
    OR EXISTS (
      SELECT 1
      FROM company_memberships requester
      WHERE requester.company_id = documents.company_id
        AND requester.user_id = app_auth_uid()
        AND requester.status = 'active'
        AND requester.role IN ('manager', 'user', 'basic')
        AND NOT (
          documents.document_type = 305
          AND documents.tax_authority_status <> 'approved'
        )
    )
  );

CREATE POLICY document_items_company_read_policy
  ON document_items
  FOR SELECT
  USING (
    app_is_dev()
    OR EXISTS (
      SELECT 1
      FROM documents d
      INNER JOIN company_memberships requester
        ON requester.company_id = d.company_id
      WHERE d.id = document_items.document_id
        AND requester.user_id = app_auth_uid()
        AND requester.status = 'active'
        AND requester.role IN ('manager', 'user', 'basic')
        AND NOT (
          d.document_type = 305
          AND d.tax_authority_status <> 'approved'
        )
    )
  );

CREATE POLICY document_job_links_company_read_policy
  ON document_job_links
  FOR SELECT
  USING (
    app_is_dev()
    OR EXISTS (
      SELECT 1
      FROM documents d
      INNER JOIN company_memberships requester
        ON requester.company_id = d.company_id
      WHERE d.id = document_job_links.document_id
        AND requester.user_id = app_auth_uid()
        AND requester.status = 'active'
        AND requester.role IN ('manager', 'user', 'basic')
        AND NOT (
          d.document_type = 305
          AND d.tax_authority_status <> 'approved'
        )
    )
  );

CREATE POLICY proposal_usage_company_read_policy
  ON proposal_usage
  FOR SELECT
  USING (
    app_is_dev()
    OR EXISTS (
      SELECT 1
      FROM documents d
      INNER JOIN company_memberships requester
        ON requester.company_id = d.company_id
      WHERE d.id = proposal_usage.proposal_document_id
        AND requester.user_id = app_auth_uid()
        AND requester.status = 'active'
        AND requester.role IN ('manager', 'user', 'basic')
        AND NOT (
          d.document_type = 305
          AND d.tax_authority_status <> 'approved'
        )
    )
  );

CREATE POLICY company_invites_company_read_policy
  ON company_invites
  FOR SELECT
  USING (app_has_company_access(company_id));

CREATE POLICY document_tasks_company_read_policy
  ON document_tasks
  FOR SELECT
  USING (app_has_company_access(company_id) OR user_id = app_auth_uid());

CREATE POLICY support_conversations_owner_read_policy
  ON support_conversations
  FOR SELECT
  USING (app_is_dev() OR user_id = app_auth_uid());

CREATE POLICY support_messages_owner_read_policy
  ON support_messages
  FOR SELECT
  USING (
    app_is_dev()
    OR EXISTS (
      SELECT 1
      FROM support_conversations c
      WHERE c.id = support_messages.conversation_id
        AND c.user_id = app_auth_uid()
    )
  );

DO $$
DECLARE
  function_signature TEXT;
  role_name TEXT;
  function_signatures TEXT[] := ARRAY[
    'allocate_company_counter(UUID, TEXT)',
    'allocate_system_counter(TEXT, INTEGER)',
    'increment_rate_limit_bucket(VARCHAR, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ)',
    'claim_tax_invoice_idempotency(UUID, TEXT, VARCHAR, VARCHAR, TIMESTAMPTZ)',
    'apply_inventory_movement(UUID, UUID, NUMERIC, UUID, UUID, inventory_movement_type, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)',
    'apply_inventory_pick_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)',
    'apply_job_inventory_consumption_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)',
    'get_clients_page(UUID, INTEGER, INTEGER, UUID, TEXT)',
    'get_company_inventory_page(UUID, INTEGER, INTEGER, UUID, TEXT)',
    'get_member_inventory_page(UUID, TEXT, INTEGER, INTEGER, UUID, TEXT)',
    'redeem_company_invite(VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR)',
    'bump_company_sync_version(UUID, TEXT)'
  ];
BEGIN
  FOREACH function_signature IN ARRAY function_signatures LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || function_signature || ' FROM PUBLIC';

    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || function_signature || ' FROM ' || quote_ident(role_name);
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || function_signature || ' TO service_role';
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- Consolidated source: 0001_supabase_cost_perf_security_hardening.sql
-- ============================================================================
-- Supabase hardening pass:
-- - move privileged RPC implementations out of the exposed public schema
-- - keep public RPC names as service-role-only compatibility wrappers
-- - point RLS policies at private helper functions
-- - add cost/performance helper indexes and cleanup RPCs

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA private FROM anon;
    REVOKE CREATE ON SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA private FROM authenticated;
    REVOKE CREATE ON SCHEMA public FROM authenticated;
    GRANT USAGE ON SCHEMA private TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA private TO service_role;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.app_auth_uid()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '');
$$;

ALTER FUNCTION public.app_is_dev() SET SCHEMA private;
ALTER FUNCTION public.app_has_company_access(uuid) SET SCHEMA private;
ALTER FUNCTION public.allocate_company_counter(UUID, TEXT) SET SCHEMA private;
ALTER FUNCTION public.allocate_system_counter(TEXT, INTEGER) SET SCHEMA private;
ALTER FUNCTION public.increment_rate_limit_bucket(VARCHAR, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ) SET SCHEMA private;
ALTER FUNCTION public.claim_tax_invoice_idempotency(UUID, TEXT, VARCHAR, VARCHAR, TIMESTAMPTZ) SET SCHEMA private;
ALTER FUNCTION public.apply_inventory_movement(UUID, UUID, NUMERIC, UUID, UUID, public.inventory_movement_type, UUID, UUID, UUID, TEXT, TIMESTAMPTZ) SET SCHEMA private;
ALTER FUNCTION public.apply_inventory_pick_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ) SET SCHEMA private;
ALTER FUNCTION public.apply_job_inventory_consumption_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ) SET SCHEMA private;
ALTER FUNCTION public.get_clients_page(UUID, INTEGER, INTEGER, UUID, TEXT) SET SCHEMA private;
ALTER FUNCTION public.get_company_inventory_page(UUID, INTEGER, INTEGER, UUID, TEXT) SET SCHEMA private;
ALTER FUNCTION public.get_member_inventory_page(UUID, TEXT, INTEGER, INTEGER, UUID, TEXT) SET SCHEMA private;
ALTER FUNCTION public.redeem_company_invite(VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR) SET SCHEMA private;
ALTER FUNCTION public.bump_company_sync_version(UUID, TEXT) SET SCHEMA private;

CREATE OR REPLACE FUNCTION private.app_is_dev()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users u
    WHERE u.id = private.app_auth_uid()
      AND COALESCE(u.system_role::text, '') = 'dev'
  );
$$;

CREATE OR REPLACE FUNCTION private.app_has_company_access(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_memberships m
    WHERE m.company_id = target_company_id
      AND m.user_id = private.app_auth_uid()
      AND m.status = 'active'
  )
  OR private.app_is_dev();
$$;

CREATE OR REPLACE FUNCTION public.app_is_dev()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.app_is_dev();
$$;

CREATE OR REPLACE FUNCTION public.app_has_company_access(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.app_has_company_access(target_company_id);
$$;

CREATE OR REPLACE FUNCTION public.allocate_company_counter(
  p_company_id UUID,
  p_counter_key TEXT
) RETURNS INTEGER
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.allocate_company_counter(p_company_id, p_counter_key);
$$;

CREATE OR REPLACE FUNCTION public.allocate_system_counter(
  p_counter_key TEXT,
  p_start_at INTEGER DEFAULT 1
) RETURNS INTEGER
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.allocate_system_counter(p_counter_key, p_start_at);
$$;

CREATE OR REPLACE FUNCTION public.increment_rate_limit_bucket(
  p_bucket_key VARCHAR(160),
  p_hashed_key VARCHAR(160),
  p_window_started_at TIMESTAMPTZ,
  p_expire_at TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.increment_rate_limit_bucket(p_bucket_key, p_hashed_key, p_window_started_at, p_expire_at);
$$;

CREATE OR REPLACE FUNCTION public.claim_tax_invoice_idempotency(
  p_company_id UUID,
  p_user_id TEXT,
  p_idempotency_hash VARCHAR(128),
  p_request_hash VARCHAR(128),
  p_expire_at TIMESTAMPTZ
) RETURNS TABLE (
  claim_status TEXT,
  result_payload JSONB
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT claim_status, result_payload
  FROM private.claim_tax_invoice_idempotency(
    p_company_id,
    p_user_id,
    p_idempotency_hash,
    p_request_hash,
    p_expire_at
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_inventory_movement(
  p_company_id UUID,
  p_part_id UUID,
  p_quantity NUMERIC,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_movement_type public.inventory_movement_type,
  p_created_by_membership_id UUID,
  p_job_id UUID DEFAULT NULL,
  p_document_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  movement_id UUID,
  from_quantity NUMERIC,
  to_quantity NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT movement_id, from_quantity, to_quantity
  FROM private.apply_inventory_movement(
    p_company_id,
    p_part_id,
    p_quantity,
    p_from_location_id,
    p_to_location_id,
    p_movement_type,
    p_created_by_membership_id,
    p_job_id,
    p_document_id,
    p_note,
    p_created_at
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_inventory_pick_batch(
  p_company_id UUID,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_created_by_membership_id UUID,
  p_picks JSONB,
  p_created_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT movement_id, part_id, part_no, quantity
  FROM private.apply_inventory_pick_batch(
    p_company_id,
    p_from_location_id,
    p_to_location_id,
    p_created_by_membership_id,
    p_picks,
    p_created_at
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_job_inventory_consumption_batch(
  p_company_id UUID,
  p_membership_id UUID,
  p_job_id UUID,
  p_created_by_membership_id UUID,
  p_parts JSONB,
  p_created_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT movement_id, part_id, part_no, quantity
  FROM private.apply_job_inventory_consumption_batch(
    p_company_id,
    p_membership_id,
    p_job_id,
    p_created_by_membership_id,
    p_parts,
    p_created_at
  );
$$;

CREATE OR REPLACE FUNCTION public.get_clients_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT NULL,
  p_after_client_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_clients_page(p_company_id, p_page_size, p_after_client_no, p_after_id, p_search);
$$;

CREATE OR REPLACE FUNCTION public.get_company_inventory_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT NULL,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_company_inventory_page(p_company_id, p_page_size, p_after_part_no, p_after_id, p_search);
$$;

CREATE OR REPLACE FUNCTION public.get_member_inventory_page(
  p_company_id UUID,
  p_target_uid TEXT,
  p_page_size INTEGER DEFAULT NULL,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_member_inventory_page(p_company_id, p_target_uid, p_page_size, p_after_part_no, p_after_id, p_search);
$$;

CREATE OR REPLACE FUNCTION public.redeem_company_invite(
  p_invite_code VARCHAR(80),
  p_uid TEXT,
  p_display_name VARCHAR(200) DEFAULT NULL,
  p_phone_number VARCHAR(40) DEFAULT NULL,
  p_email VARCHAR(320) DEFAULT NULL
) RETURNS TABLE (
  company_id UUID,
  public_company_id BIGINT,
  membership_id UUID,
  member_no INTEGER,
  role public.membership_role,
  display_name VARCHAR(200),
  joined_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT company_id, public_company_id, membership_id, member_no, role, display_name, joined_at
  FROM private.redeem_company_invite(p_invite_code, p_uid, p_display_name, p_phone_number, p_email);
$$;

CREATE OR REPLACE FUNCTION public.bump_company_sync_version(
  p_company_id UUID,
  p_field TEXT
) RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.bump_company_sync_version(p_company_id, p_field);
$$;

CREATE OR REPLACE FUNCTION private.get_inventory_counts(
  p_company_id UUID,
  p_membership_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH company_count AS (
    SELECT COUNT(*)::integer AS row_count
    FROM public.inventory_parts p
    WHERE p.company_id = p_company_id
      AND p.archived_at IS NULL
  ),
  member_location AS (
    SELECT loc.id
    FROM public.inventory_locations loc
    WHERE loc.company_id = p_company_id
      AND loc.location_type = 'member'
      AND loc.membership_id = p_membership_id
    LIMIT 1
  ),
  member_count AS (
    SELECT COUNT(*)::integer AS row_count
    FROM public.inventory_balances b
    INNER JOIN member_location loc ON loc.id = b.location_id
    INNER JOIN public.inventory_parts p
      ON p.id = b.part_id
     AND p.company_id = p_company_id
     AND p.archived_at IS NULL
  )
  SELECT jsonb_build_object(
    'inventoryParts', COALESCE((SELECT row_count FROM member_count), 0),
    'companyInventoryParts', COALESCE((SELECT row_count FROM company_count), 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_inventory_counts(
  p_company_id UUID,
  p_membership_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_inventory_counts(p_company_id, p_membership_id);
$$;

CREATE OR REPLACE FUNCTION private.cleanup_expired_operational_rows(
  p_now TIMESTAMPTZ DEFAULT NOW()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rate_limit_deleted INTEGER := 0;
  v_idempotency_deleted INTEGER := 0;
  v_document_tasks_deleted INTEGER := 0;
  v_notifications_deleted INTEGER := 0;
  v_contact_requests_deleted INTEGER := 0;
BEGIN
  DELETE FROM public.rate_limit_buckets
  WHERE expire_at < p_now;
  GET DIAGNOSTICS v_rate_limit_deleted = ROW_COUNT;

  DELETE FROM public.tax_invoice_idempotency
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now
    AND status <> 'approved';
  GET DIAGNOSTICS v_idempotency_deleted = ROW_COUNT;

  DELETE FROM public.document_tasks
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now
    AND status IN ('completed', 'failed');
  GET DIAGNOSTICS v_document_tasks_deleted = ROW_COUNT;

  DELETE FROM public.notification_deliveries
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now;
  GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;

  DELETE FROM public.contact_requests
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now;
  GET DIAGNOSTICS v_contact_requests_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'rateLimitBuckets', v_rate_limit_deleted,
    'taxInvoiceIdempotency', v_idempotency_deleted,
    'documentTasks', v_document_tasks_deleted,
    'notificationDeliveries', v_notifications_deleted,
    'contactRequests', v_contact_requests_deleted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_operational_rows(
  p_now TIMESTAMPTZ DEFAULT NOW()
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.cleanup_expired_operational_rows(p_now);
$$;

CREATE INDEX IF NOT EXISTS documents_company_visible_created_cursor_idx
  ON public.documents (company_id, created_at DESC, id DESC)
  WHERE document_type <> 305 OR tax_authority_status = 'approved';

CREATE INDEX IF NOT EXISTS documents_company_visible_document_date_cursor_idx
  ON public.documents (company_id, document_date DESC, id DESC)
  WHERE document_date IS NOT NULL
    AND (document_type <> 305 OR tax_authority_status = 'approved');

CREATE INDEX IF NOT EXISTS documents_company_visible_type_document_date_cursor_idx
  ON public.documents (company_id, document_type, document_date DESC, id DESC)
  WHERE document_date IS NOT NULL
    AND (document_type <> 305 OR tax_authority_status = 'approved');

CREATE INDEX IF NOT EXISTS tax_invoice_reservations_idempotency_lookup_idx
  ON public.tax_invoice_reservations (
    company_id,
    status,
    ((status_payload ->> 'idempotencyKey')),
    created_at DESC
  );

ALTER POLICY company_memberships_company_read_policy
  ON public.company_memberships
  USING (
    (SELECT private.app_is_dev())
    OR user_id = private.app_auth_uid()
    OR EXISTS (
      SELECT 1
      FROM public.company_memberships requester
      WHERE requester.company_id = company_memberships.company_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND requester.role = 'manager'
    )
  );

ALTER POLICY company_profiles_company_read_policy
  ON public.company_profiles
  USING (private.app_has_company_access(company_id));

ALTER POLICY company_subscriptions_company_read_policy
  ON public.company_subscriptions
  USING (private.app_has_company_access(company_id));

ALTER POLICY company_sync_state_company_read_policy
  ON public.company_sync_state
  USING (private.app_has_company_access(company_id));

ALTER POLICY clients_company_read_policy
  ON public.clients
  USING (private.app_has_company_access(company_id));

ALTER POLICY jobs_company_read_policy
  ON public.jobs
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.company_memberships requester
      INNER JOIN public.companies c ON c.id = requester.company_id
      WHERE requester.company_id = jobs.company_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND (
          requester.role = 'manager'
          OR (
            requester.role = 'user'
            AND (
              c.account_type = 'solo'
              OR jobs.assigned_membership_id = requester.id
            )
          )
          OR (
            requester.role = 'worker'
            AND jobs.assigned_membership_id = requester.id
          )
        )
    )
  );

ALTER POLICY job_attachments_company_read_policy
  ON public.job_attachments
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.jobs j
      INNER JOIN public.company_memberships requester
        ON requester.company_id = j.company_id
      INNER JOIN public.companies c ON c.id = requester.company_id
      WHERE j.id = job_attachments.job_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND (
          requester.role = 'manager'
          OR (
            requester.role = 'user'
            AND (
              c.account_type = 'solo'
              OR j.assigned_membership_id = requester.id
            )
          )
          OR (
            requester.role = 'worker'
            AND j.assigned_membership_id = requester.id
          )
        )
    )
  );

ALTER POLICY job_part_usages_company_read_policy
  ON public.job_part_usages
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.jobs j
      INNER JOIN public.company_memberships requester
        ON requester.company_id = j.company_id
      INNER JOIN public.companies c ON c.id = requester.company_id
      WHERE j.id = job_part_usages.job_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND (
          requester.role = 'manager'
          OR (
            requester.role = 'user'
            AND (
              c.account_type = 'solo'
              OR j.assigned_membership_id = requester.id
            )
          )
          OR (
            requester.role = 'worker'
            AND j.assigned_membership_id = requester.id
          )
        )
    )
  );

ALTER POLICY inventory_locations_company_read_policy
  ON public.inventory_locations
  USING (private.app_has_company_access(company_id));

ALTER POLICY inventory_parts_company_read_policy
  ON public.inventory_parts
  USING (private.app_has_company_access(company_id));

ALTER POLICY inventory_balances_company_read_policy
  ON public.inventory_balances
  USING (
    EXISTS (
      SELECT 1
      FROM public.inventory_locations loc
      WHERE loc.id = inventory_balances.location_id
        AND private.app_has_company_access(loc.company_id)
    )
  );

ALTER POLICY inventory_movements_company_read_policy
  ON public.inventory_movements
  USING (private.app_has_company_access(company_id));

ALTER POLICY documents_company_read_policy
  ON public.documents
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.company_memberships requester
      WHERE requester.company_id = documents.company_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND requester.role IN ('manager', 'user', 'basic')
        AND NOT (
          documents.document_type = 305
          AND documents.tax_authority_status <> 'approved'
        )
    )
  );

ALTER POLICY document_items_company_read_policy
  ON public.document_items
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.documents d
      INNER JOIN public.company_memberships requester
        ON requester.company_id = d.company_id
      WHERE d.id = document_items.document_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND requester.role IN ('manager', 'user', 'basic')
        AND NOT (
          d.document_type = 305
          AND d.tax_authority_status <> 'approved'
        )
    )
  );

ALTER POLICY document_job_links_company_read_policy
  ON public.document_job_links
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.documents d
      INNER JOIN public.company_memberships requester
        ON requester.company_id = d.company_id
      WHERE d.id = document_job_links.document_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND requester.role IN ('manager', 'user', 'basic')
        AND NOT (
          d.document_type = 305
          AND d.tax_authority_status <> 'approved'
        )
    )
  );

ALTER POLICY proposal_usage_company_read_policy
  ON public.proposal_usage
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.documents d
      INNER JOIN public.company_memberships requester
        ON requester.company_id = d.company_id
      WHERE d.id = proposal_usage.proposal_document_id
        AND requester.user_id = private.app_auth_uid()
        AND requester.status = 'active'
        AND requester.role IN ('manager', 'user', 'basic')
        AND NOT (
          d.document_type = 305
          AND d.tax_authority_status <> 'approved'
        )
    )
  );

ALTER POLICY company_invites_company_read_policy
  ON public.company_invites
  USING (private.app_has_company_access(company_id));

ALTER POLICY document_tasks_company_read_policy
  ON public.document_tasks
  USING (private.app_has_company_access(company_id) OR user_id = private.app_auth_uid());

ALTER POLICY support_conversations_owner_read_policy
  ON public.support_conversations
  USING ((SELECT private.app_is_dev()) OR user_id = private.app_auth_uid());

ALTER POLICY support_messages_owner_read_policy
  ON public.support_messages
  USING (
    (SELECT private.app_is_dev())
    OR EXISTS (
      SELECT 1
      FROM public.support_conversations c
      WHERE c.id = support_messages.conversation_id
        AND c.user_id = private.app_auth_uid()
    )
  );

DO $$
DECLARE
  private_signature TEXT;
  public_signature TEXT;
  has_anon BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_authenticated BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  has_service_role BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
BEGIN
  FOREACH private_signature IN ARRAY ARRAY[
    'private.app_auth_uid()',
    'private.app_is_dev()',
    'private.app_has_company_access(UUID)'
  ] LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || private_signature || ' FROM PUBLIC';
    IF has_authenticated THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || private_signature || ' TO authenticated';
    END IF;
    IF has_service_role THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || private_signature || ' TO service_role';
    END IF;
  END LOOP;

  FOREACH private_signature IN ARRAY ARRAY[
    'private.allocate_company_counter(UUID, TEXT)',
    'private.allocate_system_counter(TEXT, INTEGER)',
    'private.increment_rate_limit_bucket(VARCHAR, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ)',
    'private.claim_tax_invoice_idempotency(UUID, TEXT, VARCHAR, VARCHAR, TIMESTAMPTZ)',
    'private.apply_inventory_movement(UUID, UUID, NUMERIC, UUID, UUID, public.inventory_movement_type, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)',
    'private.apply_inventory_pick_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)',
    'private.apply_job_inventory_consumption_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)',
    'private.get_clients_page(UUID, INTEGER, INTEGER, UUID, TEXT)',
    'private.get_company_inventory_page(UUID, INTEGER, INTEGER, UUID, TEXT)',
    'private.get_member_inventory_page(UUID, TEXT, INTEGER, INTEGER, UUID, TEXT)',
    'private.get_inventory_counts(UUID, UUID)',
    'private.redeem_company_invite(VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR)',
    'private.bump_company_sync_version(UUID, TEXT)',
    'private.cleanup_expired_operational_rows(TIMESTAMPTZ)'
  ] LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || private_signature || ' FROM PUBLIC';
    IF has_anon THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || private_signature || ' FROM anon';
    END IF;
    IF has_authenticated THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || private_signature || ' FROM authenticated';
    END IF;
    IF has_service_role THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || private_signature || ' TO service_role';
    END IF;
  END LOOP;

  FOREACH public_signature IN ARRAY ARRAY[
    'public.app_is_dev()',
    'public.app_has_company_access(UUID)',
    'public.allocate_company_counter(UUID, TEXT)',
    'public.allocate_system_counter(TEXT, INTEGER)',
    'public.increment_rate_limit_bucket(VARCHAR, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ)',
    'public.claim_tax_invoice_idempotency(UUID, TEXT, VARCHAR, VARCHAR, TIMESTAMPTZ)',
    'public.apply_inventory_movement(UUID, UUID, NUMERIC, UUID, UUID, public.inventory_movement_type, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)',
    'public.apply_inventory_pick_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)',
    'public.apply_job_inventory_consumption_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)',
    'public.get_clients_page(UUID, INTEGER, INTEGER, UUID, TEXT)',
    'public.get_company_inventory_page(UUID, INTEGER, INTEGER, UUID, TEXT)',
    'public.get_member_inventory_page(UUID, TEXT, INTEGER, INTEGER, UUID, TEXT)',
    'public.get_inventory_counts(UUID, UUID)',
    'public.redeem_company_invite(VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR)',
    'public.bump_company_sync_version(UUID, TEXT)',
    'public.cleanup_expired_operational_rows(TIMESTAMPTZ)'
  ] LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || public_signature || ' FROM PUBLIC';
    IF has_anon THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || public_signature || ' FROM anon';
    END IF;
    IF has_authenticated THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || public_signature || ' FROM authenticated';
    END IF;
    IF has_service_role THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || public_signature || ' TO service_role';
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ============================================================================
-- Consolidated source: 0002_phase1_read_caps.sql
-- ============================================================================
-- Phase 1: cap unbounded RPC reads
-- Updates private page RPCs so the default page size is 50 and pagination is always enforced.
-- Public wrappers remain thin SECURITY INVOKER delegations to the private implementations.

CREATE OR REPLACE FUNCTION private.get_clients_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT 50,
  p_after_client_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_search TEXT := REGEXP_REPLACE(LOWER(BTRIM(COALESCE(p_search, ''))), '[%,*().]', '', 'g');
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 10000);
  v_items JSONB := '[]'::jsonb;
  v_fetched_count INTEGER := 0;
  v_last_client_no INTEGER;
  v_last_id UUID;
  v_next_cursor TEXT := NULL;
BEGIN
  WITH candidate AS (
    SELECT
      c.id,
      c.client_no,
      c.name,
      c.email,
      c.phone,
      c.address,
      c.notes,
      c.city,
      c.vat_number,
      c.created_at,
      c.updated_at
    FROM public.clients c
    WHERE c.company_id = p_company_id
      AND (
        v_search = ''
        OR LOWER(c.name) LIKE v_search || '%'
        OR c.phone LIKE v_search || '%'
        OR LOWER(COALESCE(c.email, '')) LIKE v_search || '%'
      )
      AND (
        p_after_client_no IS NULL
        OR p_after_id IS NULL
        OR c.client_no < p_after_client_no
        OR (c.client_no = p_after_client_no AND c.id < p_after_id)
      )
    ORDER BY c.client_no DESC, c.id DESC
    LIMIT v_limit + 1
  ),
  visible AS (
    SELECT *
    FROM candidate
    ORDER BY client_no DESC, id DESC
    LIMIT v_limit
  ),
  aggregate AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'numericId', client_no,
          'name', name,
          'email', COALESCE(email, ''),
          'phone', COALESCE(phone, ''),
          'address', COALESCE(address, ''),
          'notes', COALESCE(notes, ''),
          'city', COALESCE(city, ''),
          'vatNumber', COALESCE(vat_number, ''),
          'createdAt', created_at,
          'updatedAt', updated_at
        )
        ORDER BY client_no DESC, id DESC
      ),
      '[]'::jsonb
    ) AS items
    FROM visible
  ),
  fetched AS (
    SELECT COUNT(*)::integer AS row_count FROM candidate
  ),
  last_row AS (
    SELECT client_no, id
    FROM visible
    ORDER BY client_no ASC, id ASC
    LIMIT 1
  )
  SELECT aggregate.items, fetched.row_count, last_row.client_no, last_row.id
  INTO v_items, v_fetched_count, v_last_client_no, v_last_id
  FROM aggregate
  CROSS JOIN fetched
  LEFT JOIN last_row ON TRUE;

  IF v_fetched_count > v_limit AND v_last_client_no IS NOT NULL AND v_last_id IS NOT NULL THEN
    v_next_cursor := v_last_client_no::text || '|' || v_last_id::text;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'nextCursor', v_next_cursor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_clients_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT 50,
  p_after_client_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_clients_page(p_company_id, p_page_size, p_after_client_no, p_after_id, p_search);
$$;

CREATE OR REPLACE FUNCTION private.get_company_inventory_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT 50,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_location_id UUID;
  v_next_value INTEGER := 1;
  v_search TEXT := LOWER(BTRIM(COALESCE(p_search, '')));
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 10000);
  v_parts JSONB := '[]'::jsonb;
  v_fetched_count INTEGER := 0;
  v_last_part_no INTEGER;
  v_last_id UUID;
  v_next_cursor TEXT := NULL;
BEGIN
  SELECT id
  INTO v_location_id
  FROM public.inventory_locations
  WHERE company_id = p_company_id
    AND location_type = 'company'
    AND membership_id IS NULL
  LIMIT 1;

  SELECT next_value
  INTO v_next_value
  FROM public.company_counters
  WHERE company_id = p_company_id
    AND counter_key = 'part_no'
  LIMIT 1;

  IF v_location_id IS NULL THEN
    RETURN jsonb_build_object(
      'parts', '[]'::jsonb,
      'nextId', COALESCE(v_next_value, 1),
      'lastUpdated', NOW(),
      'nextCursor', NULL
    );
  END IF;

  WITH candidate AS (
    SELECT
      p.id,
      p.part_no,
      p.name,
      p.active,
      p.low_threshold,
      p.created_at,
      COALESCE(b.quantity_on_hand, 0) AS quantity_on_hand
    FROM public.inventory_parts p
    LEFT JOIN public.inventory_balances b
      ON b.part_id = p.id
      AND b.location_id = v_location_id
    WHERE p.company_id = p_company_id
      AND p.archived_at IS NULL
      AND (
        v_search = ''
        OR LOWER(p.name) LIKE '%' || v_search || '%'
        OR p.part_no::text LIKE v_search || '%'
      )
      AND (
        p_after_part_no IS NULL
        OR p_after_id IS NULL
        OR p.part_no > p_after_part_no
        OR (p.part_no = p_after_part_no AND p.id > p_after_id)
      )
    ORDER BY p.part_no ASC, p.id ASC
    LIMIT v_limit + 1
  ),
  visible AS (
    SELECT *
    FROM candidate
    ORDER BY part_no ASC, id ASC
    LIMIT v_limit
  ),
  aggregate AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', part_no,
          'name', name,
          'active', active,
          'quantity', quantity_on_hand,
          'lowThreshold', low_threshold,
          'dateAdded', created_at
        )
        ORDER BY part_no ASC, id ASC
      ),
      '[]'::jsonb
    ) AS parts
    FROM visible
  ),
  fetched AS (
    SELECT COUNT(*)::integer AS row_count FROM candidate
  ),
  last_row AS (
    SELECT part_no, id
    FROM visible
    ORDER BY part_no DESC, id DESC
    LIMIT 1
  )
  SELECT aggregate.parts, fetched.row_count, last_row.part_no, last_row.id
  INTO v_parts, v_fetched_count, v_last_part_no, v_last_id
  FROM aggregate
  CROSS JOIN fetched
  LEFT JOIN last_row ON TRUE;

  IF v_fetched_count > v_limit AND v_last_part_no IS NOT NULL AND v_last_id IS NOT NULL THEN
    v_next_cursor := v_last_part_no::text || '|' || v_last_id::text;
  END IF;

  RETURN jsonb_build_object(
    'parts', v_parts,
    'nextId', COALESCE(v_next_value, 1),
    'lastUpdated', NOW(),
    'nextCursor', v_next_cursor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_inventory_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT 50,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_company_inventory_page(p_company_id, p_page_size, p_after_part_no, p_after_id, p_search);
$$;

CREATE OR REPLACE FUNCTION private.get_member_inventory_page(
  p_company_id UUID,
  p_target_uid TEXT,
  p_page_size INTEGER DEFAULT 50,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_location_id UUID;
  v_next_value INTEGER := 1;
  v_search TEXT := LOWER(BTRIM(COALESCE(p_search, '')));
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 10000);
  v_parts JSONB := '[]'::jsonb;
  v_fetched_count INTEGER := 0;
  v_last_part_no INTEGER;
  v_last_id UUID;
  v_next_cursor TEXT := NULL;
BEGIN
  SELECT id
  INTO v_membership_id
  FROM public.company_memberships
  WHERE company_id = p_company_id
    AND user_id = BTRIM(COALESCE(p_target_uid, ''))
    AND status = 'active'
  LIMIT 1;

  SELECT next_value
  INTO v_next_value
  FROM public.company_counters
  WHERE company_id = p_company_id
    AND counter_key = 'part_no'
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    RETURN jsonb_build_object(
      'parts', '[]'::jsonb,
      'nextId', COALESCE(v_next_value, 1),
      'lastUpdated', NOW(),
      'nextCursor', NULL
    );
  END IF;

  SELECT id
  INTO v_location_id
  FROM public.inventory_locations
  WHERE company_id = p_company_id
    AND location_type = 'member'
    AND membership_id = v_membership_id
  LIMIT 1;

  IF v_location_id IS NULL THEN
    RETURN jsonb_build_object(
      'parts', '[]'::jsonb,
      'nextId', COALESCE(v_next_value, 1),
      'lastUpdated', NOW(),
      'nextCursor', NULL
    );
  END IF;

  WITH candidate AS (
    SELECT
      p.id,
      p.part_no,
      p.name,
      p.low_threshold,
      p.created_at,
      b.quantity_on_hand
    FROM public.inventory_balances b
    INNER JOIN public.inventory_parts p
      ON p.id = b.part_id
    WHERE b.location_id = v_location_id
      AND p.company_id = p_company_id
      AND p.archived_at IS NULL
      AND (
        v_search = ''
        OR LOWER(p.name) LIKE '%' || v_search || '%'
        OR p.part_no::text LIKE v_search || '%'
      )
      AND (
        p_after_part_no IS NULL
        OR p_after_id IS NULL
        OR p.part_no > p_after_part_no
        OR (p.part_no = p_after_part_no AND p.id > p_after_id)
      )
    ORDER BY p.part_no ASC, p.id ASC
    LIMIT v_limit + 1
  ),
  visible AS (
    SELECT *
    FROM candidate
    ORDER BY part_no ASC, id ASC
    LIMIT v_limit
  ),
  aggregate AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', part_no,
          'name', name,
          'quantity', quantity_on_hand,
          'lowThreshold', low_threshold,
          'dateAdded', created_at
        )
        ORDER BY part_no ASC, id ASC
      ),
      '[]'::jsonb
    ) AS parts
    FROM visible
  ),
  fetched AS (
    SELECT COUNT(*)::integer AS row_count FROM candidate
  ),
  last_row AS (
    SELECT part_no, id
    FROM visible
    ORDER BY part_no DESC, id DESC
    LIMIT 1
  )
  SELECT aggregate.parts, fetched.row_count, last_row.part_no, last_row.id
  INTO v_parts, v_fetched_count, v_last_part_no, v_last_id
  FROM aggregate
  CROSS JOIN fetched
  LEFT JOIN last_row ON TRUE;

  IF v_fetched_count > v_limit AND v_last_part_no IS NOT NULL AND v_last_id IS NOT NULL THEN
    v_next_cursor := v_last_part_no::text || '|' || v_last_id::text;
  END IF;

  RETURN jsonb_build_object(
    'parts', v_parts,
    'nextId', COALESCE(v_next_value, 1),
    'lastUpdated', NOW(),
    'nextCursor', v_next_cursor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_member_inventory_page(
  p_company_id UUID,
  p_target_uid TEXT,
  p_page_size INTEGER DEFAULT 50,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_member_inventory_page(p_company_id, p_target_uid, p_page_size, p_after_part_no, p_after_id, p_search);
$$;

-- ============================================================================
-- Consolidated source: 0003_phase1_atomic_jobs.sql
-- ============================================================================
-- Phase 1: atomic job creation.
-- Replaces the edge handler's multi-step insert/rollback with a single transaction.

CREATE OR REPLACE FUNCTION private.create_job_with_details(
  p_company_id UUID,
  p_job_no INTEGER,
  p_status public.job_status,
  p_title VARCHAR(240),
  p_description TEXT,
  p_notes TEXT,
  p_location VARCHAR(240),
  p_address VARCHAR(500),
  p_category VARCHAR(120),
  p_priority VARCHAR(40),
  p_due_at TIMESTAMPTZ,
  p_client_id UUID,
  p_assigned_membership_id UUID,
  p_created_by_membership_id UUID,
  p_accepted_by_user_id TEXT,
  p_accepted_at TIMESTAMPTZ,
  p_finished_at TIMESTAMPTZ,
  p_client_name_snapshot VARCHAR(240),
  p_client_phone_snapshot VARCHAR(40),
  p_assigned_member_name_snapshot VARCHAR(200),
  p_created_by_name_snapshot VARCHAR(200),
  p_idempotency_key VARCHAR(128),
  p_meta JSONB,
  p_created_at TIMESTAMPTZ,
  p_parts JSONB DEFAULT '[]'::jsonb,
  p_attachments JSONB DEFAULT '[]'::jsonb,
  p_consume_inventory BOOLEAN DEFAULT FALSE,
  p_consumer_membership_id UUID DEFAULT NULL,
  p_consume_parts JSONB DEFAULT '[]'::jsonb
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status public.job_status,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
  v_part RECORD;
  v_attachment RECORD;
BEGIN
  INSERT INTO jobs (
    company_id,
    job_no,
    status,
    title,
    description,
    notes,
    location,
    address,
    category,
    priority,
    due_at,
    client_id,
    assigned_membership_id,
    created_by_membership_id,
    accepted_by_user_id,
    accepted_at,
    finished_at,
    client_name_snapshot,
    client_phone_snapshot,
    assigned_member_name_snapshot,
    created_by_name_snapshot,
    idempotency_key,
    meta,
    created_at,
    updated_at
  ) VALUES (
    p_company_id,
    p_job_no,
    p_status,
    p_title,
    p_description,
    p_notes,
    p_location,
    p_address,
    p_category,
    p_priority,
    p_due_at,
    p_client_id,
    p_assigned_membership_id,
    p_created_by_membership_id,
    p_accepted_by_user_id,
    p_accepted_at,
    p_finished_at,
    p_client_name_snapshot,
    p_client_phone_snapshot,
    p_assigned_member_name_snapshot,
    p_created_by_name_snapshot,
    p_idempotency_key,
    COALESCE(p_meta, '{}'::jsonb),
    p_created_at,
    p_created_at
  )
  RETURNING id INTO v_job_id;

  IF p_parts IS NOT NULL AND jsonb_typeof(p_parts) = 'array' AND jsonb_array_length(p_parts) > 0 THEN
    FOR v_part IN
      SELECT *
      FROM jsonb_to_recordset(p_parts) AS part(
        inventory_part_id UUID,
        part_name_snapshot VARCHAR(240),
        quantity NUMERIC
      )
    LOOP
      INSERT INTO job_part_usages (
        job_id,
        inventory_part_id,
        part_name_snapshot,
        quantity,
        created_at
      ) VALUES (
        v_job_id,
        v_part.inventory_part_id,
        v_part.part_name_snapshot,
        v_part.quantity,
        p_created_at
      );
    END LOOP;
  END IF;

  IF p_attachments IS NOT NULL AND jsonb_typeof(p_attachments) = 'array' AND jsonb_array_length(p_attachments) > 0 THEN
    FOR v_attachment IN
      SELECT *
      FROM jsonb_to_recordset(p_attachments) AS attachment(
        storage_path VARCHAR(1024),
        kind public.job_attachment_kind,
        uploaded_by_user_id TEXT
      )
    LOOP
      INSERT INTO job_attachments (
        job_id,
        storage_path,
        kind,
        uploaded_by_user_id,
        created_at
      ) VALUES (
        v_job_id,
        v_attachment.storage_path,
        v_attachment.kind,
        v_attachment.uploaded_by_user_id,
        p_created_at
      );
    END LOOP;
  END IF;

  IF p_consume_inventory AND p_status = 'finished' AND p_consumer_membership_id IS NOT NULL AND p_consume_parts IS NOT NULL THEN
    PERFORM *
    FROM private.apply_job_inventory_consumption_batch(
      p_company_id,
      p_consumer_membership_id,
      v_job_id,
      p_created_by_membership_id,
      p_consume_parts,
      p_created_at
    );
  END IF;

  RETURN QUERY
  SELECT
    j.id,
    j.job_no,
    j.status,
    j.created_at,
    j.updated_at
  FROM jobs j
  WHERE j.id = v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_job_with_details(
  p_company_id UUID,
  p_job_no INTEGER,
  p_status public.job_status,
  p_title VARCHAR(240),
  p_description TEXT,
  p_notes TEXT,
  p_location VARCHAR(240),
  p_address VARCHAR(500),
  p_category VARCHAR(120),
  p_priority VARCHAR(40),
  p_due_at TIMESTAMPTZ,
  p_client_id UUID,
  p_assigned_membership_id UUID,
  p_created_by_membership_id UUID,
  p_accepted_by_user_id TEXT,
  p_accepted_at TIMESTAMPTZ,
  p_finished_at TIMESTAMPTZ,
  p_client_name_snapshot VARCHAR(240),
  p_client_phone_snapshot VARCHAR(40),
  p_assigned_member_name_snapshot VARCHAR(200),
  p_created_by_name_snapshot VARCHAR(200),
  p_idempotency_key VARCHAR(128),
  p_meta JSONB,
  p_created_at TIMESTAMPTZ,
  p_parts JSONB DEFAULT '[]'::jsonb,
  p_attachments JSONB DEFAULT '[]'::jsonb,
  p_consume_inventory BOOLEAN DEFAULT FALSE,
  p_consumer_membership_id UUID DEFAULT NULL,
  p_consume_parts JSONB DEFAULT '[]'::jsonb
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status public.job_status,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT *
  FROM private.create_job_with_details(
    p_company_id,
    p_job_no,
    p_status,
    p_title,
    p_description,
    p_notes,
    p_location,
    p_address,
    p_category,
    p_priority,
    p_due_at,
    p_client_id,
    p_assigned_membership_id,
    p_created_by_membership_id,
    p_accepted_by_user_id,
    p_accepted_at,
    p_finished_at,
    p_client_name_snapshot,
    p_client_phone_snapshot,
    p_assigned_member_name_snapshot,
    p_created_by_name_snapshot,
    p_idempotency_key,
    p_meta,
    p_created_at,
    p_parts,
    p_attachments,
    p_consume_inventory,
    p_consumer_membership_id,
    p_consume_parts
  );
$$;

-- ============================================================================
-- Consolidated source: 0004_phase1_atomic_business_registration.sql
-- ============================================================================
-- Phase 1: atomic business registration.
-- Replaces the edge handler's multi-step company onboarding with a single transaction.

CREATE OR REPLACE FUNCTION private.register_business_account(
  p_public_company_id INTEGER,
  p_account_type public.account_type,
  p_created_by_user_id TEXT,
  p_he_name VARCHAR(200),
  p_en_name VARCHAR(200),
  p_vat_number VARCHAR(50),
  p_business_type VARCHAR(120),
  p_city VARCHAR(120),
  p_address VARCHAR(500),
  p_business_email VARCHAR(320),
  p_business_phone VARCHAR(40),
  p_business_fax VARCHAR(40),
  p_accountant_name VARCHAR(200),
  p_accountant_email VARCHAR(320),
  p_accountant_phone VARCHAR(40),
  p_tier TEXT,
  p_enabled_modules JSONB,
  p_user_id TEXT,
  p_role TEXT,
  p_display_name VARCHAR(200),
  p_phone_number VARCHAR(40),
  p_created_at TIMESTAMPTZ
) RETURNS TABLE (
  company_id UUID,
  public_company_id BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_member_no INTEGER;
BEGIN
  INSERT INTO companies (
    public_company_id,
    account_type,
    status,
    created_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    p_public_company_id,
    p_account_type,
    'active',
    p_created_by_user_id,
    p_created_at,
    p_created_at
  )
  RETURNING id INTO v_company_id;

  INSERT INTO company_profiles (
    company_id,
    he_name,
    en_name,
    vat_number,
    business_type,
    city,
    address,
    business_email,
    business_phone,
    business_fax,
    accountant_name,
    accountant_email,
    accountant_phone,
    registered_at,
    registered_by_user_id,
    last_updated_at
  ) VALUES (
    v_company_id,
    p_he_name,
    p_en_name,
    p_vat_number,
    p_business_type,
    p_city,
    p_address,
    p_business_email,
    p_business_phone,
    p_business_fax,
    p_accountant_name,
    p_accountant_email,
    p_accountant_phone,
    p_created_at,
    p_created_by_user_id,
    p_created_at
  );

  INSERT INTO company_subscriptions (
    company_id,
    tier,
    status,
    enabled_modules,
    updated_at
  ) VALUES (
    v_company_id,
    p_tier::public.subscription_tier,
    'active',
    COALESCE(p_enabled_modules, '{}'::jsonb),
    p_created_at
  );

  INSERT INTO company_sync_state (
    company_id,
    jobs_version,
    documents_version,
    clients_version,
    workers_version,
    company_inventory_version,
    updated_at
  ) VALUES (
    v_company_id,
    0,
    0,
    0,
    1,
    0,
    p_created_at
  );

  SELECT private.allocate_company_counter(v_company_id, 'member_no')
  INTO v_member_no;

  INSERT INTO company_memberships (
    company_id,
    user_id,
    member_no,
    role,
    status,
    display_name,
    phone_number,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    v_company_id,
    p_user_id,
    v_member_no,
    p_role::public.membership_role,
    'active',
    p_display_name,
    p_phone_number,
    p_created_at,
    p_created_at,
    p_created_at
  );

  RETURN QUERY
  SELECT
    c.id,
    c.public_company_id
  FROM companies c
  WHERE c.id = v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_business_account(
  p_public_company_id INTEGER,
  p_account_type public.account_type,
  p_created_by_user_id TEXT,
  p_he_name VARCHAR(200),
  p_en_name VARCHAR(200),
  p_vat_number VARCHAR(50),
  p_business_type VARCHAR(120),
  p_city VARCHAR(120),
  p_address VARCHAR(500),
  p_business_email VARCHAR(320),
  p_business_phone VARCHAR(40),
  p_business_fax VARCHAR(40),
  p_accountant_name VARCHAR(200),
  p_accountant_email VARCHAR(320),
  p_accountant_phone VARCHAR(40),
  p_tier TEXT,
  p_enabled_modules JSONB,
  p_user_id TEXT,
  p_role TEXT,
  p_display_name VARCHAR(200),
  p_phone_number VARCHAR(40),
  p_created_at TIMESTAMPTZ
) RETURNS TABLE (
  company_id UUID,
  public_company_id BIGINT
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT *
  FROM private.register_business_account(
    p_public_company_id,
    p_account_type,
    p_created_by_user_id,
    p_he_name,
    p_en_name,
    p_vat_number,
    p_business_type,
    p_city,
    p_address,
    p_business_email,
    p_business_phone,
    p_business_fax,
    p_accountant_name,
    p_accountant_email,
    p_accountant_phone,
    p_tier,
    p_enabled_modules,
    p_user_id,
    p_role,
    p_display_name,
    p_phone_number,
    p_created_at
  );
$$;

-- ============================================================================
-- Consolidated source: 0005_phase2_trigger_search_path.sql
-- ============================================================================
-- Phase 2: add explicit search_path to security-sensitive functions that lacked it.

CREATE OR REPLACE FUNCTION public.app_auth_uid()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '');
$$;

CREATE OR REPLACE FUNCTION public.prevent_company_profile_vat_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.vat_number IS NOT NULL AND NEW.vat_number IS DISTINCT FROM OLD.vat_number THEN
    RAISE EXCEPTION 'vat_number is immutable after initial set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_document_number_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.document_number > 0 AND NEW.document_number IS DISTINCT FROM OLD.document_number THEN
    RAISE EXCEPTION 'document_number is immutable once assigned';
  END IF;
  IF OLD.document_number > 0 AND NEW.document_code IS DISTINCT FROM OLD.document_code THEN
    RAISE EXCEPTION 'document_code is immutable once assigned';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- Consolidated source: 0006_api_security_foundation.sql
-- ============================================================================
-- Stage 2 API security foundation.
--
-- The Cloud Run API connects with a dedicated runtime role. It sets the verified
-- Supabase user id and bounded transaction timeouts before any tenant-scoped SQL.
-- Secrets remain encrypted by the API; Postgres stores only ciphertext and hashes.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smart_job_api') THEN
    CREATE ROLE smart_job_api
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END;
$$;

ALTER ROLE smart_job_api SET search_path = pg_catalog, public;
ALTER ROLE smart_job_api SET statement_timeout = '12s';
ALTER ROLE smart_job_api SET lock_timeout = '3s';
ALTER ROLE smart_job_api SET idle_in_transaction_session_timeout = '15s';

GRANT CONNECT ON DATABASE postgres TO smart_job_api;
GRANT USAGE ON SCHEMA public, private TO smart_job_api;
REVOKE CREATE ON SCHEMA public, private FROM smart_job_api;

-- PostgreSQL grants TEMPORARY to PUBLIC by default, and privileges inherited
-- through PUBLIC cannot be revoked from only one role. The API never needs temp
-- objects, so remove the ambient grant for this database. Database owners and
-- roles with an explicit TEMPORARY grant retain it.
DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC',
    pg_catalog.current_database()
  );
END;
$$;

-- The migration owner can assume the runtime role for local integration tests and
-- production diagnostics. This does not add capabilities to the migration owner.
GRANT smart_job_api TO postgres;

ALTER TABLE public.jobs
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT jobs_entity_version_positive_check CHECK (entity_version > 0);

CREATE OR REPLACE FUNCTION private.increment_job_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER jobs_increment_entity_version
BEFORE UPDATE ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION private.increment_job_entity_version();

CREATE TABLE private.web_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash BYTEA NOT NULL,
  csrf_token_hash BYTEA NOT NULL,
  user_id UUID NOT NULL,
  supabase_session_id UUID NOT NULL,
  credentials_ciphertext BYTEA NOT NULL,
  credentials_iv BYTEA NOT NULL,
  credentials_auth_tag BYTEA NOT NULL,
  encryption_key_version TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  last_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  CONSTRAINT web_sessions_token_hash_length_check
    CHECK (octet_length(session_token_hash) = 32),
  CONSTRAINT web_sessions_csrf_hash_length_check
    CHECK (octet_length(csrf_token_hash) = 32),
  CONSTRAINT web_sessions_credentials_present_check
    CHECK (octet_length(credentials_ciphertext) > 0),
  CONSTRAINT web_sessions_credentials_iv_length_check
    CHECK (octet_length(credentials_iv) = 12),
  CONSTRAINT web_sessions_credentials_auth_tag_length_check
    CHECK (octet_length(credentials_auth_tag) = 16),
  CONSTRAINT web_sessions_key_version_present_check
    CHECK (btrim(encryption_key_version) <> ''),
  CONSTRAINT web_sessions_absolute_lifetime_check
    CHECK (
      absolute_expires_at > created_at
      AND absolute_expires_at <= created_at + interval '12 hours'
    ),
  CONSTRAINT web_sessions_valid_revocation_check
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX web_sessions_token_hash_unique
  ON private.web_sessions (session_token_hash);
CREATE INDEX web_sessions_active_user_expiry_idx
  ON private.web_sessions (user_id, absolute_expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX web_sessions_expiry_idx
  ON private.web_sessions (absolute_expires_at);
CREATE INDEX web_sessions_last_company_idx
  ON private.web_sessions (last_company_id);

CREATE TABLE private.api_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  operation VARCHAR(128) NOT NULL,
  idempotency_key_hash BYTEA NOT NULL,
  request_hash BYTEA NOT NULL,
  response_status SMALLINT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT api_idempotency_key_hash_length_check
    CHECK (octet_length(idempotency_key_hash) = 32),
  CONSTRAINT api_idempotency_request_hash_length_check
    CHECK (octet_length(request_hash) = 32),
  CONSTRAINT api_idempotency_operation_present_check
    CHECK (btrim(operation) <> ''),
  CONSTRAINT api_idempotency_valid_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT api_idempotency_completed_response_check
    CHECK (
      (
        completed_at IS NULL
        AND response_status IS NULL
        AND response_body IS NULL
      )
      OR (
        completed_at IS NOT NULL
        AND response_status BETWEEN 100 AND 599
        AND response_body IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX api_idempotency_tenant_key_unique
  ON private.api_idempotency (
    user_id,
    company_id,
    operation,
    idempotency_key_hash
  )
  WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX api_idempotency_global_key_unique
  ON private.api_idempotency (user_id, operation, idempotency_key_hash)
  WHERE company_id IS NULL;
CREATE INDEX api_idempotency_expiry_idx
  ON private.api_idempotency (expires_at);

CREATE TABLE private.file_upload_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  purpose VARCHAR(64) NOT NULL,
  target_job_id UUID REFERENCES public.jobs(id) ON DELETE RESTRICT,
  bucket_id TEXT NOT NULL,
  object_prefix TEXT NOT NULL,
  expected_manifest JSONB NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  cleanup_lease_expires_at TIMESTAMPTZ,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  last_cleanup_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT file_upload_sessions_purpose_check
    CHECK (purpose IN ('job.create_finished', 'job.complete_assigned')),
  CONSTRAINT file_upload_sessions_status_check
    CHECK (
      status IN (
        'pending',
        'consumed',
        'cleanup_pending',
        'cleanup_claimed',
        'cleanup_complete'
      )
    ),
  CONSTRAINT file_upload_sessions_manifest_shape_check
    CHECK (
      jsonb_typeof(expected_manifest) = 'array'
      AND jsonb_array_length(expected_manifest) BETWEEN 1 AND 20
    ),
  CONSTRAINT file_upload_sessions_valid_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT file_upload_sessions_completion_target_check
    CHECK (purpose <> 'job.complete_assigned' OR target_job_id IS NOT NULL),
  CONSTRAINT file_upload_sessions_consumption_state_check
    CHECK (
      (
        status = 'consumed'
        AND consumed_at IS NOT NULL
        AND consumed_by_job_id IS NOT NULL
      )
      OR (
        status <> 'consumed'
        AND consumed_at IS NULL
        AND consumed_by_job_id IS NULL
      )
    ),
  CONSTRAINT file_upload_sessions_cleanup_attempts_non_negative_check
    CHECK (cleanup_attempts >= 0),
  CONSTRAINT file_upload_sessions_bucket_present_check
    CHECK (btrim(bucket_id) <> ''),
  CONSTRAINT file_upload_sessions_prefix_present_check
    CHECK (btrim(object_prefix) <> '')
);

CREATE INDEX file_upload_sessions_pending_owner_expiry_idx
  ON private.file_upload_sessions (user_id, company_id, expires_at)
  WHERE status = 'pending';
CREATE INDEX file_upload_sessions_cleanup_queue_idx
  ON private.file_upload_sessions (status, cleanup_lease_expires_at, expires_at);
CREATE INDEX file_upload_sessions_target_job_idx
  ON private.file_upload_sessions (company_id, target_job_id)
  WHERE target_job_id IS NOT NULL;

ALTER TABLE private.api_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.api_idempotency FORCE ROW LEVEL SECURITY;
ALTER TABLE private.file_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.file_upload_sessions FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.set_api_request_context(
  p_user_id UUID,
  p_statement_timeout_ms INTEGER DEFAULT 12000,
  p_lock_timeout_ms INTEGER DEFAULT 3000,
  p_idle_transaction_timeout_ms INTEGER DEFAULT 15000
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'api_context_user_required';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM pg_catalog.set_config(
    'statement_timeout',
    LEAST(GREATEST(COALESCE(p_statement_timeout_ms, 12000), 1000), 12000)::text || 'ms',
    true
  );
  PERFORM pg_catalog.set_config(
    'lock_timeout',
    LEAST(GREATEST(COALESCE(p_lock_timeout_ms, 3000), 250), 3000)::text || 'ms',
    true
  );
  PERFORM pg_catalog.set_config(
    'idle_in_transaction_session_timeout',
    LEAST(GREATEST(COALESCE(p_idle_transaction_timeout_ms, 15000), 1000), 15000)::text || 'ms',
    true
  );
END;
$$;

-- The legacy membership policy queried company_memberships from inside its own
-- policy, which recursed for every non-bypass role. Keep the same visibility rule
-- behind a SECURITY DEFINER helper so policy evaluation never re-enters itself.
CREATE OR REPLACE FUNCTION private.app_is_company_manager(
  target_company_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.app_is_dev()
    OR EXISTS (
      SELECT 1
      FROM public.company_memberships membership
      WHERE membership.company_id = target_company_id
        AND membership.user_id = private.app_auth_uid()
        AND membership.status = 'active'
        AND membership.role = 'manager'
    );
$$;

ALTER POLICY company_memberships_company_read_policy
ON public.company_memberships
USING (
  user_id = private.app_auth_uid()
  OR private.app_is_company_manager(company_id)
);

CREATE POLICY api_idempotency_owner_policy
ON private.api_idempotency
FOR ALL
TO smart_job_api
USING (
  user_id::text = private.app_auth_uid()
  AND (company_id IS NULL OR private.app_has_company_access(company_id))
)
WITH CHECK (
  user_id::text = private.app_auth_uid()
  AND (company_id IS NULL OR private.app_has_company_access(company_id))
);

CREATE POLICY file_upload_sessions_owner_policy
ON private.file_upload_sessions
FOR ALL
TO smart_job_api
USING (
  user_id::text = private.app_auth_uid()
  AND private.app_has_company_access(company_id)
)
WITH CHECK (
  user_id::text = private.app_auth_uid()
  AND private.app_has_company_access(company_id)
);

CREATE POLICY app_users_api_self_read
ON public.app_users
FOR SELECT
TO smart_job_api
USING (id = private.app_auth_uid() OR private.app_is_dev());

CREATE POLICY companies_api_membership_read
ON public.companies
FOR SELECT
TO smart_job_api
USING (private.app_has_company_access(id));

-- API-owned private state. Web sessions intentionally do not use RLS because an
-- opaque session token must be resolved before a user context exists.
GRANT SELECT, INSERT, UPDATE, DELETE ON private.web_sessions TO smart_job_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON private.api_idempotency TO smart_job_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON private.file_upload_sessions TO smart_job_api;

GRANT SELECT ON
  public.app_users,
  public.companies,
  public.company_profiles,
  public.company_subscriptions,
  public.company_sync_state,
  public.company_memberships,
  public.clients,
  public.jobs,
  public.job_attachments,
  public.job_part_usages,
  public.inventory_locations,
  public.inventory_parts,
  public.inventory_balances,
  public.inventory_movements,
  public.documents,
  public.document_items,
  public.document_job_links,
  public.proposal_usage,
  public.company_invites,
  public.document_tasks,
  public.support_conversations,
  public.support_messages
TO smart_job_api;

-- The runtime role never calls public compatibility RPCs. Revoke ambient PUBLIC
-- execution so its effective privileges are only the private functions granted below.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM smart_job_api;

REVOKE EXECUTE ON FUNCTION private.increment_job_entity_version() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.set_api_request_context(UUID, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.app_is_company_manager(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.set_api_request_context(UUID, INTEGER, INTEGER, INTEGER) TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.app_auth_uid() TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.app_is_dev() TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.app_has_company_access(UUID) TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.app_is_company_manager(UUID) TO smart_job_api;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION private.app_is_company_manager(UUID) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION private.app_is_company_manager(UUID) TO service_role;
  END IF;
END;
$$;

-- The completion RPC reaches these legacy inventory/sync helpers. They were
-- originally SECURITY DEFINER functions with search_path=public and unqualified
-- relations. Harden the complete call chain before exposing it to smart_job_api,
-- so a session-local temporary relation cannot shadow an ERP table.
CREATE OR REPLACE FUNCTION private.apply_inventory_movement(
  p_company_id UUID,
  p_part_id UUID,
  p_quantity NUMERIC,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_movement_type public.inventory_movement_type,
  p_created_by_membership_id UUID,
  p_job_id UUID DEFAULT NULL,
  p_document_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT pg_catalog.now()
) RETURNS TABLE (
  movement_id UUID,
  from_quantity NUMERIC,
  to_quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from_quantity NUMERIC := NULL;
  v_to_quantity NUMERIC := NULL;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'inventory_invalid_quantity';
  END IF;

  IF p_from_location_id IS NULL AND p_to_location_id IS NULL THEN
    RAISE EXCEPTION 'inventory_missing_location';
  END IF;

  IF p_from_location_id IS NOT NULL THEN
    INSERT INTO public.inventory_balances AS balance (
      location_id,
      part_id,
      quantity_on_hand,
      updated_at
    ) VALUES (
      p_from_location_id,
      p_part_id,
      0,
      p_created_at
    )
    ON CONFLICT (location_id, part_id) DO NOTHING;

    UPDATE public.inventory_balances AS balance
    SET quantity_on_hand = balance.quantity_on_hand - p_quantity,
        updated_at = p_created_at
    WHERE balance.location_id = p_from_location_id
      AND balance.part_id = p_part_id
      AND balance.quantity_on_hand >= p_quantity
    RETURNING balance.quantity_on_hand INTO v_from_quantity;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'inventory_insufficient_stock';
    END IF;
  END IF;

  IF p_to_location_id IS NOT NULL THEN
    INSERT INTO public.inventory_balances AS balance (
      location_id,
      part_id,
      quantity_on_hand,
      updated_at
    ) VALUES (
      p_to_location_id,
      p_part_id,
      p_quantity,
      p_created_at
    )
    ON CONFLICT (location_id, part_id) DO UPDATE
      SET quantity_on_hand = balance.quantity_on_hand + EXCLUDED.quantity_on_hand,
          updated_at = EXCLUDED.updated_at
    RETURNING balance.quantity_on_hand INTO v_to_quantity;
  END IF;

  INSERT INTO public.inventory_movements AS movement (
    company_id,
    part_id,
    quantity,
    from_location_id,
    to_location_id,
    movement_type,
    job_id,
    document_id,
    created_by_membership_id,
    note,
    created_at
  ) VALUES (
    p_company_id,
    p_part_id,
    p_quantity,
    p_from_location_id,
    p_to_location_id,
    p_movement_type,
    p_job_id,
    p_document_id,
    p_created_by_membership_id,
    p_note,
    p_created_at
  ) RETURNING movement.id INTO movement_id;

  from_quantity := v_from_quantity;
  to_quantity := v_to_quantity;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION private.apply_job_inventory_consumption_batch(
  p_company_id UUID,
  p_membership_id UUID,
  p_job_id UUID,
  p_created_by_membership_id UUID,
  p_parts JSONB,
  p_created_at TIMESTAMPTZ DEFAULT pg_catalog.now()
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from_location_id UUID;
  v_consumed_location_id UUID;
  v_pick RECORD;
  v_part RECORD;
  v_movement RECORD;
BEGIN
  IF p_parts IS NULL
    OR pg_catalog.jsonb_typeof(p_parts) <> 'array'
    OR pg_catalog.jsonb_array_length(p_parts) = 0 THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.jobs AS job
    WHERE job.id = p_job_id
      AND job.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'inventory_job_not_found';
  END IF;

  SELECT location.id
  INTO v_from_location_id
  FROM public.inventory_locations AS location
  WHERE location.company_id = p_company_id
    AND location.location_type = 'member'
    AND location.membership_id = p_membership_id
  LIMIT 1;

  IF v_from_location_id IS NULL THEN
    RAISE EXCEPTION 'inventory_member_location_missing';
  END IF;

  INSERT INTO public.inventory_locations AS location (
    company_id,
    location_type,
    membership_id,
    name,
    created_at
  ) VALUES (
    p_company_id,
    'consumed',
    NULL,
    'Consumed Inventory',
    p_created_at
  )
  ON CONFLICT DO NOTHING;

  SELECT location.id
  INTO v_consumed_location_id
  FROM public.inventory_locations AS location
  WHERE location.company_id = p_company_id
    AND location.location_type = 'consumed'
    AND location.membership_id IS NULL
  LIMIT 1;

  IF v_consumed_location_id IS NULL THEN
    RAISE EXCEPTION 'inventory_consumed_location_missing';
  END IF;

  FOR v_pick IN
    SELECT parsed_part.*
    FROM pg_catalog.jsonb_to_recordset(p_parts) AS parsed_part(
      part_id UUID,
      part_no INTEGER,
      quantity NUMERIC
    )
  LOOP
    IF v_pick.part_id IS NULL OR v_pick.quantity IS NULL OR v_pick.quantity <= 0 THEN
      RAISE EXCEPTION 'inventory_invalid_consumption';
    END IF;

    SELECT inventory_part.id, inventory_part.part_no
    INTO v_part
    FROM public.inventory_parts AS inventory_part
    WHERE inventory_part.id = v_pick.part_id
      AND inventory_part.company_id = p_company_id
      AND inventory_part.archived_at IS NULL
    LIMIT 1;

    IF v_part.id IS NULL THEN
      RAISE EXCEPTION 'inventory_part_not_found';
    END IF;

    SELECT movement.*
    INTO v_movement
    FROM private.apply_inventory_movement(
      p_company_id,
      v_part.id,
      v_pick.quantity,
      v_from_location_id,
      v_consumed_location_id,
      'job_consumption'::public.inventory_movement_type,
      p_created_by_membership_id,
      p_job_id,
      NULL,
      'Consumed for job #' || COALESCE(v_pick.part_no::text, v_part.part_no::text, ''),
      p_created_at
    ) AS movement;

    movement_id := v_movement.movement_id;
    part_id := v_part.id;
    part_no := v_part.part_no;
    quantity := v_pick.quantity;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION private.bump_company_sync_version(
  p_company_id UUID,
  p_field TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

  INSERT INTO public.company_sync_state AS sync_state (
    company_id,
    jobs_version,
    documents_version,
    clients_version,
    workers_version,
    company_inventory_version,
    updated_at
  ) VALUES (
    p_company_id,
    CASE WHEN p_field = 'jobs_version' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'documents_version' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'clients_version' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'workers_version' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'company_inventory_version' THEN 1 ELSE 0 END,
    pg_catalog.now()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    jobs_version = CASE WHEN p_field = 'jobs_version'
      THEN sync_state.jobs_version + 1 ELSE sync_state.jobs_version END,
    documents_version = CASE WHEN p_field = 'documents_version'
      THEN sync_state.documents_version + 1 ELSE sync_state.documents_version END,
    clients_version = CASE WHEN p_field = 'clients_version'
      THEN sync_state.clients_version + 1 ELSE sync_state.clients_version END,
    workers_version = CASE WHEN p_field = 'workers_version'
      THEN sync_state.workers_version + 1 ELSE sync_state.workers_version END,
    company_inventory_version = CASE WHEN p_field = 'company_inventory_version'
      THEN sync_state.company_inventory_version + 1
      ELSE sync_state.company_inventory_version END,
    updated_at = pg_catalog.now();
END;
$$;

REVOKE EXECUTE ON FUNCTION private.apply_inventory_movement(
  UUID,
  UUID,
  NUMERIC,
  UUID,
  UUID,
  public.inventory_movement_type,
  UUID,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, smart_job_api;
REVOKE EXECUTE ON FUNCTION private.apply_job_inventory_consumption_batch(
  UUID,
  UUID,
  UUID,
  UUID,
  JSONB,
  TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, smart_job_api;
REVOKE EXECUTE ON FUNCTION private.bump_company_sync_version(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, smart_job_api;
GRANT EXECUTE ON FUNCTION private.apply_inventory_movement(
  UUID,
  UUID,
  NUMERIC,
  UUID,
  UUID,
  public.inventory_movement_type,
  UUID,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION private.apply_job_inventory_consumption_batch(
  UUID,
  UUID,
  UUID,
  UUID,
  JSONB,
  TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION private.bump_company_sync_version(UUID, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION private.get_company_module_entitlements(
  p_company_id UUID
) RETURNS TABLE (
  jobs_enabled BOOLEAN,
  clients_enabled BOOLEAN,
  inventory_enabled BOOLEAN,
  documents_enabled BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH subscription AS (
    SELECT
      company_subscription.tier::text AS tier,
      company_subscription.status::text AS status,
      company_subscription.enabled_modules,
      company_subscription.expires_at
    FROM public.company_subscriptions AS company_subscription
    WHERE company_subscription.company_id = p_company_id
    LIMIT 1
  ),
  entitlement_context AS (
    SELECT
      private.app_is_dev() AS is_dev,
      COALESCE(
        subscription.status IN ('active', 'trial')
        AND (
          subscription.expires_at IS NULL
          OR subscription.expires_at > pg_catalog.statement_timestamp()
        ),
        false
      ) AS subscription_active,
      subscription.tier,
      COALESCE(subscription.enabled_modules, '{}'::jsonb) AS enabled_modules
    FROM (SELECT 1) AS seed
    LEFT JOIN subscription ON true
  )
  SELECT
    entitlement_context.is_dev OR (
      entitlement_context.subscription_active
      AND CASE
        -- `solojob` is the canonical client module. `jobs` remains a
        -- transition-compatible override for registrations created by Edge.
        WHEN pg_catalog.jsonb_typeof(
          entitlement_context.enabled_modules -> 'solojob'
        ) = 'boolean'
          THEN (entitlement_context.enabled_modules ->> 'solojob')::boolean
        WHEN pg_catalog.jsonb_typeof(
          entitlement_context.enabled_modules -> 'jobs'
        ) = 'boolean'
          THEN (entitlement_context.enabled_modules ->> 'jobs')::boolean
        ELSE entitlement_context.tier IN ('Solo', 'Team', 'Enterprise')
      END
    ) AS jobs_enabled,
    entitlement_context.is_dev OR (
      entitlement_context.subscription_active
      AND CASE
        WHEN pg_catalog.jsonb_typeof(
          entitlement_context.enabled_modules -> 'clients'
        ) = 'boolean'
          THEN (entitlement_context.enabled_modules ->> 'clients')::boolean
        ELSE entitlement_context.tier IN ('Basic', 'Solo', 'Team', 'Enterprise')
      END
    ) AS clients_enabled,
    entitlement_context.is_dev OR (
      entitlement_context.subscription_active
      AND CASE
        WHEN pg_catalog.jsonb_typeof(
          entitlement_context.enabled_modules -> 'inventory'
        ) = 'boolean'
          THEN (entitlement_context.enabled_modules ->> 'inventory')::boolean
        ELSE entitlement_context.tier IN ('Solo', 'Team', 'Enterprise')
      END
    ) AS inventory_enabled,
    entitlement_context.is_dev OR (
      entitlement_context.subscription_active
      AND CASE
        WHEN pg_catalog.jsonb_typeof(
          entitlement_context.enabled_modules -> 'documents'
        ) = 'boolean'
          THEN (entitlement_context.enabled_modules ->> 'documents')::boolean
        ELSE entitlement_context.tier IN ('Basic', 'Solo', 'Team', 'Enterprise')
      END
    ) AS documents_enabled
  FROM entitlement_context;
$$;

REVOKE EXECUTE ON FUNCTION private.get_company_module_entitlements(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_company_module_entitlements(UUID)
  TO smart_job_api, service_role;

CREATE OR REPLACE FUNCTION private.complete_job_with_details(
  p_company_id UUID,
  p_job_id UUID,
  p_expected_entity_version BIGINT,
  p_details JSONB DEFAULT '{}'::jsonb,
  p_parts JSONB DEFAULT NULL,
  p_upload_session_id UUID DEFAULT NULL,
  p_completed_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status public.job_status,
  entity_version BIGINT,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_uid_text TEXT := private.app_auth_uid();
  v_details JSONB := COALESCE(p_details, '{}'::jsonb);
  v_job public.jobs%ROWTYPE;
  v_membership public.company_memberships%ROWTYPE;
  v_upload private.file_upload_sessions%ROWTYPE;
  v_is_dev BOOLEAN := false;
  v_jobs_enabled BOOLEAN := false;
  v_consumer_membership_id UUID;
  v_consumption_parts JSONB := '[]'::jsonb;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'AUTH_CONTEXT_REQUIRED';
  END IF;

  BEGIN
    v_uid := v_uid_text::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING
        ERRCODE = '28000',
        MESSAGE = 'AUTH_CONTEXT_INVALID';
  END;

  IF p_company_id IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMPANY_AND_JOB_REQUIRED';
  END IF;

  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ENTITY_VERSION_INVALID';
  END IF;

  IF p_completed_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMPLETED_AT_REQUIRED';
  END IF;

  SELECT private.app_is_dev()
  INTO v_is_dev;

  SELECT j.*
  INTO v_job
  FROM public.jobs j
  WHERE j.id = p_job_id
    AND j.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'JOB_NOT_FOUND';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM public.company_memberships membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid::text
    AND membership.status = 'active'
  ORDER BY membership.joined_at, membership.created_at, membership.id
  LIMIT 1;

  IF NOT FOUND AND NOT v_is_dev THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMPANY_MEMBERSHIP_REQUIRED';
  END IF;

  IF NOT v_is_dev THEN
    IF v_membership.role = 'basic' THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'JOB_COMPLETION_FORBIDDEN';
    END IF;

    IF v_membership.role IN ('worker', 'user')
      AND v_job.assigned_membership_id IS DISTINCT FROM v_membership.id THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'JOB_NOT_ASSIGNED_TO_VIEWER';
    END IF;
  END IF;

  SELECT entitlement.jobs_enabled
  INTO v_jobs_enabled
  FROM private.get_company_module_entitlements(p_company_id) AS entitlement;

  IF NOT COALESCE(v_jobs_enabled, false) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'JOBS_MODULE_DISABLED';
  END IF;

  IF v_job.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'ENTITY_VERSION_CONFLICT',
      DETAIL = format(
        'expected=%s actual=%s',
        p_expected_entity_version,
        v_job.entity_version
      );
  END IF;

  IF v_job.status NOT IN ('pending', 'waiting') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'JOB_NOT_COMPLETABLE';
  END IF;

  IF jsonb_typeof(v_details) <> 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'JOB_DETAILS_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(v_details) AS detail_key(key)
    WHERE detail_key.key <> ALL (
      ARRAY['timeFrom', 'timeTo', 'signingPerson', 'travelDistance']::text[]
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'JOB_DETAILS_UNKNOWN_FIELD';
  END IF;

  IF v_details ? 'timeFrom'
    AND jsonb_typeof(v_details -> 'timeFrom') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_FROM_INVALID';
  END IF;
  IF v_details ? 'timeTo'
    AND jsonb_typeof(v_details -> 'timeTo') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_TO_INVALID';
  END IF;
  IF v_details ? 'signingPerson'
    AND jsonb_typeof(v_details -> 'signingPerson') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SIGNING_PERSON_INVALID';
  END IF;
  IF v_details ? 'travelDistance'
    AND jsonb_typeof(v_details -> 'travelDistance') NOT IN ('number', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRAVEL_DISTANCE_INVALID';
  END IF;

  IF COALESCE(v_details ->> 'timeFrom', '') <> ''
    AND (v_details ->> 'timeFrom') !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_FROM_INVALID';
  END IF;
  IF COALESCE(v_details ->> 'timeTo', '') <> ''
    AND (v_details ->> 'timeTo') !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_TO_INVALID';
  END IF;
  IF COALESCE(v_details ->> 'timeFrom', '') <> ''
    AND COALESCE(v_details ->> 'timeTo', '') <> ''
    AND (v_details ->> 'timeTo')::time < (v_details ->> 'timeFrom')::time THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_RANGE_INVALID';
  END IF;
  IF jsonb_typeof(v_details -> 'signingPerson') = 'string'
    AND (
      char_length(btrim(v_details ->> 'signingPerson')) < 1
      OR char_length(v_details ->> 'signingPerson') > 200
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SIGNING_PERSON_INVALID';
  END IF;
  IF jsonb_typeof(v_details -> 'travelDistance') = 'number'
    AND (v_details ->> 'travelDistance')::numeric < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRAVEL_DISTANCE_INVALID';
  END IF;

  IF p_parts IS NOT NULL THEN
    IF jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) > 500 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PARTS_INVALID';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_parts) AS part(item)
      WHERE jsonb_typeof(part.item) <> 'object'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PART_INVALID';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_parts) AS part(item)
      WHERE NOT (part.item ? 'partId' AND part.item ? 'quantity')
        OR EXISTS (
          SELECT 1
          FROM jsonb_object_keys(part.item) AS field(key)
          WHERE field.key <> ALL (ARRAY['partId', 'quantity']::text[])
        )
        OR jsonb_typeof(part.item -> 'partId') <> 'number'
        OR jsonb_typeof(part.item -> 'quantity') <> 'number'
        OR (part.item ->> 'partId') !~ '^[1-9][0-9]*$'
        OR (part.item ->> 'partId')::numeric > 2147483647
        OR (part.item ->> 'quantity')::numeric <= 0
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PART_INVALID';
    END IF;

    IF (
      SELECT count(*)
      FROM jsonb_array_elements(p_parts)
    ) <> (
      SELECT count(DISTINCT (part.item ->> 'partId')::integer)
      FROM jsonb_array_elements(p_parts) AS part(item)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PART_DUPLICATE';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_parts) AS part(item)
      LEFT JOIN public.inventory_parts inventory_part
        ON inventory_part.company_id = p_company_id
       AND inventory_part.part_no = (part.item ->> 'partId')::integer
       AND inventory_part.active
       AND inventory_part.archived_at IS NULL
      WHERE inventory_part.id IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
    END IF;

    DELETE FROM public.job_part_usages AS usage_to_replace
    WHERE usage_to_replace.job_id = p_job_id;

    INSERT INTO public.job_part_usages (
      job_id,
      inventory_part_id,
      part_name_snapshot,
      quantity,
      created_at
    )
    SELECT
      p_job_id,
      inventory_part.id,
      inventory_part.name,
      (part.item ->> 'quantity')::numeric,
      p_completed_at
    FROM jsonb_array_elements(p_parts) AS part(item)
    INNER JOIN public.inventory_parts inventory_part
      ON inventory_part.company_id = p_company_id
     AND inventory_part.part_no = (part.item ->> 'partId')::integer
     AND inventory_part.active
     AND inventory_part.archived_at IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.job_part_usages usage
    LEFT JOIN public.inventory_parts inventory_part
      ON inventory_part.id = usage.inventory_part_id
     AND inventory_part.company_id = p_company_id
     AND inventory_part.active
     AND inventory_part.archived_at IS NULL
    WHERE usage.job_id = p_job_id
      AND inventory_part.id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'part_id', inventory_part.id,
        'part_no', inventory_part.part_no,
        'quantity', usage.quantity
      )
      ORDER BY inventory_part.part_no, inventory_part.id
    ),
    '[]'::jsonb
  )
  INTO v_consumption_parts
  FROM public.job_part_usages usage
  INNER JOIN public.inventory_parts inventory_part
    ON inventory_part.id = usage.inventory_part_id
   AND inventory_part.company_id = p_company_id
   AND inventory_part.active
   AND inventory_part.archived_at IS NULL
  WHERE usage.job_id = p_job_id;

  IF p_upload_session_id IS NOT NULL THEN
    SELECT upload_session.*
    INTO v_upload
    FROM private.file_upload_sessions upload_session
    WHERE upload_session.id = p_upload_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPLOAD_SESSION_NOT_FOUND';
    END IF;
    IF v_upload.user_id <> v_uid
      OR v_upload.company_id <> p_company_id
      OR v_upload.purpose <> 'job.complete_assigned'
      OR v_upload.target_job_id IS DISTINCT FROM p_job_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPLOAD_SESSION_FORBIDDEN';
    END IF;
    IF v_upload.status <> 'pending' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_ALREADY_CONSUMED';
    END IF;
    IF v_upload.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_EXPIRED';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
      WHERE jsonb_typeof(attachment.item) <> 'object'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_INVALID';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
      WHERE NOT (
        attachment.item ? 'attachmentId'
        AND attachment.item ? 'kind'
        AND attachment.item ? 'fileName'
        AND attachment.item ? 'mimeType'
        AND attachment.item ? 'sizeBytes'
        AND attachment.item ? 'sha256'
        AND attachment.item ? 'objectPath'
      )
        OR EXISTS (
          SELECT 1
          FROM jsonb_object_keys(attachment.item) AS field(key)
          WHERE field.key <> ALL (
            ARRAY[
              'attachmentId',
              'kind',
              'fileName',
              'mimeType',
              'sizeBytes',
              'sha256',
              'objectPath'
            ]::text[]
          )
        )
        OR jsonb_typeof(attachment.item -> 'attachmentId') <> 'string'
        OR (attachment.item ->> 'attachmentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR jsonb_typeof(attachment.item -> 'kind') <> 'string'
        OR (attachment.item ->> 'kind') NOT IN ('photo', 'signature')
        OR jsonb_typeof(attachment.item -> 'fileName') <> 'string'
        OR char_length(btrim(attachment.item ->> 'fileName')) NOT BETWEEN 1 AND 255
        OR jsonb_typeof(attachment.item -> 'mimeType') <> 'string'
        OR char_length(btrim(attachment.item ->> 'mimeType')) NOT BETWEEN 1 AND 255
        OR jsonb_typeof(attachment.item -> 'sizeBytes') <> 'number'
        OR (attachment.item ->> 'sizeBytes')::numeric <= 0
        OR trunc((attachment.item ->> 'sizeBytes')::numeric) <> (attachment.item ->> 'sizeBytes')::numeric
        OR jsonb_typeof(attachment.item -> 'sha256') <> 'string'
        OR (attachment.item ->> 'sha256') !~* '^[0-9a-f]{64}$'
        OR jsonb_typeof(attachment.item -> 'objectPath') <> 'string'
        OR char_length(attachment.item ->> 'objectPath') NOT BETWEEN 1 AND 1024
        OR left(
          attachment.item ->> 'objectPath',
          char_length(v_upload.object_prefix) + 1
        ) <> v_upload.object_prefix || '/'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_INVALID';
    END IF;

    IF (
      SELECT count(*)
      FROM jsonb_array_elements(v_upload.expected_manifest)
    ) <> (
      SELECT count(DISTINCT attachment.item ->> 'attachmentId')
      FROM jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
    ) OR (
      SELECT count(*)
      FROM jsonb_array_elements(v_upload.expected_manifest)
    ) <> (
      SELECT count(DISTINCT attachment.item ->> 'objectPath')
      FROM jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_DUPLICATE';
    END IF;

    INSERT INTO public.job_attachments (
      id,
      job_id,
      storage_path,
      kind,
      uploaded_by_user_id,
      created_at
    )
    SELECT
      (attachment.item ->> 'attachmentId')::uuid,
      p_job_id,
      attachment.item ->> 'objectPath',
      (attachment.item ->> 'kind')::public.job_attachment_kind,
      v_uid::text,
      p_completed_at
    FROM jsonb_array_elements(v_upload.expected_manifest) AS attachment(item);

    UPDATE private.file_upload_sessions
    SET status = 'consumed',
        consumed_at = p_completed_at,
        consumed_by_job_id = p_job_id,
        updated_at = p_completed_at
    WHERE id = p_upload_session_id;
  END IF;

  UPDATE public.jobs
  SET status = 'finished',
      accepted_by_user_id = v_uid_text,
      accepted_at = p_completed_at,
      finished_at = p_completed_at,
      meta = COALESCE(meta, '{}'::jsonb) || v_details,
      updated_at = p_completed_at
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  IF jsonb_array_length(v_consumption_parts) > 0 THEN
    v_consumer_membership_id := COALESCE(
      v_job.assigned_membership_id,
      v_membership.id
    );

    IF v_consumer_membership_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'INVENTORY_CONSUMER_MEMBERSHIP_REQUIRED';
    END IF;

    PERFORM 1
    FROM private.apply_job_inventory_consumption_batch(
      p_company_id,
      v_consumer_membership_id,
      p_job_id,
      COALESCE(v_membership.id, v_job.created_by_membership_id),
      v_consumption_parts,
      p_completed_at
    );

    PERFORM private.bump_company_sync_version(
      p_company_id,
      'company_inventory_version'
    );
  END IF;

  PERFORM private.bump_company_sync_version(p_company_id, 'jobs_version');

  RETURN QUERY
  SELECT
    v_job.id,
    v_job.job_no,
    v_job.status,
    v_job.entity_version,
    v_job.finished_at,
    v_job.updated_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.complete_job_with_details(
  UUID,
  UUID,
  BIGINT,
  JSONB,
  JSONB,
  UUID,
  TIMESTAMPTZ
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.complete_job_with_details(
  UUID,
  UUID,
  BIGINT,
  JSONB,
  JSONB,
  UUID,
  TIMESTAMPTZ
) TO smart_job_api;

CREATE OR REPLACE FUNCTION private.cleanup_expired_operational_rows(
  p_now TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rate_limit_deleted INTEGER := 0;
  v_tax_idempotency_deleted INTEGER := 0;
  v_document_tasks_deleted INTEGER := 0;
  v_notifications_deleted INTEGER := 0;
  v_contact_requests_deleted INTEGER := 0;
  v_web_sessions_deleted INTEGER := 0;
  v_api_idempotency_deleted INTEGER := 0;
  v_upload_sessions_queued INTEGER := 0;
  v_upload_leases_requeued INTEGER := 0;
  v_upload_sessions_deleted INTEGER := 0;
BEGIN
  DELETE FROM public.rate_limit_buckets
  WHERE expire_at < p_now;
  GET DIAGNOSTICS v_rate_limit_deleted = ROW_COUNT;

  DELETE FROM public.tax_invoice_idempotency
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now
    AND status <> 'approved';
  GET DIAGNOSTICS v_tax_idempotency_deleted = ROW_COUNT;

  DELETE FROM public.document_tasks
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now
    AND status IN ('completed', 'failed');
  GET DIAGNOSTICS v_document_tasks_deleted = ROW_COUNT;

  DELETE FROM public.notification_deliveries
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now;
  GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;

  DELETE FROM public.contact_requests
  WHERE expire_at IS NOT NULL
    AND expire_at < p_now;
  GET DIAGNOSTICS v_contact_requests_deleted = ROW_COUNT;

  DELETE FROM private.web_sessions
  WHERE absolute_expires_at < p_now
    OR (revoked_at IS NOT NULL AND revoked_at < p_now - interval '7 days');
  GET DIAGNOSTICS v_web_sessions_deleted = ROW_COUNT;

  DELETE FROM private.api_idempotency
  WHERE expires_at < p_now;
  GET DIAGNOSTICS v_api_idempotency_deleted = ROW_COUNT;

  UPDATE private.file_upload_sessions
  SET status = 'cleanup_pending',
      cleanup_lease_expires_at = NULL,
      updated_at = p_now
  WHERE status = 'pending'
    AND expires_at < p_now;
  GET DIAGNOSTICS v_upload_sessions_queued = ROW_COUNT;

  UPDATE private.file_upload_sessions
  SET status = 'cleanup_pending',
      cleanup_lease_expires_at = NULL,
      updated_at = p_now
  WHERE status = 'cleanup_claimed'
    AND cleanup_lease_expires_at < p_now;
  GET DIAGNOSTICS v_upload_leases_requeued = ROW_COUNT;
  v_upload_sessions_queued := v_upload_sessions_queued + v_upload_leases_requeued;

  -- Object deletion is performed by the maintenance worker first. Only rows that
  -- reached cleanup_complete are removed here; pending manifests are never lost.
  DELETE FROM private.file_upload_sessions
  WHERE status = 'cleanup_complete'
    AND updated_at < p_now - interval '7 days';
  GET DIAGNOSTICS v_upload_sessions_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'rateLimitBuckets', v_rate_limit_deleted,
    'taxInvoiceIdempotency', v_tax_idempotency_deleted,
    'documentTasks', v_document_tasks_deleted,
    'notificationDeliveries', v_notifications_deleted,
    'contactRequests', v_contact_requests_deleted,
    'webSessions', v_web_sessions_deleted,
    'apiIdempotency', v_api_idempotency_deleted,
    'uploadSessionsQueued', v_upload_sessions_queued,
    'uploadSessionsDeleted', v_upload_sessions_deleted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_clients_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT NULL,
  p_after_client_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_clients_page(
    p_company_id,
    LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200),
    p_after_client_no,
    p_after_id,
    p_search
  );
$$;

CREATE OR REPLACE FUNCTION public.get_company_inventory_page(
  p_company_id UUID,
  p_page_size INTEGER DEFAULT NULL,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_company_inventory_page(
    p_company_id,
    LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200),
    p_after_part_no,
    p_after_id,
    p_search
  );
$$;

CREATE OR REPLACE FUNCTION public.get_member_inventory_page(
  p_company_id UUID,
  p_target_uid TEXT,
  p_page_size INTEGER DEFAULT NULL,
  p_after_part_no INTEGER DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_member_inventory_page(
    p_company_id,
    p_target_uid,
    LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200),
    p_after_part_no,
    p_after_id,
    p_search
  );
$$;

-- Migrations 0003 and 0004 created these functions after the earlier privilege
-- sweep. Repair them explicitly: Edge compatibility is service-role-only and the
-- new runtime role gets no access to payload-trusting legacy implementations.
DO $$
DECLARE
  function_record RECORD;
  has_anon BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_authenticated BOOLEAN := EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'
  );
  has_service_role BOOLEAN := EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'service_role'
  );
  function_identity TEXT;
BEGIN
  FOR function_record IN
    SELECT
      namespace.nspname AS schema_name,
      procedure.proname AS function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS arguments
    FROM pg_catalog.pg_proc procedure
    INNER JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname IN ('public', 'private')
      AND procedure.proname IN (
        'create_job_with_details',
        'register_business_account'
      )
  LOOP
    function_identity := format(
      '%I.%I(%s)',
      function_record.schema_name,
      function_record.function_name,
      function_record.arguments
    );

    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || function_identity || ' FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || function_identity || ' FROM smart_job_api';
    IF has_anon THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || function_identity || ' FROM anon';
    END IF;
    IF has_authenticated THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || function_identity || ' FROM authenticated';
    END IF;
    IF has_service_role THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || function_identity || ' TO service_role';
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.app_auth_uid() FROM PUBLIC, anon, authenticated, smart_job_api;
REVOKE EXECUTE ON FUNCTION public.prevent_company_profile_vat_update() FROM PUBLIC, anon, authenticated, smart_job_api;
REVOKE EXECUTE ON FUNCTION public.prevent_document_number_mutation() FROM PUBLIC, anon, authenticated, smart_job_api;
REVOKE EXECUTE ON FUNCTION private.cleanup_expired_operational_rows(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, smart_job_api;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ============================================================================
-- Consolidated source: 0007_api_job_creation_and_storage.sql
-- ============================================================================
-- API job creation and the canonical private company-file bucket.
-- All public identifiers are resolved inside the authenticated tenant and all
-- writes (counter, job details, inventory, attachments, upload consumption,
-- and sync versions) share the caller's transaction.

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
    'image/heif'
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

CREATE OR REPLACE FUNCTION private.create_api_job_with_details(
  p_company_id UUID,
  p_status public.job_status,
  p_title TEXT,
  p_description TEXT,
  p_location TEXT DEFAULT NULL,
  p_client_id TEXT DEFAULT NULL,
  p_assignee_member_no INTEGER DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb,
  p_parts JSONB DEFAULT NULL,
  p_upload_session_id UUID DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status public.job_status,
  entity_version BIGINT,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_uid_text TEXT := private.app_auth_uid();
  v_is_dev BOOLEAN := false;
  v_jobs_enabled BOOLEAN := false;
  v_membership public.company_memberships%ROWTYPE;
  v_effective_role TEXT;
  v_client public.clients%ROWTYPE;
  v_client_identifier TEXT := NULLIF(pg_catalog.btrim(p_client_id), '');
  v_assignee public.company_memberships%ROWTYPE;
  v_upload private.file_upload_sessions%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_job_no INTEGER;
  v_details JSONB := COALESCE(p_details, '{}'::jsonb);
  v_parts JSONB := COALESCE(p_parts, '[]'::jsonb);
  v_consumption_parts JSONB := '[]'::jsonb;
  v_created_by_name TEXT;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'AUTH_CONTEXT_REQUIRED';
  END IF;

  BEGIN
    v_uid := v_uid_text::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING
        ERRCODE = '28000',
        MESSAGE = 'AUTH_CONTEXT_INVALID';
  END;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_REQUIRED';
  END IF;
  IF p_created_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CREATED_AT_REQUIRED';
  END IF;

  PERFORM 1
  FROM public.companies AS company
  WHERE company.id = p_company_id
    AND company.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'COMPANY_NOT_FOUND';
  END IF;

  SELECT private.app_is_dev()
  INTO v_is_dev;

  SELECT membership.*
  INTO v_membership
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid::text
    AND membership.status = 'active'
  ORDER BY membership.joined_at, membership.created_at, membership.id
  LIMIT 1;

  IF v_membership.id IS NULL AND NOT v_is_dev THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMPANY_MEMBERSHIP_REQUIRED';
  END IF;

  v_effective_role := CASE
    WHEN v_is_dev THEN 'dev'
    ELSE v_membership.role::text
  END;

  IF v_effective_role NOT IN ('manager', 'user', 'dev') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'JOB_CREATION_FORBIDDEN';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('pending', 'finished') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'JOB_STATUS_INVALID';
  END IF;
  IF v_effective_role = 'user' AND p_status <> 'finished' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'SOLO_PENDING_JOB_FORBIDDEN';
  END IF;

  SELECT entitlement.jobs_enabled
  INTO v_jobs_enabled
  FROM private.get_company_module_entitlements(p_company_id) AS entitlement;
  IF NOT COALESCE(v_jobs_enabled, false) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'JOBS_MODULE_DISABLED';
  END IF;

  IF p_title IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_title)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_TITLE_INVALID';
  END IF;
  IF p_description IS NULL OR pg_catalog.char_length(p_description) > 10000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DESCRIPTION_INVALID';
  END IF;
  IF p_location IS NOT NULL
    AND pg_catalog.char_length(pg_catalog.btrim(p_location)) > 240 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_LOCATION_INVALID';
  END IF;

  IF pg_catalog.jsonb_typeof(v_details) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DETAILS_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(v_details) AS detail_key(key)
    WHERE detail_key.key <> ALL (
      ARRAY['timeFrom', 'timeTo', 'signingPerson', 'travelDistance']::text[]
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DETAILS_UNKNOWN_FIELD';
  END IF;
  IF v_details ? 'timeFrom'
    AND pg_catalog.jsonb_typeof(v_details -> 'timeFrom') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_FROM_INVALID';
  END IF;
  IF v_details ? 'timeTo'
    AND pg_catalog.jsonb_typeof(v_details -> 'timeTo') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_TO_INVALID';
  END IF;
  IF v_details ? 'signingPerson'
    AND pg_catalog.jsonb_typeof(v_details -> 'signingPerson') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SIGNING_PERSON_INVALID';
  END IF;
  IF v_details ? 'travelDistance'
    AND pg_catalog.jsonb_typeof(v_details -> 'travelDistance') NOT IN ('number', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRAVEL_DISTANCE_INVALID';
  END IF;
  IF pg_catalog.jsonb_typeof(v_details -> 'timeFrom') = 'string'
    AND (v_details ->> 'timeFrom') !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_FROM_INVALID';
  END IF;
  IF pg_catalog.jsonb_typeof(v_details -> 'timeTo') = 'string'
    AND (v_details ->> 'timeTo') !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_TO_INVALID';
  END IF;
  IF COALESCE(v_details ->> 'timeFrom', '') <> ''
    AND COALESCE(v_details ->> 'timeTo', '') <> ''
    AND (v_details ->> 'timeTo')::time < (v_details ->> 'timeFrom')::time THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TIME_RANGE_INVALID';
  END IF;
  IF pg_catalog.jsonb_typeof(v_details -> 'signingPerson') = 'string'
    AND (
      pg_catalog.char_length(pg_catalog.btrim(v_details ->> 'signingPerson')) < 1
      OR pg_catalog.char_length(v_details ->> 'signingPerson') > 200
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SIGNING_PERSON_INVALID';
  END IF;
  IF pg_catalog.jsonb_typeof(v_details -> 'travelDistance') = 'number'
    AND (
      (v_details ->> 'travelDistance')::numeric < 0
      OR (v_details ->> 'travelDistance')::numeric > 10000000
      OR pg_catalog.trunc((v_details ->> 'travelDistance')::numeric * 1000)
        <> (v_details ->> 'travelDistance')::numeric * 1000
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRAVEL_DISTANCE_INVALID';
  END IF;

  IF pg_catalog.jsonb_typeof(v_parts) <> 'array'
    OR pg_catalog.jsonb_array_length(v_parts) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PARTS_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_parts) AS part(item)
    WHERE pg_catalog.jsonb_typeof(part.item) <> 'object'
      OR NOT (part.item ? 'partId' AND part.item ? 'quantity')
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_object_keys(part.item) AS field(key)
        WHERE field.key <> ALL (ARRAY['partId', 'quantity']::text[])
      )
      OR pg_catalog.jsonb_typeof(part.item -> 'partId') <> 'number'
      OR pg_catalog.jsonb_typeof(part.item -> 'quantity') <> 'number'
      OR (part.item ->> 'partId') !~ '^[1-9][0-9]*$'
      OR (part.item ->> 'partId')::numeric > 2147483647
      OR (part.item ->> 'quantity')::numeric <= 0
      OR (part.item ->> 'quantity')::numeric > 99999999999.999
      OR pg_catalog.trunc((part.item ->> 'quantity')::numeric * 1000)
        <> (part.item ->> 'quantity')::numeric * 1000
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PART_INVALID';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.jsonb_array_elements(v_parts)
  ) <> (
    SELECT pg_catalog.count(DISTINCT (part.item ->> 'partId')::integer)
    FROM pg_catalog.jsonb_array_elements(v_parts) AS part(item)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PART_DUPLICATE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_parts) AS part(item)
    LEFT JOIN public.inventory_parts AS inventory_part
      ON inventory_part.company_id = p_company_id
     AND inventory_part.part_no = (part.item ->> 'partId')::integer
     AND inventory_part.active
     AND inventory_part.archived_at IS NULL
    WHERE inventory_part.id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;

  IF v_client_identifier IS NOT NULL THEN
    IF v_client_identifier ~ '^[1-9][0-9]*$' THEN
      IF pg_catalog.char_length(v_client_identifier) > 10
        OR v_client_identifier::numeric > 2147483647 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_ID_INVALID';
      END IF;
      SELECT client.*
      INTO v_client
      FROM public.clients AS client
      WHERE client.company_id = p_company_id
        AND client.client_no = v_client_identifier::integer
      LIMIT 1;
    ELSIF v_client_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT client.*
      INTO v_client
      FROM public.clients AS client
      WHERE client.company_id = p_company_id
        AND client.id = v_client_identifier::uuid
      LIMIT 1;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_ID_INVALID';
    END IF;
    IF v_client.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CLIENT_NOT_FOUND';
    END IF;
  END IF;

  IF v_effective_role = 'user' THEN
    IF p_assignee_member_no IS NOT NULL
      AND p_assignee_member_no <> v_membership.member_no THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'SOLO_ASSIGNEE_FORBIDDEN';
    END IF;
    v_assignee := v_membership;
  ELSIF p_assignee_member_no IS NOT NULL THEN
    IF p_assignee_member_no < 1 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ASSIGNEE_MEMBER_NO_INVALID';
    END IF;
    SELECT membership.*
    INTO v_assignee
    FROM public.company_memberships AS membership
    WHERE membership.company_id = p_company_id
      AND membership.member_no = p_assignee_member_no
      AND membership.status = 'active'
    LIMIT 1;
    IF v_assignee.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ASSIGNEE_NOT_FOUND';
    END IF;
  END IF;

  IF p_upload_session_id IS NOT NULL THEN
    IF p_status <> 'finished' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'UPLOAD_SESSION_REQUIRES_FINISHED_JOB';
    END IF;

    SELECT upload_session.*
    INTO v_upload
    FROM private.file_upload_sessions AS upload_session
    WHERE upload_session.id = p_upload_session_id
    FOR UPDATE;

    IF v_upload.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPLOAD_SESSION_NOT_FOUND';
    END IF;
    IF v_upload.user_id <> v_uid
      OR v_upload.company_id <> p_company_id
      OR v_upload.purpose <> 'job.create_finished'
      OR v_upload.target_job_id IS NOT NULL
      OR v_upload.bucket_id <> 'smart-job-company-files' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPLOAD_SESSION_FORBIDDEN';
    END IF;
    IF v_upload.status <> 'pending' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'UPLOAD_SESSION_ALREADY_CONSUMED';
    END IF;
    IF v_upload.expires_at <= pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_EXPIRED';
    END IF;

    IF pg_catalog.jsonb_typeof(v_upload.expected_manifest) <> 'array'
      OR pg_catalog.jsonb_array_length(v_upload.expected_manifest) NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_INVALID';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
      WHERE pg_catalog.jsonb_typeof(attachment.item) <> 'object'
        OR NOT (
          attachment.item ? 'attachmentId'
          AND attachment.item ? 'kind'
          AND attachment.item ? 'fileName'
          AND attachment.item ? 'mimeType'
          AND attachment.item ? 'sizeBytes'
          AND attachment.item ? 'sha256'
          AND attachment.item ? 'objectPath'
        )
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_object_keys(attachment.item) AS field(key)
          WHERE field.key <> ALL (
            ARRAY[
              'attachmentId',
              'kind',
              'fileName',
              'mimeType',
              'sizeBytes',
              'sha256',
              'objectPath'
            ]::text[]
          )
        )
        OR pg_catalog.jsonb_typeof(attachment.item -> 'attachmentId') <> 'string'
        OR (attachment.item ->> 'attachmentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR pg_catalog.jsonb_typeof(attachment.item -> 'kind') <> 'string'
        OR (attachment.item ->> 'kind') NOT IN ('photo', 'signature')
        OR pg_catalog.jsonb_typeof(attachment.item -> 'fileName') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(attachment.item ->> 'fileName')) NOT BETWEEN 1 AND 255
        OR pg_catalog.jsonb_typeof(attachment.item -> 'mimeType') <> 'string'
        OR (attachment.item ->> 'mimeType') NOT IN (
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/heic',
          'image/heif'
        )
        OR pg_catalog.jsonb_typeof(attachment.item -> 'sizeBytes') <> 'number'
        OR (attachment.item ->> 'sizeBytes') !~ '^[1-9][0-9]*$'
        OR (attachment.item ->> 'sizeBytes')::numeric > 10485760
        OR pg_catalog.jsonb_typeof(attachment.item -> 'sha256') <> 'string'
        OR (attachment.item ->> 'sha256') !~* '^[0-9a-f]{64}$'
        OR pg_catalog.jsonb_typeof(attachment.item -> 'objectPath') <> 'string'
        OR pg_catalog.char_length(attachment.item ->> 'objectPath') NOT BETWEEN 1 AND 1024
        OR pg_catalog.left(
          attachment.item ->> 'objectPath',
          pg_catalog.char_length(v_upload.object_prefix) + 1
        ) <> v_upload.object_prefix || '/'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_INVALID';
    END IF;
    IF (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest)
    ) <> (
      SELECT pg_catalog.count(DISTINCT attachment.item ->> 'attachmentId')
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
    ) OR (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest)
    ) <> (
      SELECT pg_catalog.count(DISTINCT attachment.item ->> 'objectPath')
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
    ) OR (
      SELECT COALESCE(
        pg_catalog.sum((attachment.item ->> 'sizeBytes')::bigint),
        0
      )
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
    ) > 52428800 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_INVALID';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest) AS attachment(item)
      LEFT JOIN storage.objects AS stored_object
        ON stored_object.bucket_id = v_upload.bucket_id
       AND stored_object.name = attachment.item ->> 'objectPath'
      WHERE stored_object.id IS NULL
        OR COALESCE(stored_object.metadata ->> 'mimetype', '')
          <> attachment.item ->> 'mimeType'
        OR CASE
          WHEN COALESCE(stored_object.metadata ->> 'size', '') ~ '^[0-9]+$'
          THEN (stored_object.metadata ->> 'size')::numeric
            <> (attachment.item ->> 'sizeBytes')::numeric
          ELSE true
        END
        OR (
          stored_object.user_metadata ? 'sha256'
          AND pg_catalog.lower(stored_object.user_metadata ->> 'sha256')
            <> pg_catalog.lower(attachment.item ->> 'sha256')
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_OBJECT_MISMATCH';
    END IF;
  END IF;

  SELECT COALESCE(membership.display_name, app_user.display_name)
  INTO v_created_by_name
  FROM public.app_users AS app_user
  LEFT JOIN public.company_memberships AS membership
    ON membership.id = v_membership.id
  WHERE app_user.id = v_uid::text
  LIMIT 1;

  INSERT INTO public.company_counters AS counter (
    company_id,
    counter_key,
    next_value,
    updated_at
  ) VALUES (
    p_company_id,
    'job_no'::public.counter_key,
    2,
    p_created_at
  )
  ON CONFLICT (company_id, counter_key) DO UPDATE
  SET next_value = counter.next_value + 1,
      updated_at = EXCLUDED.updated_at
  RETURNING counter.next_value - 1 INTO v_job_no;

  INSERT INTO public.jobs AS created_job (
    company_id,
    job_no,
    status,
    title,
    description,
    location,
    client_id,
    assigned_membership_id,
    created_by_membership_id,
    accepted_by_user_id,
    accepted_at,
    finished_at,
    client_name_snapshot,
    client_phone_snapshot,
    assigned_member_name_snapshot,
    created_by_name_snapshot,
    meta,
    created_at,
    updated_at
  ) VALUES (
    p_company_id,
    v_job_no,
    p_status,
    pg_catalog.btrim(p_title),
    p_description,
    NULLIF(pg_catalog.btrim(p_location), ''),
    v_client.id,
    v_assignee.id,
    v_membership.id,
    CASE WHEN p_status = 'finished' THEN v_uid::text ELSE NULL END,
    CASE WHEN p_status = 'finished' THEN p_created_at ELSE NULL END,
    CASE WHEN p_status = 'finished' THEN p_created_at ELSE NULL END,
    v_client.name,
    v_client.phone,
    v_assignee.display_name,
    v_created_by_name,
    v_details,
    p_created_at,
    p_created_at
  )
  RETURNING created_job.* INTO v_job;

  INSERT INTO public.job_part_usages (
    job_id,
    inventory_part_id,
    part_name_snapshot,
    quantity,
    created_at
  )
  SELECT
    v_job.id,
    inventory_part.id,
    inventory_part.name,
    (part.item ->> 'quantity')::numeric,
    p_created_at
  FROM pg_catalog.jsonb_array_elements(v_parts) AS part(item)
  INNER JOIN public.inventory_parts AS inventory_part
    ON inventory_part.company_id = p_company_id
   AND inventory_part.part_no = (part.item ->> 'partId')::integer
   AND inventory_part.active
   AND inventory_part.archived_at IS NULL;

  IF v_effective_role = 'user'
    AND p_status = 'finished'
    AND pg_catalog.jsonb_array_length(v_parts) > 0 THEN
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'part_id', inventory_part.id,
          'part_no', inventory_part.part_no,
          'quantity', (part.item ->> 'quantity')::numeric
        )
        ORDER BY inventory_part.part_no, inventory_part.id
      ),
      '[]'::jsonb
    )
    INTO v_consumption_parts
    FROM pg_catalog.jsonb_array_elements(v_parts) AS part(item)
    INNER JOIN public.inventory_parts AS inventory_part
      ON inventory_part.company_id = p_company_id
     AND inventory_part.part_no = (part.item ->> 'partId')::integer
     AND inventory_part.active
     AND inventory_part.archived_at IS NULL;

    PERFORM 1
    FROM private.apply_job_inventory_consumption_batch(
      p_company_id,
      v_membership.id,
      v_job.id,
      v_membership.id,
      v_consumption_parts,
      p_created_at
    );

    PERFORM private.bump_company_sync_version(
      p_company_id,
      'company_inventory_version'
    );
  END IF;

  IF p_upload_session_id IS NOT NULL THEN
    INSERT INTO public.job_attachments (
      id,
      job_id,
      storage_path,
      kind,
      uploaded_by_user_id,
      created_at
    )
    SELECT
      (attachment.item ->> 'attachmentId')::uuid,
      v_job.id,
      attachment.item ->> 'objectPath',
      (attachment.item ->> 'kind')::public.job_attachment_kind,
      v_uid::text,
      p_created_at
    FROM pg_catalog.jsonb_array_elements(v_upload.expected_manifest) AS attachment(item);

    UPDATE private.file_upload_sessions AS upload_session
    SET status = 'consumed',
        consumed_at = p_created_at,
        consumed_by_job_id = v_job.id,
        updated_at = p_created_at
    WHERE upload_session.id = p_upload_session_id;
  END IF;

  PERFORM private.bump_company_sync_version(p_company_id, 'jobs_version');

  job_id := v_job.id;
  job_no := v_job.job_no;
  status := v_job.status;
  entity_version := v_job.entity_version;
  finished_at := v_job.finished_at;
  created_at := v_job.created_at;
  updated_at := v_job.updated_at;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.create_api_job_with_details(
  UUID,
  public.job_status,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  JSONB,
  JSONB,
  UUID,
  TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.create_api_job_with_details(
  UUID,
  public.job_status,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  JSONB,
  JSONB,
  UUID,
  TIMESTAMPTZ
) TO smart_job_api, service_role;

-- ============================================================================
-- Consolidated source: 0008_pdf_supabase_storage.sql
-- ============================================================================
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

-- ============================================================================
-- Consolidated source: 0009_bounded_upload_session_cleanup.sql
-- ============================================================================
ALTER TABLE "private"."file_upload_sessions" DROP CONSTRAINT "file_upload_sessions_status_check";--> statement-breakpoint
ALTER TABLE "private"."file_upload_sessions" DROP CONSTRAINT "file_upload_sessions_cleanup_attempts_non_negative_check";--> statement-breakpoint
UPDATE "private"."file_upload_sessions"
SET "cleanup_attempts" = LEAST(GREATEST("cleanup_attempts", 0), 5),
    "last_cleanup_error" = CASE
      WHEN "last_cleanup_error" IS NULL THEN NULL
      ELSE LEFT("last_cleanup_error", 500)
    END,
    "status" = CASE
      WHEN "status" = 'cleanup_claimed' AND "cleanup_lease_expires_at" IS NULL
        THEN 'cleanup_pending'
      ELSE "status"
    END,
    "cleanup_lease_expires_at" = CASE
      WHEN "status" = 'cleanup_claimed' AND "cleanup_lease_expires_at" IS NOT NULL
        THEN "cleanup_lease_expires_at"
      ELSE NULL
    END;--> statement-breakpoint
ALTER TABLE "private"."file_upload_sessions" ADD CONSTRAINT "file_upload_sessions_cleanup_error_length_check" CHECK ("private"."file_upload_sessions"."last_cleanup_error" IS NULL OR char_length("private"."file_upload_sessions"."last_cleanup_error") <= 500);--> statement-breakpoint
ALTER TABLE "private"."file_upload_sessions" ADD CONSTRAINT "file_upload_sessions_cleanup_lease_state_check" CHECK (("private"."file_upload_sessions"."status" = 'cleanup_claimed' AND "private"."file_upload_sessions"."cleanup_lease_expires_at" IS NOT NULL)
      OR ("private"."file_upload_sessions"."status" <> 'cleanup_claimed' AND "private"."file_upload_sessions"."cleanup_lease_expires_at" IS NULL));--> statement-breakpoint
ALTER TABLE "private"."file_upload_sessions" ADD CONSTRAINT "file_upload_sessions_status_check" CHECK ("private"."file_upload_sessions"."status" IN ('pending', 'consumed', 'cleanup_pending', 'cleanup_claimed', 'cleanup_complete', 'cleanup_failed'));--> statement-breakpoint
ALTER TABLE "private"."file_upload_sessions" ADD CONSTRAINT "file_upload_sessions_cleanup_attempts_non_negative_check" CHECK ("private"."file_upload_sessions"."cleanup_attempts" BETWEEN 0 AND 5);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.file_upload_cleanup_manifest_is_canonical(
  p_session_id UUID,
  p_company_id UUID,
  p_user_id UUID,
  p_bucket_id TEXT,
  p_object_prefix TEXT,
  p_expected_manifest JSONB
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT
    p_session_id IS NOT NULL
    AND p_company_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND p_bucket_id = 'smart-job-company-files'
    AND p_object_prefix = pg_catalog.concat(
      p_company_id::text,
      '/',
      p_user_id::text,
      '/',
      p_session_id::text
    )
    AND pg_catalog.jsonb_typeof(p_expected_manifest) = 'array'
    AND pg_catalog.jsonb_array_length(p_expected_manifest) BETWEEN 1 AND 20
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(
        CASE
          WHEN pg_catalog.jsonb_typeof(p_expected_manifest) = 'array'
            THEN p_expected_manifest
          ELSE '[]'::jsonb
        END
      ) AS attachment(item)
      WHERE pg_catalog.jsonb_typeof(attachment.item) <> 'object'
        OR NOT (
          attachment.item ? 'attachmentId'
          AND attachment.item ? 'mimeType'
          AND attachment.item ? 'objectPath'
        )
        OR COALESCE(attachment.item ->> 'attachmentId', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR COALESCE(attachment.item ->> 'mimeType', '') NOT IN (
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/heic',
          'image/heif'
        )
        OR attachment.item ->> 'objectPath' IS DISTINCT FROM pg_catalog.concat(
          p_object_prefix,
          '/',
          attachment.item ->> 'attachmentId',
          '.',
          CASE attachment.item ->> 'mimeType'
            WHEN 'image/jpeg' THEN 'jpg'
            WHEN 'image/png' THEN 'png'
            WHEN 'image/webp' THEN 'webp'
            WHEN 'image/heic' THEN 'heic'
            WHEN 'image/heif' THEN 'heif'
            ELSE NULL
          END
        )
    )
    AND (
      SELECT pg_catalog.count(DISTINCT attachment.item ->> 'objectPath')
      FROM pg_catalog.jsonb_array_elements(
        CASE
          WHEN pg_catalog.jsonb_typeof(p_expected_manifest) = 'array'
            THEN p_expected_manifest
          ELSE '[]'::jsonb
        END
      ) AS attachment(item)
    ) = pg_catalog.jsonb_array_length(p_expected_manifest);
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.queue_expired_file_upload_cleanup(
  p_now TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_summary JSONB;
  v_quarantined INTEGER := 0;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLEANUP_NOW_REQUIRED';
  END IF;

  v_summary := private.cleanup_expired_operational_rows(p_now);

  -- Invalid manifests are never returned to an object-deletion worker. Keep the
  -- row for review, cap its attempts, and expose only an aggregate count.
  UPDATE private.file_upload_sessions AS upload
  SET status = 'cleanup_failed',
      cleanup_lease_expires_at = NULL,
      cleanup_attempts = 5,
      last_cleanup_error = CASE
        WHEN upload.cleanup_attempts >= 5
          THEN COALESCE(upload.last_cleanup_error, 'cleanup_attempt_limit_reached')
        ELSE 'invalid_upload_cleanup_manifest'
      END,
      updated_at = p_now
  WHERE upload.status = 'cleanup_pending'
    AND (
      upload.cleanup_attempts >= 5
      OR NOT private.file_upload_cleanup_manifest_is_canonical(
        upload.id,
        upload.company_id,
        upload.user_id,
        upload.bucket_id,
        upload.object_prefix,
        upload.expected_manifest
      )
    );
  GET DIAGNOSTICS v_quarantined = ROW_COUNT;

  RETURN COALESCE(v_summary, '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'uploadSessionsQuarantined',
    v_quarantined
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_file_upload_cleanup_batch(
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 300,
  p_now TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS TABLE (
  session_id UUID,
  bucket_id TEXT,
  object_paths TEXT[],
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_lease_seconds INTEGER := LEAST(
    GREATEST(COALESCE(p_lease_seconds, 300), 30),
    900
  );
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLEANUP_NOW_REQUIRED';
  END IF;

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT upload.id
    FROM private.file_upload_sessions AS upload
    WHERE upload.status = 'cleanup_pending'
      AND upload.cleanup_attempts < 5
      AND upload.consumed_at IS NULL
      AND upload.consumed_by_job_id IS NULL
      AND private.file_upload_cleanup_manifest_is_canonical(
        upload.id,
        upload.company_id,
        upload.user_id,
        upload.bucket_id,
        upload.object_prefix,
        upload.expected_manifest
      )
    ORDER BY upload.updated_at, upload.expires_at, upload.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE private.file_upload_sessions AS upload
    SET status = 'cleanup_claimed',
        cleanup_lease_expires_at = p_now
          + pg_catalog.make_interval(secs => v_lease_seconds),
        cleanup_attempts = upload.cleanup_attempts + 1,
        last_cleanup_error = NULL,
        updated_at = p_now
    FROM candidates
    WHERE upload.id = candidates.id
      AND upload.status = 'cleanup_pending'
      AND upload.cleanup_attempts < 5
      AND upload.consumed_at IS NULL
      AND upload.consumed_by_job_id IS NULL
    RETURNING
      upload.id,
      upload.bucket_id,
      upload.expected_manifest,
      upload.cleanup_lease_expires_at,
      upload.cleanup_attempts
  )
  SELECT
    claimed.id,
    claimed.bucket_id,
    ARRAY(
      SELECT attachment.item ->> 'objectPath'
      FROM pg_catalog.jsonb_array_elements(claimed.expected_manifest)
        WITH ORDINALITY AS attachment(item, position)
      ORDER BY attachment.position
    ),
    claimed.cleanup_lease_expires_at,
    claimed.cleanup_attempts
  FROM claimed
  ORDER BY claimed.id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.finish_file_upload_cleanup(
  p_session_id UUID,
  p_attempt_count INTEGER,
  p_succeeded BOOLEAN,
  p_error TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_upload private.file_upload_sessions%ROWTYPE;
  v_error TEXT;
  v_next_status TEXT;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLEANUP_SESSION_REQUIRED';
  END IF;
  IF p_attempt_count NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLEANUP_ATTEMPT_INVALID';
  END IF;
  IF p_succeeded IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLEANUP_RESULT_REQUIRED';
  END IF;
  IF p_now IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLEANUP_NOW_REQUIRED';
  END IF;

  SELECT upload.*
  INTO v_upload
  FROM private.file_upload_sessions AS upload
  WHERE upload.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPLOAD_CLEANUP_SESSION_NOT_FOUND';
  END IF;

  -- The attempt token prevents an expired worker from acknowledging a newer
  -- lease. Consumed, completed, failed, or requeued rows are never mutated.
  IF v_upload.status <> 'cleanup_claimed'
     OR v_upload.cleanup_attempts <> p_attempt_count
     OR v_upload.consumed_at IS NOT NULL
     OR v_upload.consumed_by_job_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'stale',
      'status', v_upload.status,
      'attemptCount', v_upload.cleanup_attempts
    );
  END IF;

  IF p_succeeded THEN
    UPDATE private.file_upload_sessions
    SET status = 'cleanup_complete',
        cleanup_lease_expires_at = NULL,
        last_cleanup_error = NULL,
        updated_at = p_now
    WHERE id = p_session_id;

    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'cleanup_complete',
      'status', 'cleanup_complete',
      'attemptCount', p_attempt_count
    );
  END IF;

  v_error := LEFT(
    COALESCE(NULLIF(pg_catalog.btrim(p_error), ''), 'storage_delete_failed'),
    500
  );
  v_next_status := CASE
    WHEN p_attempt_count >= 5 THEN 'cleanup_failed'
    ELSE 'cleanup_pending'
  END;

  UPDATE private.file_upload_sessions
  SET status = v_next_status,
      cleanup_lease_expires_at = NULL,
      last_cleanup_error = v_error,
      updated_at = p_now
  WHERE id = p_session_id;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', v_next_status,
    'status', v_next_status,
    'attemptCount', p_attempt_count
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.queue_expired_file_upload_cleanup(
  p_now TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.queue_expired_file_upload_cleanup(p_now);
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.claim_file_upload_cleanup_batch(
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 300,
  p_now TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS TABLE (
  session_id UUID,
  bucket_id TEXT,
  object_paths TEXT[],
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT *
  FROM private.claim_file_upload_cleanup_batch(
    p_limit,
    p_lease_seconds,
    p_now
  );
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.finish_file_upload_cleanup(
  p_session_id UUID,
  p_attempt_count INTEGER,
  p_succeeded BOOLEAN,
  p_error TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
) RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.finish_file_upload_cleanup(
    p_session_id,
    p_attempt_count,
    p_succeeded,
    p_error,
    p_now
  );
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.file_upload_cleanup_manifest_is_canonical(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.queue_expired_file_upload_cleanup(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.claim_file_upload_cleanup_batch(
  INTEGER, INTEGER, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.finish_file_upload_cleanup(
  UUID, INTEGER, BOOLEAN, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.queue_expired_file_upload_cleanup(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_file_upload_cleanup_batch(
  INTEGER, INTEGER, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.finish_file_upload_cleanup(
  UUID, INTEGER, BOOLEAN, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.queue_expired_file_upload_cleanup(TIMESTAMPTZ)
  TO service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_file_upload_cleanup_batch(
  INTEGER, INTEGER, TIMESTAMPTZ
) TO service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.finish_file_upload_cleanup(
  UUID, INTEGER, BOOLEAN, TEXT, TIMESTAMPTZ
) TO service_role;

-- ============================================================================
-- Consolidated source: 0010_hardened_api_business_registration.sql
-- ============================================================================
-- Hardened, API-only first-workspace registration.
-- Identity, role, tier, modules, counters, and membership are derived in SQL.

CREATE OR REPLACE FUNCTION private.register_api_business_account(
  p_verified_email TEXT,
  p_workspace_mode TEXT,
  p_display_name TEXT,
  p_phone_number TEXT,
  p_he_name TEXT,
  p_en_name TEXT,
  p_vat_number TEXT,
  p_business_type TEXT,
  p_city TEXT,
  p_address TEXT,
  p_business_phone TEXT,
  p_business_fax TEXT,
  p_accountant_name TEXT,
  p_accountant_email TEXT,
  p_accountant_phone TEXT
) RETURNS TABLE (
  internal_company_id UUID,
  public_company_id BIGINT,
  tier TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id TEXT := private.app_auth_uid();
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_verified_email, '')));
  v_mode TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_workspace_mode, '')));
  v_display_name TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_display_name, '')), '');
  v_phone_number TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_phone_number, '')), '');
  v_he_name TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_he_name, '')), '');
  v_en_name TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_en_name, '')), '');
  v_vat_number TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_vat_number, '')), '');
  v_business_type TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_business_type, '')), '');
  v_city TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_city, '')), '');
  v_address TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_address, '')), '');
  v_business_phone TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_business_phone, '')), '');
  v_business_fax TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_business_fax, '')), '');
  v_accountant_name TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_accountant_name, '')), '');
  v_accountant_email TEXT := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(COALESCE(p_accountant_email, ''))),
    ''
  );
  v_accountant_phone TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_accountant_phone, '')), '');
  v_account_type public.account_type;
  v_role public.membership_role;
  v_tier public.subscription_tier;
  v_enabled_modules JSONB;
  v_company_id UUID;
  v_public_company_id INTEGER;
  v_member_no INTEGER;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'REGISTRATION_CONTEXT_REQUIRED';
  END IF;

  IF pg_catalog.char_length(v_email) NOT BETWEEN 5 AND 320
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_EMAIL_INVALID';
  END IF;
  IF pg_catalog.char_length(COALESCE(v_display_name, '')) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_DISPLAY_NAME_INVALID';
  END IF;
  IF pg_catalog.char_length(COALESCE(v_phone_number, '')) NOT BETWEEN 6 AND 40 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_PHONE_INVALID';
  END IF;

  CASE v_mode
    WHEN 'basic' THEN
      v_account_type := 'solo'::public.account_type;
      v_role := 'basic'::public.membership_role;
      v_tier := 'Basic'::public.subscription_tier;
    WHEN 'solo' THEN
      v_account_type := 'solo'::public.account_type;
      v_role := 'user'::public.membership_role;
      v_tier := 'Solo'::public.subscription_tier;
    WHEN 'business' THEN
      v_account_type := 'business'::public.account_type;
      v_role := 'manager'::public.membership_role;
      v_tier := 'Team'::public.subscription_tier;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_MODE_INVALID';
  END CASE;

  IF pg_catalog.char_length(COALESCE(v_he_name, '')) > 200
     OR pg_catalog.char_length(COALESCE(v_en_name, '')) > 200
     OR pg_catalog.char_length(COALESCE(v_vat_number, '')) > 32
     OR pg_catalog.char_length(COALESCE(v_business_type, '')) > 120
     OR pg_catalog.char_length(COALESCE(v_city, '')) > 120
     OR pg_catalog.char_length(COALESCE(v_address, '')) > 500
     OR pg_catalog.char_length(COALESCE(v_business_phone, '')) > 40
     OR pg_catalog.char_length(COALESCE(v_business_fax, '')) > 40
     OR pg_catalog.char_length(COALESCE(v_accountant_name, '')) > 200
     OR pg_catalog.char_length(COALESCE(v_accountant_email, '')) > 320
     OR pg_catalog.char_length(COALESCE(v_accountant_phone, '')) > 40 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_PROFILE_INVALID';
  END IF;
  IF v_accountant_email IS NOT NULL
     AND v_accountant_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_ACCOUNTANT_EMAIL_INVALID';
  END IF;

  IF v_mode = 'business' AND (
    v_he_name IS NULL
    OR v_vat_number IS NULL
    OR v_business_type IS NULL
    OR v_address IS NULL
    OR v_business_phone IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_BUSINESS_PROFILE_REQUIRED';
  END IF;

  v_he_name := COALESCE(v_he_name, v_display_name);
  v_en_name := COALESCE(v_en_name, v_he_name);
  v_business_type := COALESCE(v_business_type, v_mode);
  v_business_phone := COALESCE(v_business_phone, v_phone_number);
  v_enabled_modules := pg_catalog.jsonb_build_object(
    'team', v_tier IN ('Team'::public.subscription_tier, 'Enterprise'::public.subscription_tier),
    'solojob', v_tier <> 'Basic'::public.subscription_tier,
    'clients', true,
    'documents', true,
    'teaminventory', v_tier IN ('Team'::public.subscription_tier, 'Enterprise'::public.subscription_tier),
    'companyinventory', v_tier IN ('Team'::public.subscription_tier, 'Enterprise'::public.subscription_tier),
    'inventory', v_tier <> 'Basic'::public.subscription_tier
  );

  -- Serialize first-workspace creation per Auth subject, including requests
  -- that use different idempotency keys.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id, 731927)
  );

  IF EXISTS (
    SELECT 1
    FROM public.company_memberships AS membership
    WHERE membership.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ONBOARDING_ALREADY_COMPLETED';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.app_users AS app_user
    WHERE app_user.id = v_user_id
      AND app_user.system_role IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'REGISTRATION_SYSTEM_USER_FORBIDDEN';
  END IF;

  INSERT INTO public.app_users AS app_user (
    id,
    email,
    display_name,
    phone_number,
    system_role,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_email,
    v_display_name,
    v_phone_number,
    NULL,
    v_now,
    v_now
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      phone_number = EXCLUDED.phone_number,
      updated_at = v_now;

  SELECT private.allocate_system_counter('public_company_id', 1001)
  INTO v_public_company_id;

  INSERT INTO public.companies (
    public_company_id,
    account_type,
    status,
    created_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_public_company_id,
    v_account_type,
    'active',
    v_user_id,
    v_now,
    v_now
  )
  RETURNING id INTO v_company_id;

  INSERT INTO public.company_profiles (
    company_id,
    he_name,
    en_name,
    vat_number,
    business_type,
    city,
    address,
    business_email,
    business_phone,
    business_fax,
    accountant_name,
    accountant_email,
    accountant_phone,
    registered_at,
    registered_by_user_id,
    last_updated_at
  ) VALUES (
    v_company_id,
    v_he_name,
    v_en_name,
    v_vat_number,
    v_business_type,
    v_city,
    v_address,
    v_email,
    v_business_phone,
    v_business_fax,
    v_accountant_name,
    v_accountant_email,
    v_accountant_phone,
    v_now,
    v_user_id,
    v_now
  );

  INSERT INTO public.company_subscriptions (
    company_id,
    tier,
    status,
    enabled_modules,
    updated_at
  ) VALUES (
    v_company_id,
    v_tier,
    'active',
    v_enabled_modules,
    v_now
  );

  INSERT INTO public.company_sync_state (
    company_id,
    jobs_version,
    documents_version,
    clients_version,
    workers_version,
    company_inventory_version,
    updated_at
  ) VALUES (
    v_company_id,
    0,
    0,
    0,
    1,
    0,
    v_now
  );

  SELECT private.allocate_company_counter(v_company_id, 'member_no')
  INTO v_member_no;

  INSERT INTO public.company_memberships (
    company_id,
    user_id,
    member_no,
    role,
    status,
    display_name,
    phone_number,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    v_company_id,
    v_user_id,
    v_member_no,
    v_role,
    'active',
    v_display_name,
    v_phone_number,
    v_now,
    v_now,
    v_now
  );

  RETURN QUERY SELECT
    v_company_id,
    v_public_company_id::BIGINT,
    v_tier::TEXT;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.register_api_business_account(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.register_api_business_account(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0011_api_push_tokens.sql
-- ============================================================================
-- Stage 3 authenticated viewer push-token mutations.
--
-- The runtime role cannot update public.app_users directly. These narrow
-- SECURITY DEFINER functions derive the only writable user id from the
-- transaction-local API request context and never return the token value.

CREATE OR REPLACE FUNCTION private.upsert_api_push_token(
  p_token TEXT,
  p_platform TEXT
) RETURNS TABLE (
  push_token_platform TEXT,
  push_token_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_token TEXT := pg_catalog.btrim(p_token);
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'API_CONTEXT_USER_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF v_token IS NULL
     OR pg_catalog.char_length(v_token) NOT BETWEEN 8 AND 500 THEN
    RAISE EXCEPTION 'PUSH_TOKEN_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'PUSH_TOKEN_PLATFORM_INVALID'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.app_users AS app_user
  SET
    push_token = v_token,
    push_token_platform = p_platform,
    push_token_updated_at = v_now,
    updated_at = v_now
  WHERE app_user.id = v_uid
  RETURNING
    app_user.push_token_platform::TEXT,
    app_user.push_token_updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PUSH_TOKEN_USER_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.clear_api_push_token()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'API_CONTEXT_USER_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  -- A repeated clear is a no-op, and a missing app-user row is already in the
  -- desired state. Both cases intentionally return success.
  UPDATE public.app_users AS app_user
  SET
    push_token = NULL,
    push_token_platform = NULL,
    push_token_updated_at = NULL,
    updated_at = pg_catalog.clock_timestamp()
  WHERE app_user.id = v_uid
    AND (
      app_user.push_token IS NOT NULL
      OR app_user.push_token_platform IS NOT NULL
      OR app_user.push_token_updated_at IS NOT NULL
    );

  RETURN TRUE;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.upsert_api_push_token(TEXT, TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.clear_api_push_token()
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.upsert_api_push_token(TEXT, TEXT)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.clear_api_push_token()
TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0012_hardened_api_invitations.sql
-- ============================================================================
-- Hardened invitation creation and redemption for the Node API.
--
-- Both functions derive the caller from transaction-local request context and
-- require a live, verified Supabase Auth email. The runtime role receives no
-- direct write access to public invitation, membership, profile, or inventory
-- tables. Public company ids are resolved to internal UUIDs inside SQL.

CREATE OR REPLACE FUNCTION private.consume_api_invitation_rate_limit(
  p_operation TEXT
) RETURNS TABLE (
  allowed BOOLEAN,
  reset_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_bucket_number BIGINT;
  v_window_started_at TIMESTAMPTZ;
  v_reset_at TIMESTAMPTZ;
  v_bucket_key TEXT;
  v_hashed_key TEXT;
  v_hit_count INTEGER;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_operation IS NULL OR p_operation NOT IN ('create', 'redeem') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_RATE_LIMIT_OPERATION_INVALID';
  END IF;

  v_bucket_number := pg_catalog.floor(EXTRACT(EPOCH FROM v_now) / 60)::BIGINT;
  v_window_started_at := pg_catalog.to_timestamp(v_bucket_number * 60);
  v_reset_at := v_window_started_at + INTERVAL '1 minute';
  v_hashed_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'invitation:' || p_operation || ':' || v_uid_text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_bucket_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'invitation:' || p_operation || ':' || v_uid_text || ':' || v_bucket_number::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.rate_limit_buckets AS bucket (
    bucket_key,
    hashed_key,
    window_started_at,
    hit_count,
    expire_at,
    updated_at
  ) VALUES (
    v_bucket_key,
    v_hashed_key,
    v_window_started_at,
    1,
    v_reset_at + INTERVAL '1 minute',
    v_now
  )
  ON CONFLICT (bucket_key) DO UPDATE
  SET hit_count = bucket.hit_count + 1,
      expire_at = EXCLUDED.expire_at,
      updated_at = v_now
  RETURNING bucket.hit_count INTO v_hit_count;

  -- Return instead of raising so the caller can commit this limiter
  -- transaction before mapping the denial to HTTP 429.
  RETURN QUERY SELECT v_hit_count <= 10, v_reset_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_company_invitation(
  p_company_id UUID,
  p_target_role TEXT,
  p_target_email TEXT DEFAULT NULL,
  p_expires_in_days INTEGER DEFAULT 30
) RETURNS TABLE (
  invite_id UUID,
  invite_code TEXT,
  target_role TEXT,
  status TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_verified_email TEXT;
  v_creator_membership_id UUID;
  v_is_dev BOOLEAN := false;
  v_team_enabled BOOLEAN := false;
  v_target_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_target_email));
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_expires_at TIMESTAMPTZ;
  v_invite_id UUID;
  v_invite_code TEXT;
  v_attempt INTEGER := 0;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  BEGIN
    v_uid := v_uid_text::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_INVALID';
  END;

  SELECT pg_catalog.lower(pg_catalog.btrim(auth_user.email))
  INTO v_verified_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = v_uid
    AND auth_user.email IS NOT NULL
    AND auth_user.email_confirmed_at IS NOT NULL
    AND auth_user.deleted_at IS NULL
    AND NOT auth_user.is_anonymous
  FOR KEY SHARE OF auth_user;

  IF v_verified_email IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EMAIL_VERIFICATION_REQUIRED';
  END IF;
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_ID_INVALID';
  END IF;
  IF p_target_role IS NULL
     OR p_target_role NOT IN ('manager', 'worker', 'user', 'basic') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_ROLE_INVALID';
  END IF;
  IF p_expires_in_days IS NULL OR p_expires_in_days NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_EXPIRY_INVALID';
  END IF;
  IF p_target_email IS NOT NULL AND (
    v_target_email IS NULL
    OR pg_catalog.char_length(v_target_email) NOT BETWEEN 3 AND 320
    OR v_target_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_EMAIL_INVALID';
  END IF;

  SELECT private.app_is_dev() INTO v_is_dev;
  SELECT membership.id
  INTO v_creator_membership_id
  FROM public.company_memberships AS membership
  INNER JOIN public.companies AS company
    ON company.id = membership.company_id
   AND company.status = 'active'
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid_text
    AND membership.status = 'active'
    AND membership.role = 'manager'
  LIMIT 1
  FOR KEY SHARE OF membership, company;

  IF v_creator_membership_id IS NULL AND NOT v_is_dev THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVITATION_MANAGER_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.companies AS company
    WHERE company.id = p_company_id
      AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'COMPANY_NOT_FOUND';
  END IF;

  SELECT
    subscription.status IN ('active', 'trial')
    AND (
      subscription.expires_at IS NULL
      OR subscription.expires_at > pg_catalog.statement_timestamp()
    )
    AND CASE
      WHEN pg_catalog.jsonb_typeof(subscription.enabled_modules -> 'team') = 'boolean'
        THEN (subscription.enabled_modules ->> 'team')::BOOLEAN
      WHEN pg_catalog.jsonb_typeof(subscription.enabled_modules -> 'workers') = 'boolean'
        THEN (subscription.enabled_modules ->> 'workers')::BOOLEAN
      ELSE subscription.tier IN ('Team', 'Enterprise')
    END
  INTO v_team_enabled
  FROM public.company_subscriptions AS subscription
  WHERE subscription.company_id = p_company_id
  LIMIT 1;

  IF NOT v_is_dev AND NOT COALESCE(v_team_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVITATIONS_MODULE_DISABLED';
  END IF;

  v_expires_at := v_now + pg_catalog.make_interval(days => p_expires_in_days);
  WHILE v_attempt < 5 LOOP
    v_attempt := v_attempt + 1;
    v_invite_code := pg_catalog.upper(
      pg_catalog.encode(extensions.gen_random_bytes(10), 'hex')
    );
    BEGIN
      INSERT INTO public.company_invites (
        company_id,
        code,
        target_role,
        status,
        invited_email,
        created_by_membership_id,
        expires_at,
        created_at
      ) VALUES (
        p_company_id,
        v_invite_code,
        p_target_role::public.membership_role,
        'active',
        v_target_email,
        v_creator_membership_id,
        v_expires_at,
        v_now
      )
      RETURNING id INTO v_invite_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        v_invite_id := NULL;
    END;
  END LOOP;

  IF v_invite_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITATION_CODE_GENERATION_FAILED';
  END IF;

  RETURN QUERY SELECT
    v_invite_id,
    v_invite_code,
    p_target_role,
    'active'::TEXT,
    v_expires_at,
    v_now;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.redeem_api_company_invitation(
  p_public_company_id BIGINT,
  p_invite_code TEXT,
  p_display_name TEXT DEFAULT NULL,
  p_phone_number TEXT DEFAULT NULL
) RETURNS TABLE (
  internal_company_id UUID,
  public_company_id BIGINT,
  membership_id UUID,
  member_no INTEGER,
  role TEXT,
  display_name TEXT,
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_verified_email TEXT;
  v_company_id UUID;
  v_code TEXT := pg_catalog.upper(pg_catalog.btrim(p_invite_code));
  v_display_name TEXT := NULLIF(pg_catalog.btrim(p_display_name), '');
  v_phone_number TEXT := NULLIF(pg_catalog.btrim(p_phone_number), '');
  v_profile_display_name TEXT;
  v_profile_phone_number TEXT;
  v_invite public.company_invites%ROWTYPE;
  v_existing public.company_memberships%ROWTYPE;
  v_membership public.company_memberships%ROWTYPE;
  v_invited_by_user_id TEXT;
  v_member_no INTEGER;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  BEGIN
    v_uid := v_uid_text::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_INVALID';
  END;

  SELECT pg_catalog.lower(pg_catalog.btrim(auth_user.email))
  INTO v_verified_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = v_uid
    AND auth_user.email IS NOT NULL
    AND auth_user.email_confirmed_at IS NOT NULL
    AND auth_user.deleted_at IS NULL
    AND NOT auth_user.is_anonymous
  FOR KEY SHARE OF auth_user;

  IF v_verified_email IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EMAIL_VERIFICATION_REQUIRED';
  END IF;
  IF p_public_company_id IS NULL OR p_public_company_id < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_ID_INVALID';
  END IF;
  IF v_code IS NULL OR pg_catalog.char_length(v_code) NOT BETWEEN 4 AND 80 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_CODE_INVALID';
  END IF;
  IF v_display_name IS NOT NULL AND pg_catalog.char_length(v_display_name) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_DISPLAY_NAME_INVALID';
  END IF;
  IF v_phone_number IS NOT NULL
     AND pg_catalog.char_length(v_phone_number) NOT BETWEEN 3 AND 40 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_PHONE_INVALID';
  END IF;

  SELECT company.id
  INTO v_company_id
  FROM public.companies AS company
  WHERE company.public_company_id = p_public_company_id
    AND company.status = 'active'
  LIMIT 1
  FOR KEY SHARE OF company;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'COMPANY_NOT_FOUND';
  END IF;

  -- Serialize the same Auth subject joining the same company even when two
  -- different invitation codes are submitted concurrently.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_company_id::TEXT || ':' || v_uid_text, 812731)
  );

  SELECT invitation.*
  INTO v_invite
  FROM public.company_invites AS invitation
  WHERE invitation.company_id = v_company_id
    AND invitation.code = v_code
  LIMIT 1
  FOR UPDATE OF invitation;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVITATION_NOT_FOUND';
  END IF;

  -- A successful same-subject retry remains replayable after the original
  -- expiry timestamp. A different subject never learns who consumed it.
  IF v_invite.status = 'used' THEN
    IF v_invite.used_by_user_id <> v_uid_text THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITATION_ALREADY_USED';
    END IF;

    SELECT membership.*
    INTO v_existing
    FROM public.company_memberships AS membership
    WHERE membership.company_id = v_company_id
      AND membership.user_id = v_uid_text
      AND membership.status = 'active'
    ORDER BY membership.joined_at ASC, membership.created_at ASC
    LIMIT 1
    FOR KEY SHARE OF membership;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITATION_ALREADY_USED';
    END IF;

    RETURN QUERY SELECT
      v_company_id,
      p_public_company_id,
      v_existing.id,
      v_existing.member_no,
      v_existing.role::TEXT,
      v_existing.display_name::TEXT,
      v_existing.joined_at;
    RETURN;
  END IF;

  IF v_invite.status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITATION_INACTIVE';
  END IF;
  IF v_invite.expires_at <= v_now THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITATION_EXPIRED';
  END IF;
  IF v_invite.invited_email IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(v_invite.invited_email)) <> v_verified_email THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVITATION_EMAIL_MISMATCH';
  END IF;
  IF v_invite.target_role NOT IN ('manager', 'worker', 'user', 'basic') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVITATION_ROLE_INVALID';
  END IF;

  SELECT membership.*
  INTO v_existing
  FROM public.company_memberships AS membership
  WHERE membership.company_id = v_company_id
    AND membership.user_id = v_uid_text
    AND membership.status = 'active'
  ORDER BY membership.joined_at ASC, membership.created_at ASC
  LIMIT 1
  FOR KEY SHARE OF membership;

  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORKSPACE_MEMBERSHIP_EXISTS';
  END IF;

  SELECT app_user.display_name, app_user.phone_number
  INTO v_profile_display_name, v_profile_phone_number
  FROM public.app_users AS app_user
  WHERE app_user.id = v_uid_text;

  v_display_name := COALESCE(
    v_display_name,
    v_profile_display_name,
    pg_catalog.left(v_verified_email, 200)
  );
  v_phone_number := COALESCE(v_phone_number, v_profile_phone_number);

  INSERT INTO public.app_users AS app_user (
    id,
    email,
    display_name,
    phone_number,
    created_at,
    updated_at
  ) VALUES (
    v_uid_text,
    v_verified_email,
    v_display_name,
    v_phone_number,
    v_now,
    v_now
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      display_name = COALESCE(EXCLUDED.display_name, app_user.display_name),
      phone_number = COALESCE(EXCLUDED.phone_number, app_user.phone_number),
      updated_at = v_now;

  SELECT creator.user_id
  INTO v_invited_by_user_id
  FROM public.company_memberships AS creator
  WHERE creator.id = v_invite.created_by_membership_id;

  SELECT private.allocate_company_counter(v_company_id, 'member_no')
  INTO v_member_no;

  INSERT INTO public.company_memberships (
    company_id,
    user_id,
    member_no,
    role,
    status,
    display_name,
    phone_number,
    invited_by_user_id,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    v_company_id,
    v_uid_text,
    v_member_no,
    v_invite.target_role,
    'active',
    v_display_name,
    v_phone_number,
    v_invited_by_user_id,
    v_now,
    v_now,
    v_now
  )
  RETURNING * INTO v_membership;

  INSERT INTO public.inventory_locations (
    company_id,
    location_type,
    membership_id,
    name,
    created_at
  ) VALUES (
    v_company_id,
    'member',
    v_membership.id,
    v_display_name,
    v_now
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.company_invites AS invitation
  SET status = 'used',
      used_by_user_id = v_uid_text,
      used_at = v_now
  WHERE invitation.id = v_invite.id
    AND invitation.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITATION_INACTIVE';
  END IF;

  PERFORM private.bump_company_sync_version(v_company_id, 'workers_version');

  RETURN QUERY SELECT
    v_company_id,
    p_public_company_id,
    v_membership.id,
    v_membership.member_no,
    v_membership.role::TEXT,
    v_membership.display_name::TEXT,
    v_membership.joined_at;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.create_api_company_invitation(UUID, TEXT, TEXT, INTEGER)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.redeem_api_company_invitation(BIGINT, TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.consume_api_invitation_rate_limit(TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.create_api_company_invitation(UUID, TEXT, TEXT, INTEGER)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.redeem_api_company_invitation(BIGINT, TEXT, TEXT, TEXT)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.consume_api_invitation_rate_limit(TEXT)
TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0013_api_profile_updates.sql
-- ============================================================================
-- Narrow authenticated profile mutations for the Node API.
--
-- The runtime role keeps read-only access to public profile tables. These
-- SECURITY DEFINER functions derive the caller from the transaction-local API
-- context, validate an explicit JSON patch allowlist, and retain the immutable
-- VAT boundary established during onboarding.

ALTER TABLE public.company_profiles
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT company_profiles_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.increment_company_profile_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER company_profiles_increment_entity_version
BEFORE UPDATE ON public.company_profiles
FOR EACH ROW
EXECUTE FUNCTION private.increment_company_profile_entity_version();--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.update_api_viewer_profile(
  p_company_id UUID,
  p_patch JSONB
) RETURNS TABLE (
  uid UUID,
  email TEXT,
  display_name TEXT,
  phone_number TEXT,
  system_role TEXT,
  public_company_id BIGINT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_user public.app_users%ROWTYPE;
  v_public_company_id BIGINT;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_PATCH_INVALID';
  END IF;
  IF NOT (p_patch ? 'displayName' OR p_patch ? 'phoneNumber')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_object_keys(p_patch) AS patch_key(key)
       WHERE patch_key.key NOT IN ('displayName', 'phoneNumber')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_PATCH_FIELDS_INVALID';
  END IF;
  IF p_patch ? 'displayName'
     AND pg_catalog.jsonb_typeof(p_patch -> 'displayName') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_DISPLAY_NAME_INVALID';
  END IF;
  IF p_patch ? 'phoneNumber'
     AND pg_catalog.jsonb_typeof(p_patch -> 'phoneNumber') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_PHONE_NUMBER_INVALID';
  END IF;
  IF p_patch ? 'displayName'
     AND p_patch ->> 'displayName' IS NOT NULL
     AND (
       pg_catalog.btrim(p_patch ->> 'displayName') = ''
       OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'displayName')) > 200
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_DISPLAY_NAME_INVALID';
  END IF;
  IF p_patch ? 'phoneNumber'
     AND p_patch ->> 'phoneNumber' IS NOT NULL
     AND (
       pg_catalog.btrim(p_patch ->> 'phoneNumber') = ''
       OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'phoneNumber')) > 40
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_PHONE_NUMBER_INVALID';
  END IF;

  IF p_company_id IS NOT NULL THEN
    IF NOT private.app_has_company_access(p_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PROFILE_COMPANY_ACCESS_DENIED';
    END IF;
    SELECT company.public_company_id
    INTO v_public_company_id
    FROM public.companies AS company
    WHERE company.id = p_company_id
      AND company.status = 'active';
    IF v_public_company_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PROFILE_COMPANY_NOT_FOUND';
    END IF;
  END IF;

  UPDATE public.app_users AS app_user
  SET
    display_name = CASE
      WHEN p_patch ? 'displayName'
        THEN NULLIF(pg_catalog.btrim(p_patch ->> 'displayName'), '')
      ELSE app_user.display_name
    END,
    phone_number = CASE
      WHEN p_patch ? 'phoneNumber'
        THEN NULLIF(pg_catalog.btrim(p_patch ->> 'phoneNumber'), '')
      ELSE app_user.phone_number
    END,
    updated_at = pg_catalog.clock_timestamp()
  WHERE app_user.id = v_uid_text
  RETURNING app_user.* INTO v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PROFILE_USER_NOT_FOUND';
  END IF;

  IF p_company_id IS NOT NULL THEN
    UPDATE public.company_memberships AS membership
    SET
      display_name = CASE
        WHEN p_patch ? 'displayName' THEN v_user.display_name
        ELSE membership.display_name
      END,
      phone_number = CASE
        WHEN p_patch ? 'phoneNumber' THEN v_user.phone_number
        ELSE membership.phone_number
      END,
      updated_at = v_user.updated_at
    WHERE membership.company_id = p_company_id
      AND membership.user_id = v_uid_text
      AND membership.status = 'active';
  END IF;

  RETURN QUERY SELECT
    v_user.id::UUID,
    v_user.email::TEXT,
    v_user.display_name::TEXT,
    v_user.phone_number::TEXT,
    v_user.system_role::TEXT,
    v_public_company_id,
    v_user.updated_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.update_api_company_profile(
  p_company_id UUID,
  p_expected_entity_version BIGINT,
  p_patch JSONB
) RETURNS TABLE (
  public_company_id BIGINT,
  he_name TEXT,
  en_name TEXT,
  vat_number TEXT,
  business_type TEXT,
  city TEXT,
  address TEXT,
  business_email TEXT,
  business_phone TEXT,
  business_fax TEXT,
  accountant_name TEXT,
  accountant_email TEXT,
  accountant_phone TEXT,
  entity_version BIGINT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.company_profiles%ROWTYPE;
  v_public_company_id BIGINT;
  v_key TEXT;
  v_value TEXT;
  v_max_length INTEGER;
BEGIN
  IF private.app_auth_uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_PROFILE_COMPANY_REQUIRED';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_PROFILE_VERSION_INVALID';
  END IF;
  IF NOT private.app_is_company_manager(p_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'COMPANY_PROFILE_MANAGER_REQUIRED';
  END IF;
  IF p_patch IS NULL
     OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
     OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_PROFILE_PATCH_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS patch_key(key)
    WHERE patch_key.key NOT IN (
      'heName',
      'enName',
      'businessType',
      'city',
      'address',
      'businessEmail',
      'businessPhone',
      'businessFax',
      'accountantName',
      'accountantEmail',
      'accountantPhone'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_PROFILE_PATCH_FIELDS_INVALID';
  END IF;

  FOR v_key, v_max_length IN
    SELECT * FROM (VALUES
      ('heName', 200),
      ('enName', 200),
      ('businessType', 120),
      ('city', 120),
      ('address', 500),
      ('businessEmail', 320),
      ('businessPhone', 40),
      ('businessFax', 40),
      ('accountantName', 200),
      ('accountantEmail', 320),
      ('accountantPhone', 40)
    ) AS allowed_field(key, max_length)
  LOOP
    IF p_patch ? v_key THEN
      IF pg_catalog.jsonb_typeof(p_patch -> v_key) NOT IN ('string', 'null') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_PROFILE_FIELD_INVALID';
      END IF;
      v_value := p_patch ->> v_key;
      IF v_value IS NOT NULL
         AND (
           pg_catalog.btrim(v_value) = ''
           OR pg_catalog.char_length(pg_catalog.btrim(v_value)) > v_max_length
         ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_PROFILE_FIELD_INVALID';
      END IF;
    END IF;
  END LOOP;

  SELECT company.public_company_id
  INTO v_public_company_id
  FROM public.companies AS company
  WHERE company.id = p_company_id
    AND company.status = 'active';
  IF v_public_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'COMPANY_PROFILE_COMPANY_NOT_FOUND';
  END IF;

  UPDATE public.company_profiles AS profile
  SET
    he_name = CASE WHEN p_patch ? 'heName' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'heName'), '') ELSE profile.he_name END,
    en_name = CASE WHEN p_patch ? 'enName' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'enName'), '') ELSE profile.en_name END,
    business_type = CASE WHEN p_patch ? 'businessType' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'businessType'), '') ELSE profile.business_type END,
    city = CASE WHEN p_patch ? 'city' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'city'), '') ELSE profile.city END,
    address = CASE WHEN p_patch ? 'address' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'address'), '') ELSE profile.address END,
    business_email = CASE WHEN p_patch ? 'businessEmail' THEN NULLIF(pg_catalog.lower(pg_catalog.btrim(p_patch ->> 'businessEmail')), '') ELSE profile.business_email END,
    business_phone = CASE WHEN p_patch ? 'businessPhone' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'businessPhone'), '') ELSE profile.business_phone END,
    business_fax = CASE WHEN p_patch ? 'businessFax' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'businessFax'), '') ELSE profile.business_fax END,
    accountant_name = CASE WHEN p_patch ? 'accountantName' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'accountantName'), '') ELSE profile.accountant_name END,
    accountant_email = CASE WHEN p_patch ? 'accountantEmail' THEN NULLIF(pg_catalog.lower(pg_catalog.btrim(p_patch ->> 'accountantEmail')), '') ELSE profile.accountant_email END,
    accountant_phone = CASE WHEN p_patch ? 'accountantPhone' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'accountantPhone'), '') ELSE profile.accountant_phone END,
    last_updated_at = pg_catalog.clock_timestamp()
  WHERE profile.company_id = p_company_id
    AND profile.entity_version = p_expected_entity_version
  RETURNING profile.* INTO v_profile;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.company_profiles AS existing_profile
      WHERE existing_profile.company_id = p_company_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'COMPANY_PROFILE_VERSION_CONFLICT';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'COMPANY_PROFILE_NOT_FOUND';
  END IF;

  RETURN QUERY SELECT
    v_public_company_id,
    v_profile.he_name::TEXT,
    v_profile.en_name::TEXT,
    v_profile.vat_number::TEXT,
    v_profile.business_type::TEXT,
    v_profile.city::TEXT,
    v_profile.address::TEXT,
    v_profile.business_email::TEXT,
    v_profile.business_phone::TEXT,
    v_profile.business_fax::TEXT,
    v_profile.accountant_name::TEXT,
    v_profile.accountant_email::TEXT,
    v_profile.accountant_phone::TEXT,
    v_profile.entity_version,
    v_profile.last_updated_at;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.update_api_viewer_profile(UUID, JSONB)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.update_api_company_profile(UUID, BIGINT, JSONB)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.update_api_viewer_profile(UUID, JSONB)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.update_api_company_profile(UUID, BIGINT, JSONB)
TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0014_api_support_conversations.sql
-- ============================================================================
-- Authenticated support-conversation writes for the Node API.
--
-- Public support tables stay read-only to the runtime role. Narrow private
-- functions derive the caller and developer authority from request context,
-- lock each conversation before changing unread counters, and never trust a
-- caller-provided sender or owner identity.

CREATE OR REPLACE FUNCTION private.create_api_support_conversation(
  p_company_id UUID,
  p_category TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_category TEXT := pg_catalog.btrim(p_category);
  v_conversation_id UUID;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF v_category IS NULL OR v_category NOT IN (
    'general', 'bug', 'opinion', 'suggestion', 'support', 'freeChat'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SUPPORT_CATEGORY_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.app_users AS app_user WHERE app_user.id = v_uid_text
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SUPPORT_USER_NOT_FOUND';
  END IF;
  IF p_company_id IS NOT NULL AND NOT private.app_has_company_access(p_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SUPPORT_COMPANY_ACCESS_DENIED';
  END IF;

  INSERT INTO public.support_conversations (
    user_id,
    company_id,
    category,
    status,
    last_message_text,
    last_message_at,
    unread_for_user_count,
    unread_for_dev_count,
    created_at,
    updated_at
  ) VALUES (
    v_uid_text,
    p_company_id,
    v_category,
    'open',
    '',
    pg_catalog.clock_timestamp(),
    0,
    0,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  )
  RETURNING id INTO v_conversation_id;

  RETURN v_conversation_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.append_api_support_message(
  p_conversation_id UUID,
  p_text TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_text TEXT := pg_catalog.btrim(p_text);
  v_is_dev BOOLEAN;
  v_sender_name TEXT;
  v_sender_type public.support_sender_type;
  v_conversation public.support_conversations%ROWTYPE;
  v_message_id UUID;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SUPPORT_CONVERSATION_ID_INVALID';
  END IF;
  IF v_text IS NULL
     OR v_text = ''
     OR pg_catalog.char_length(v_text) > 4000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SUPPORT_MESSAGE_INVALID';
  END IF;

  SELECT conversation.*
  INTO v_conversation
  FROM public.support_conversations AS conversation
  WHERE conversation.id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SUPPORT_CONVERSATION_NOT_FOUND';
  END IF;

  SELECT
    private.app_is_dev(),
    pg_catalog.left(
      COALESCE(
        NULLIF(pg_catalog.btrim(app_user.display_name), ''),
        NULLIF(pg_catalog.btrim(app_user.email), ''),
        v_uid_text
      ),
      200
    )
  INTO v_is_dev, v_sender_name
  FROM public.app_users AS app_user
  WHERE app_user.id = v_uid_text;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SUPPORT_USER_NOT_FOUND';
  END IF;

  IF NOT v_is_dev AND v_conversation.user_id <> v_uid_text THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SUPPORT_CONVERSATION_ACCESS_DENIED';
  END IF;
  IF v_conversation.status = 'closed' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SUPPORT_CONVERSATION_CLOSED';
  END IF;

  v_sender_type := CASE
    WHEN v_is_dev THEN 'dev'::public.support_sender_type
    ELSE 'user'::public.support_sender_type
  END;
  INSERT INTO public.support_messages (
    conversation_id,
    sender_user_id,
    sender_type,
    sender_name_snapshot,
    text,
    created_at
  ) VALUES (
    p_conversation_id,
    v_uid_text,
    v_sender_type,
    v_sender_name,
    v_text,
    v_now
  )
  RETURNING id INTO v_message_id;

  UPDATE public.support_conversations AS conversation
  SET
    last_message_text = v_text,
    last_message_at = v_now,
    unread_for_user_count = CASE
      WHEN v_is_dev THEN conversation.unread_for_user_count + 1
      ELSE 0
    END,
    unread_for_dev_count = CASE
      WHEN v_is_dev THEN 0
      ELSE conversation.unread_for_dev_count + 1
    END,
    updated_at = v_now
  WHERE conversation.id = p_conversation_id;

  RETURN v_message_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.mark_api_support_conversation_read(
  p_conversation_id UUID
) RETURNS TABLE (
  conversation_id UUID,
  unread_for_user INTEGER,
  unread_for_dev INTEGER,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_is_dev BOOLEAN := private.app_is_dev();
  v_conversation public.support_conversations%ROWTYPE;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;

  SELECT conversation.*
  INTO v_conversation
  FROM public.support_conversations AS conversation
  WHERE conversation.id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SUPPORT_CONVERSATION_NOT_FOUND';
  END IF;
  IF NOT v_is_dev AND v_conversation.user_id <> v_uid_text THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SUPPORT_CONVERSATION_ACCESS_DENIED';
  END IF;

  UPDATE public.support_conversations AS conversation
  SET
    unread_for_user_count = CASE WHEN v_is_dev THEN conversation.unread_for_user_count ELSE 0 END,
    unread_for_dev_count = CASE WHEN v_is_dev THEN 0 ELSE conversation.unread_for_dev_count END,
    updated_at = pg_catalog.clock_timestamp()
  WHERE conversation.id = p_conversation_id
  RETURNING
    conversation.id,
    conversation.unread_for_user_count,
    conversation.unread_for_dev_count,
    conversation.updated_at
  INTO conversation_id, unread_for_user, unread_for_dev, updated_at;

  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.close_api_support_conversation(
  p_conversation_id UUID
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_is_dev BOOLEAN := private.app_is_dev();
  v_conversation public.support_conversations%ROWTYPE;
  v_closed_at TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;

  SELECT conversation.*
  INTO v_conversation
  FROM public.support_conversations AS conversation
  WHERE conversation.id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SUPPORT_CONVERSATION_NOT_FOUND';
  END IF;
  IF NOT v_is_dev AND v_conversation.user_id <> v_uid_text THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SUPPORT_CONVERSATION_ACCESS_DENIED';
  END IF;

  UPDATE public.support_conversations AS conversation
  SET status = 'closed', updated_at = v_closed_at
  WHERE conversation.id = p_conversation_id;

  RETURN v_closed_at;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.create_api_support_conversation(UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.append_api_support_message(UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.mark_api_support_conversation_read(UUID)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.close_api_support_conversation(UUID)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.create_api_support_conversation(UUID, TEXT)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.append_api_support_message(UUID, TEXT)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.mark_api_support_conversation_read(UUID)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.close_api_support_conversation(UUID)
TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0015_api_push_devices.sql
-- ============================================================================
-- Per-device push registration for the Node API.
--
-- A single user-column token cannot represent multiple devices and permits a
-- recycled provider token to remain owned by a previous account. Keep provider
-- tokens in a private table, uniquely bind each token to one owner/device, and
-- clear only the current installation during logout.

CREATE TABLE private.push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  device_id_hash BYTEA NOT NULL,
  push_token VARCHAR(500) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT push_devices_device_hash_length_check
    CHECK (octet_length(device_id_hash) = 32),
  CONSTRAINT push_devices_token_present_check
    CHECK (char_length(btrim(push_token)) BETWEEN 8 AND 500),
  CONSTRAINT push_devices_platform_check
    CHECK (platform IN ('ios', 'android')),
  CONSTRAINT push_devices_user_device_unique UNIQUE (user_id, device_id_hash),
  CONSTRAINT push_devices_token_unique UNIQUE (push_token)
);--> statement-breakpoint

CREATE INDEX push_devices_user_updated_idx
  ON private.push_devices (user_id, updated_at DESC);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.register_api_push_device(
  p_device_id TEXT,
  p_token TEXT,
  p_platform TEXT
) RETURNS TABLE (
  push_token_platform TEXT,
  push_token_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_device_id TEXT := pg_catalog.btrim(p_device_id);
  v_token TEXT := pg_catalog.btrim(p_token);
  v_device_hash BYTEA;
  v_token_lock BIGINT;
  v_device_lock BIGINT;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  BEGIN
    v_uid := v_uid_text::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_INVALID';
  END;
  IF NOT EXISTS (
    SELECT 1 FROM public.app_users AS app_user WHERE app_user.id = v_uid_text
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PUSH_DEVICE_USER_NOT_FOUND';
  END IF;
  IF v_device_id IS NULL
     OR pg_catalog.char_length(v_device_id) NOT BETWEEN 16 AND 128
     OR v_device_id !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PUSH_DEVICE_ID_INVALID';
  END IF;
  IF v_token IS NULL OR pg_catalog.char_length(v_token) NOT BETWEEN 8 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PUSH_DEVICE_TOKEN_INVALID';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PUSH_DEVICE_PLATFORM_INVALID';
  END IF;

  v_device_hash := extensions.digest(
    pg_catalog.convert_to(v_device_id, 'UTF8'),
    'sha256'
  );
  v_token_lock := pg_catalog.hashtextextended('push-token:' || v_token, 0);
  v_device_lock := pg_catalog.hashtextextended(
    'push-device:' || v_uid::TEXT || ':' || pg_catalog.encode(v_device_hash, 'hex'),
    0
  );
  IF v_token_lock <= v_device_lock THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(v_token_lock);
    PERFORM pg_catalog.pg_advisory_xact_lock(v_device_lock);
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(v_device_lock);
    PERFORM pg_catalog.pg_advisory_xact_lock(v_token_lock);
  END IF;

  -- This atomically transfers a provider token away from a previous account and
  -- replaces an old token for the same installation.
  DELETE FROM private.push_devices AS device
  WHERE device.push_token = v_token
     OR (device.user_id = v_uid AND device.device_id_hash = v_device_hash);

  INSERT INTO private.push_devices (
    user_id,
    device_id_hash,
    push_token,
    platform,
    created_at,
    updated_at
  ) VALUES (
    v_uid,
    v_device_hash,
    v_token,
    p_platform,
    v_now,
    v_now
  );

  RETURN QUERY SELECT p_platform, v_now;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.clear_api_push_device(
  p_device_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_device_id TEXT := pg_catalog.btrim(p_device_id);
  v_device_hash BYTEA;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  BEGIN
    v_uid := v_uid_text::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_INVALID';
  END;
  IF v_device_id IS NULL
     OR pg_catalog.char_length(v_device_id) NOT BETWEEN 16 AND 128
     OR v_device_id !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PUSH_DEVICE_ID_INVALID';
  END IF;

  v_device_hash := extensions.digest(
    pg_catalog.convert_to(v_device_id, 'UTF8'),
    'sha256'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'push-device:' || v_uid::TEXT || ':' || pg_catalog.encode(v_device_hash, 'hex'),
      0
    )
  );
  DELETE FROM private.push_devices AS device
  WHERE device.user_id = v_uid
    AND device.device_id_hash = v_device_hash;

  RETURN TRUE;
END;
$$;--> statement-breakpoint

REVOKE ALL ON TABLE private.push_devices
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.upsert_api_push_token(TEXT, TEXT)
FROM smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.clear_api_push_token()
FROM smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.register_api_push_device(TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.clear_api_push_device(TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.register_api_push_device(TEXT, TEXT, TEXT)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.clear_api_push_device(TEXT)
TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0016_upload_session_idempotency_limits.sql
-- ============================================================================
-- Deterministic, bounded job-attachment upload-session preparation.
--
-- A session id is the API idempotency-claim UUID. The narrow preparation RPC
-- serializes each user/workspace quota, persists a per-user limiter result, and
-- reuses the exact pending row on retries. Storage signing remains outside the
-- database transaction; repeated initial signing failures eventually enqueue
-- the unconsumed canonical object paths for the existing bounded cleanup job.

ALTER TABLE private.file_upload_sessions
  ADD COLUMN signing_failures INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE private.file_upload_sessions
  ADD COLUMN last_signing_error TEXT;--> statement-breakpoint
ALTER TABLE private.file_upload_sessions
  ADD CONSTRAINT file_upload_sessions_signing_failures_check
    CHECK (signing_failures BETWEEN 0 AND 3);--> statement-breakpoint
ALTER TABLE private.file_upload_sessions
  ADD CONSTRAINT file_upload_sessions_signing_error_length_check
    CHECK (last_signing_error IS NULL OR char_length(last_signing_error) <= 500);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.prepare_api_file_upload_session(
  p_session_id UUID,
  p_company_id UUID,
  p_purpose TEXT,
  p_target_job_id UUID,
  p_bucket_id TEXT,
  p_object_prefix TEXT,
  p_expected_manifest JSONB,
  p_expires_at TIMESTAMPTZ
) RETURNS TABLE (
  outcome TEXT,
  session_id UUID,
  session_expires_at TIMESTAMPTZ,
  session_signing_failures INTEGER,
  rate_limit_reset_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_existing private.file_upload_sessions%ROWTYPE;
  v_bucket_number BIGINT;
  v_window_started_at TIMESTAMPTZ;
  v_reset_at TIMESTAMPTZ;
  v_bucket_key TEXT;
  v_hashed_key TEXT;
  v_hit_count INTEGER;
  v_active_count INTEGER;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  BEGIN
    v_uid := v_uid_text::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_INVALID';
  END;

  IF p_session_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_CONTEXT_REQUIRED';
  END IF;
  IF p_purpose NOT IN ('job.create_finished', 'job.complete_assigned')
     OR (p_purpose = 'job.create_finished' AND p_target_job_id IS NOT NULL)
     OR (p_purpose = 'job.complete_assigned' AND p_target_job_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_PURPOSE_INVALID';
  END IF;
  IF p_expires_at IS NULL
     OR p_expires_at <= v_now + INTERVAL '1 minute'
     OR p_expires_at > v_now + INTERVAL '120 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_EXPIRY_INVALID';
  END IF;
  IF NOT private.app_has_company_access(p_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPLOAD_SESSION_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM private.api_idempotency AS claim
    WHERE claim.id = p_session_id
      AND claim.user_id = v_uid
      AND claim.company_id = p_company_id
      AND claim.operation = 'uploads.job_attachments.prepare'
      AND claim.expires_at > v_now
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPLOAD_IDEMPOTENCY_CLAIM_REQUIRED';
  END IF;
  IF NOT private.file_upload_cleanup_manifest_is_canonical(
    p_session_id,
    p_company_id,
    v_uid,
    p_bucket_id,
    p_object_prefix,
    p_expected_manifest
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_MANIFEST_INVALID';
  END IF;

  -- All new sessions for one user/workspace take the same transaction-scoped
  -- lock, making the active-count check and insert a single serial decision.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'smart-job:upload-session:' || v_uid::TEXT || ':' || p_company_id::TEXT,
      0
    )
  );

  SELECT upload.*
  INTO v_existing
  FROM private.file_upload_sessions AS upload
  WHERE upload.id = p_session_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.user_id <> v_uid
       OR v_existing.company_id <> p_company_id
       OR v_existing.purpose <> p_purpose
       OR v_existing.target_job_id IS DISTINCT FROM p_target_job_id
       OR v_existing.bucket_id <> p_bucket_id
       OR v_existing.object_prefix <> p_object_prefix
       OR v_existing.expected_manifest <> p_expected_manifest THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'UPLOAD_IDEMPOTENCY_SESSION_MISMATCH';
    END IF;

    IF v_existing.status <> 'pending' THEN
      RETURN QUERY SELECT
        'unavailable'::TEXT,
        v_existing.id,
        v_existing.expires_at,
        v_existing.signing_failures,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    IF v_existing.expires_at <= v_now + INTERVAL '1 minute' THEN
      RETURN QUERY SELECT
        'expired'::TEXT,
        v_existing.id,
        v_existing.expires_at,
        v_existing.signing_failures,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      'reused'::TEXT,
      v_existing.id,
      v_existing.expires_at,
      v_existing.signing_failures,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Fixed ten-minute windows: 12 distinct session preparations per user.
  -- Returning a denial (instead of raising) lets the caller commit the bucket.
  v_bucket_number := pg_catalog.floor(EXTRACT(EPOCH FROM v_now) / 600)::BIGINT;
  v_window_started_at := pg_catalog.to_timestamp(v_bucket_number * 600);
  v_reset_at := v_window_started_at + INTERVAL '10 minutes';
  v_hashed_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('api-upload-session:' || v_uid::TEXT, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_bucket_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'api-upload-session:' || v_uid::TEXT || ':' || v_bucket_number::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.rate_limit_buckets AS bucket (
    bucket_key,
    hashed_key,
    window_started_at,
    hit_count,
    expire_at,
    updated_at
  ) VALUES (
    v_bucket_key,
    v_hashed_key,
    v_window_started_at,
    1,
    v_reset_at + INTERVAL '10 minutes',
    v_now
  )
  ON CONFLICT (bucket_key) DO UPDATE
  SET hit_count = bucket.hit_count + 1,
      expire_at = EXCLUDED.expire_at,
      updated_at = v_now
  RETURNING bucket.hit_count INTO v_hit_count;

  IF v_hit_count > 12 THEN
    RETURN QUERY SELECT
      'rate_limited'::TEXT,
      p_session_id,
      NULL::TIMESTAMPTZ,
      0,
      v_reset_at;
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)::INTEGER
  INTO v_active_count
  FROM private.file_upload_sessions AS upload
  WHERE upload.user_id = v_uid
    AND upload.company_id = p_company_id
    AND upload.status = 'pending'
    AND upload.expires_at > v_now;

  IF v_active_count >= 4 THEN
    RETURN QUERY SELECT
      'quota_exceeded'::TEXT,
      p_session_id,
      NULL::TIMESTAMPTZ,
      0,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  INSERT INTO private.file_upload_sessions (
    id,
    user_id,
    company_id,
    purpose,
    target_job_id,
    bucket_id,
    object_prefix,
    expected_manifest,
    status,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    p_session_id,
    v_uid,
    p_company_id,
    p_purpose,
    p_target_job_id,
    p_bucket_id,
    p_object_prefix,
    p_expected_manifest,
    'pending',
    p_expires_at,
    v_now,
    v_now
  );

  RETURN QUERY SELECT
    'created'::TEXT,
    p_session_id,
    p_expires_at,
    0,
    v_reset_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.record_api_file_upload_signing_failure(
  p_session_id UUID,
  p_error TEXT DEFAULT 'signed_url_creation_failed'
) RETURNS TABLE (
  session_status TEXT,
  failure_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_upload private.file_upload_sessions%ROWTYPE;
  v_error TEXT := pg_catalog.left(
    COALESCE(NULLIF(pg_catalog.btrim(p_error), ''), 'signed_url_creation_failed'),
    500
  );
  v_failure_count INTEGER;
  v_status TEXT;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  BEGIN
    v_uid := v_uid_text::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_INVALID';
  END;
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPLOAD_SESSION_CONTEXT_REQUIRED';
  END IF;

  SELECT upload.*
  INTO v_upload
  FROM private.file_upload_sessions AS upload
  WHERE upload.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPLOAD_SESSION_NOT_FOUND';
  END IF;
  IF v_upload.user_id <> v_uid
     OR NOT private.app_has_company_access(v_upload.company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPLOAD_SESSION_FORBIDDEN';
  END IF;

  IF v_upload.status <> 'pending' THEN
    RETURN QUERY SELECT v_upload.status::TEXT, v_upload.signing_failures;
    RETURN;
  END IF;

  v_failure_count := LEAST(v_upload.signing_failures + 1, 3);
  v_status := CASE
    WHEN v_failure_count >= 3 THEN 'cleanup_pending'
    ELSE 'pending'
  END;

  UPDATE private.file_upload_sessions
  SET signing_failures = v_failure_count,
      last_signing_error = v_error,
      status = v_status,
      cleanup_lease_expires_at = NULL,
      last_cleanup_error = CASE
        WHEN v_status = 'cleanup_pending' THEN 'signed_url_creation_failed'
        ELSE last_cleanup_error
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_session_id;

  RETURN QUERY SELECT v_status, v_failure_count;
END;
$$;--> statement-breakpoint

-- All runtime writes now go through the two narrow functions above or the
-- existing create/complete-job SECURITY DEFINER functions.
REVOKE INSERT, UPDATE, DELETE ON private.file_upload_sessions FROM smart_job_api;--> statement-breakpoint
GRANT SELECT ON private.file_upload_sessions TO smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.prepare_api_file_upload_session(
  UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.record_api_file_upload_signing_failure(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.prepare_api_file_upload_session(
  UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, TIMESTAMPTZ
) TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.record_api_file_upload_signing_failure(UUID, TEXT)
  TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0017_api_upgrade_and_contact_requests.sql
-- ============================================================================
-- Upgrade and contact request APIs for the Node runtime.
--
-- Upgrade authority, current tier, requester role, and application of approved
-- modules are derived in SQL. Anonymous contact writes use one non-user request
-- context only for idempotency isolation and can write through a narrow function.

ALTER TABLE public.upgrade_requests
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE public.upgrade_requests
  ADD CONSTRAINT upgrade_requests_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.increment_upgrade_request_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER upgrade_requests_increment_entity_version
BEFORE UPDATE ON public.upgrade_requests
FOR EACH ROW
EXECUTE FUNCTION private.increment_upgrade_request_entity_version();--> statement-breakpoint

CREATE INDEX upgrade_requests_cursor_idx
  ON public.upgrade_requests (created_at DESC, id DESC);--> statement-breakpoint
CREATE INDEX upgrade_requests_status_cursor_idx
  ON public.upgrade_requests (status, created_at DESC, id DESC);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.api_enabled_modules_for_tier(
  p_tier public.subscription_tier
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'team', p_tier IN (
      'Team'::public.subscription_tier,
      'Enterprise'::public.subscription_tier
    ),
    'solojob', p_tier <> 'Basic'::public.subscription_tier,
    'clients', true,
    'documents', true,
    'teaminventory', p_tier IN (
      'Team'::public.subscription_tier,
      'Enterprise'::public.subscription_tier
    ),
    'companyinventory', p_tier IN (
      'Team'::public.subscription_tier,
      'Enterprise'::public.subscription_tier
    ),
    'inventory', p_tier <> 'Basic'::public.subscription_tier
  );
$$;--> statement-breakpoint

CREATE VIEW private.api_upgrade_request_rows AS
SELECT
  upgrade.id AS request_id,
  upgrade.uid::UUID AS requester_uid,
  upgrade.email AS requester_email,
  company.public_company_id,
  upgrade.role,
  upgrade.current_tier,
  upgrade.requested_tier,
  upgrade.message,
  upgrade.status,
  upgrade.moderation_note,
  upgrade.moderated_at,
  upgrade.moderated_by_name,
  upgrade.applied_at,
  upgrade.entity_version,
  upgrade.created_at,
  upgrade.updated_at,
  pg_catalog.to_char(
    upgrade.created_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  ) AS cursor_created_at
FROM public.upgrade_requests AS upgrade
INNER JOIN public.companies AS company
  ON company.id = upgrade.company_id;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.read_api_upgrade_request(
  p_request_id UUID
) RETURNS TABLE (
  request_id UUID,
  requester_uid UUID,
  requester_email TEXT,
  public_company_id BIGINT,
  role TEXT,
  current_tier TEXT,
  requested_tier TEXT,
  message TEXT,
  status TEXT,
  moderation_note TEXT,
  moderated_at TIMESTAMPTZ,
  moderated_by_name TEXT,
  applied_at TIMESTAMPTZ,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  cursor_created_at TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    row.request_id,
    row.requester_uid,
    row.requester_email::TEXT,
    row.public_company_id,
    row.role::TEXT,
    row.current_tier::TEXT,
    row.requested_tier::TEXT,
    row.message,
    row.status::TEXT,
    row.moderation_note,
    row.moderated_at,
    row.moderated_by_name::TEXT,
    row.applied_at,
    row.entity_version,
    row.created_at,
    row.updated_at,
    row.cursor_created_at
  FROM private.api_upgrade_request_rows AS row
  WHERE row.request_id = p_request_id
    AND (private.app_is_dev() OR row.requester_uid::TEXT = v_uid_text)
  LIMIT 1;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.list_api_upgrade_requests(
  p_status TEXT,
  p_after_created_at TIMESTAMPTZ,
  p_after_id UUID,
  p_limit INTEGER
) RETURNS TABLE (
  request_id UUID,
  requester_uid UUID,
  requester_email TEXT,
  public_company_id BIGINT,
  role TEXT,
  current_tier TEXT,
  requested_tier TEXT,
  message TEXT,
  status TEXT,
  moderation_note TEXT,
  moderated_at TIMESTAMPTZ,
  moderated_by_name TEXT,
  applied_at TIMESTAMPTZ,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  cursor_created_at TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.app_is_dev() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_REQUEST_DEV_REQUIRED';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_STATUS_INVALID';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_CURSOR_INVALID';
  END IF;

  RETURN QUERY
  SELECT
    row.request_id,
    row.requester_uid,
    row.requester_email::TEXT,
    row.public_company_id,
    row.role::TEXT,
    row.current_tier::TEXT,
    row.requested_tier::TEXT,
    row.message,
    row.status::TEXT,
    row.moderation_note,
    row.moderated_at,
    row.moderated_by_name::TEXT,
    row.applied_at,
    row.entity_version,
    row.created_at,
    row.updated_at,
    row.cursor_created_at
  FROM private.api_upgrade_request_rows AS row
  WHERE (p_status IS NULL OR row.status = p_status)
    AND (
      p_after_created_at IS NULL
      OR (row.created_at, row.request_id) < (p_after_created_at, p_after_id)
    )
  ORDER BY row.created_at DESC, row.request_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 201);
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.consume_api_upgrade_request_rate_limit()
RETURNS TABLE (allowed BOOLEAN, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_bucket_number BIGINT;
  v_window_started_at TIMESTAMPTZ;
  v_reset_at TIMESTAMPTZ;
  v_bucket_key TEXT;
  v_hashed_key TEXT;
  v_hit_count INTEGER;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  v_bucket_number := pg_catalog.floor(EXTRACT(EPOCH FROM v_now) / 60)::BIGINT;
  v_window_started_at := pg_catalog.to_timestamp(v_bucket_number * 60);
  v_reset_at := v_window_started_at + INTERVAL '1 minute';
  v_hashed_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('api-upgrade-request:' || v_uid_text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_bucket_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'api-upgrade-request:' || v_uid_text || ':' || v_bucket_number::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.rate_limit_buckets AS bucket (
    bucket_key, hashed_key, window_started_at, hit_count, expire_at, updated_at
  ) VALUES (
    v_bucket_key, v_hashed_key, v_window_started_at, 1,
    v_reset_at + INTERVAL '1 minute', v_now
  )
  ON CONFLICT (bucket_key) DO UPDATE
  SET hit_count = bucket.hit_count + 1,
      expire_at = EXCLUDED.expire_at,
      updated_at = v_now
  RETURNING bucket.hit_count INTO v_hit_count;

  RETURN QUERY SELECT v_hit_count <= 5, v_reset_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_upgrade_request(
  p_company_id UUID,
  p_requested_tier TEXT,
  p_message TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_email TEXT;
  v_role TEXT;
  v_requested_tier public.subscription_tier;
  v_current_tier public.subscription_tier;
  v_message TEXT := pg_catalog.btrim(p_message);
  v_request_id UUID;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid_text IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_CONTEXT_REQUIRED';
  END IF;
  BEGIN
    v_uid := v_uid_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_INVALID';
  END;
  IF v_message IS NULL OR pg_catalog.char_length(v_message) < 10
     OR pg_catalog.char_length(v_message) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_MESSAGE_INVALID';
  END IF;
  IF p_requested_tier IS NULL OR p_requested_tier NOT IN ('Solo', 'Team', 'Enterprise') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_TIER_INVALID';
  END IF;
  v_requested_tier := p_requested_tier::public.subscription_tier;

  SELECT pg_catalog.lower(pg_catalog.btrim(auth_user.email))
  INTO v_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = v_uid
    AND auth_user.email_confirmed_at IS NOT NULL
    AND auth_user.deleted_at IS NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_VERIFIED_EMAIL_REQUIRED';
  END IF;
  IF NOT private.app_has_company_access(p_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_COMPANY_ACCESS_DENIED';
  END IF;

  SELECT membership.role::TEXT
  INTO v_role
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid_text
    AND membership.status = 'active'
  LIMIT 1;
  IF v_role IS NULL THEN
    IF private.app_is_dev() THEN
      v_role := 'dev';
    ELSE
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_MEMBERSHIP_REQUIRED';
    END IF;
  END IF;

  SELECT subscription.tier
  INTO v_current_tier
  FROM public.company_subscriptions AS subscription
  WHERE subscription.company_id = p_company_id
  LIMIT 1;
  IF v_current_tier IS NULL THEN
    v_current_tier := 'Basic'::public.subscription_tier;
  END IF;
  IF v_current_tier = v_requested_tier THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_CURRENT_TIER_MATCH';
  END IF;

  INSERT INTO public.upgrade_requests (
    uid, email, company_id, role, current_tier, requested_tier, message,
    status, created_at, updated_at
  ) VALUES (
    v_uid_text, v_email, p_company_id, v_role, v_current_tier::TEXT,
    v_requested_tier::TEXT, v_message, 'pending', v_now, v_now
  )
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.moderate_api_upgrade_request(
  p_request_id UUID,
  p_status TEXT,
  p_moderation_note TEXT,
  p_expected_entity_version BIGINT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_uid UUID;
  v_moderator_name TEXT;
  v_note TEXT := NULLIF(pg_catalog.btrim(p_moderation_note), '');
  v_upgrade public.upgrade_requests%ROWTYPE;
  v_requested_tier public.subscription_tier;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid_text IS NULL OR NOT private.app_is_dev() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_REQUEST_DEV_REQUIRED';
  END IF;
  BEGIN
    v_uid := v_uid_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_INVALID';
  END;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS auth_user
    WHERE auth_user.id = v_uid
      AND auth_user.email_confirmed_at IS NOT NULL
      AND auth_user.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UPGRADE_VERIFIED_EMAIL_REQUIRED';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_STATUS_INVALID';
  END IF;
  IF v_note IS NOT NULL AND pg_catalog.char_length(v_note) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_NOTE_INVALID';
  END IF;

  SELECT upgrade.*
  INTO v_upgrade
  FROM public.upgrade_requests AS upgrade
  WHERE upgrade.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_upgrade.company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPGRADE_REQUEST_NOT_FOUND';
  END IF;
  IF v_upgrade.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'UPGRADE_REQUEST_VERSION_CONFLICT';
  END IF;
  IF v_upgrade.applied_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UPGRADE_REQUEST_ALREADY_APPLIED';
  END IF;

  SELECT COALESCE(
    NULLIF(pg_catalog.btrim(app_user.display_name), ''),
    NULLIF(pg_catalog.btrim(app_user.email), ''),
    v_uid_text
  )
  INTO v_moderator_name
  FROM public.app_users AS app_user
  WHERE app_user.id = v_uid_text;
  v_moderator_name := pg_catalog.left(COALESCE(v_moderator_name, v_uid_text), 200);

  IF p_status = 'approved' THEN
    v_requested_tier := v_upgrade.requested_tier::public.subscription_tier;
    UPDATE public.company_subscriptions AS subscription
    SET tier = v_requested_tier,
        status = 'active',
        enabled_modules = private.api_enabled_modules_for_tier(v_requested_tier),
        updated_at = v_now
    WHERE subscription.company_id = v_upgrade.company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPGRADE_SUBSCRIPTION_NOT_FOUND';
    END IF;
  END IF;

  UPDATE public.upgrade_requests AS upgrade
  SET status = p_status,
      moderation_note = v_note,
      moderated_at = v_now,
      moderated_by_uid = v_uid_text,
      moderated_by_name = v_moderator_name,
      applied_at = CASE WHEN p_status = 'approved' THEN v_now ELSE NULL END,
      applied_by_uid = CASE WHEN p_status = 'approved' THEN v_uid_text ELSE NULL END,
      updated_at = v_now
  WHERE upgrade.id = p_request_id;

  RETURN p_request_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.consume_api_contact_request_rate_limit(
  p_email TEXT
) RETURNS TABLE (allowed BOOLEAN, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_context_uid TEXT := private.app_auth_uid();
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_bucket_number BIGINT;
  v_window_started_at TIMESTAMPTZ;
  v_reset_at TIMESTAMPTZ;
  v_bucket_key TEXT;
  v_hashed_key TEXT;
  v_hit_count INTEGER;
BEGIN
  IF v_context_uid <> '00000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CONTACT_ANONYMOUS_CONTEXT_REQUIRED';
  END IF;
  IF v_email IS NULL OR pg_catalog.char_length(v_email) > 320
     OR pg_catalog.strpos(v_email, '@') <= 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTACT_EMAIL_INVALID';
  END IF;

  v_bucket_number := pg_catalog.floor(EXTRACT(EPOCH FROM v_now) / 60)::BIGINT;
  v_window_started_at := pg_catalog.to_timestamp(v_bucket_number * 60);
  v_reset_at := v_window_started_at + INTERVAL '1 minute';
  v_hashed_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('api-contact-request:' || v_email, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_bucket_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'api-contact-request:' || v_email || ':' || v_bucket_number::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.rate_limit_buckets AS bucket (
    bucket_key, hashed_key, window_started_at, hit_count, expire_at, updated_at
  ) VALUES (
    v_bucket_key, v_hashed_key, v_window_started_at, 1,
    v_reset_at + INTERVAL '1 minute', v_now
  )
  ON CONFLICT (bucket_key) DO UPDATE
  SET hit_count = bucket.hit_count + 1,
      expire_at = EXCLUDED.expire_at,
      updated_at = v_now
  RETURNING bucket.hit_count INTO v_hit_count;

  RETURN QUERY SELECT v_hit_count <= 5, v_reset_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_contact_request(
  p_name TEXT,
  p_email TEXT,
  p_company TEXT,
  p_subject TEXT,
  p_message TEXT
) RETURNS TABLE (request_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_context_uid TEXT := private.app_auth_uid();
  v_name TEXT := pg_catalog.btrim(p_name);
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_company TEXT := pg_catalog.btrim(p_company);
  v_subject TEXT := NULLIF(pg_catalog.btrim(p_subject), '');
  v_message TEXT := pg_catalog.btrim(p_message);
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_context_uid <> '00000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CONTACT_ANONYMOUS_CONTEXT_REQUIRED';
  END IF;
  IF v_name IS NULL OR pg_catalog.char_length(v_name) < 2
     OR pg_catalog.char_length(v_name) > 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTACT_NAME_INVALID';
  END IF;
  IF v_email IS NULL OR pg_catalog.char_length(v_email) > 320
     OR pg_catalog.strpos(v_email, '@') <= 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTACT_EMAIL_INVALID';
  END IF;
  IF v_company IS NULL OR pg_catalog.char_length(v_company) < 2
     OR pg_catalog.char_length(v_company) > 140 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTACT_COMPANY_INVALID';
  END IF;
  IF v_subject IS NOT NULL AND (
    pg_catalog.char_length(v_subject) < 2 OR pg_catalog.char_length(v_subject) > 500
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTACT_SUBJECT_INVALID';
  END IF;
  IF v_message IS NULL OR pg_catalog.char_length(v_message) < 8
     OR pg_catalog.char_length(v_message) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTACT_MESSAGE_INVALID';
  END IF;

  INSERT INTO public.contact_requests (
    name, email, company, subject, message, status, created_at, updated_at, expire_at
  ) VALUES (
    v_name, v_email, v_company, v_subject, v_message, 'new', v_now, v_now,
    v_now + INTERVAL '180 days'
  )
  RETURNING id, public.contact_requests.created_at
  INTO request_id, created_at;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

REVOKE ALL ON private.api_upgrade_request_rows
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.increment_upgrade_request_entity_version()
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.api_enabled_modules_for_tier(public.subscription_tier)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.read_api_upgrade_request(UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.list_api_upgrade_requests(TEXT, TIMESTAMPTZ, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.consume_api_upgrade_request_rate_limit()
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.create_api_upgrade_request(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.moderate_api_upgrade_request(UUID, TEXT, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.consume_api_contact_request_rate_limit(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.create_api_contact_request(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.read_api_upgrade_request(UUID)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.list_api_upgrade_requests(TEXT, TIMESTAMPTZ, UUID, INTEGER)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.consume_api_upgrade_request_rate_limit()
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.create_api_upgrade_request(UUID, TEXT, TEXT)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.moderate_api_upgrade_request(UUID, TEXT, TEXT, BIGINT)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.consume_api_contact_request_rate_limit(TEXT)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.create_api_contact_request(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0018_api_client_mutations.sql
-- ============================================================================
-- Secure client master-data mutations for the Node API.
--
-- The API runtime receives only EXECUTE on the three entrypoints below. Caller
-- identity, tenant authority, module entitlement, membership role, sequential
-- client numbers, optimistic concurrency, reference-safe removal, and sync
-- version changes remain inside one database transaction.

ALTER TABLE public.clients
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT clients_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

CREATE INDEX clients_company_status_created_cursor_idx
  ON public.clients (company_id, status, created_at DESC, id DESC);--> statement-breakpoint

CREATE INDEX jobs_company_client_reference_idx
  ON public.jobs (company_id, client_id)
  WHERE client_id IS NOT NULL;--> statement-breakpoint

CREATE INDEX documents_company_client_reference_idx
  ON public.documents (company_id, client_id)
  WHERE client_id IS NOT NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.increment_client_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER clients_increment_entity_version
BEFORE UPDATE ON public.clients
FOR EACH ROW
EXECUTE FUNCTION private.increment_client_entity_version();--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.require_api_client_mutation_access(
  p_company_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_membership_id UUID;
  v_clients_enabled BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_company_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.companies AS company
    WHERE company.id = p_company_id
      AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CLIENT_COMPANY_NOT_FOUND';
  END IF;

  SELECT entitlement.clients_enabled
  INTO v_clients_enabled
  FROM private.get_company_module_entitlements(p_company_id) AS entitlement;
  IF NOT COALESCE(v_clients_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CLIENTS_MODULE_DISABLED';
  END IF;

  IF private.app_is_dev() THEN
    RETURN NULL;
  END IF;

  SELECT membership.id
  INTO v_membership_id
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid
    AND membership.status = 'active'
    AND membership.role IN ('manager', 'user', 'basic')
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CLIENT_MUTATION_FORBIDDEN';
  END IF;
  RETURN v_membership_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.validate_api_client_payload(
  p_payload JSONB,
  p_require_name BOOLEAN,
  p_allow_status BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_key TEXT;
  v_value TEXT;
  v_max_length INTEGER;
BEGIN
  IF p_payload IS NULL
     OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
     OR p_payload = '{}'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_PAYLOAD_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_payload) AS payload_key(key)
    WHERE payload_key.key NOT IN (
      'name', 'phone', 'email', 'address', 'city', 'vatNumber', 'notes', 'status'
    )
       OR (payload_key.key = 'status' AND NOT p_allow_status)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_PAYLOAD_FIELDS_INVALID';
  END IF;
  IF p_require_name AND NOT (p_payload ? 'name') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_NAME_REQUIRED';
  END IF;

  IF p_payload ? 'name' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'name') <> 'string'
       OR pg_catalog.btrim(p_payload ->> 'name') = ''
       OR pg_catalog.char_length(pg_catalog.btrim(p_payload ->> 'name')) > 240
       OR (p_payload ->> 'name') ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_NAME_INVALID';
    END IF;
  END IF;

  FOR v_key, v_max_length IN
    SELECT * FROM (VALUES
      ('phone', 40),
      ('email', 320),
      ('address', 500),
      ('city', 120),
      ('vatNumber', 32),
      ('notes', 2000)
    ) AS allowed_field(key, max_length)
  LOOP
    IF p_payload ? v_key THEN
      IF pg_catalog.jsonb_typeof(p_payload -> v_key) NOT IN ('string', 'null') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_FIELD_INVALID';
      END IF;
      v_value := p_payload ->> v_key;
      IF v_value IS NOT NULL
         AND (
           pg_catalog.btrim(v_value) = ''
           OR pg_catalog.char_length(pg_catalog.btrim(v_value)) > v_max_length
         ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_FIELD_INVALID';
      END IF;
      IF v_value IS NOT NULL
         AND v_key <> 'notes'
         AND v_value ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_FIELD_INVALID';
      END IF;
    END IF;
  END LOOP;

  IF p_payload ->> 'email' IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(p_payload ->> 'email'))
       !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_EMAIL_INVALID';
  END IF;
  IF p_allow_status AND p_payload ? 'status' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'status') <> 'string'
       OR p_payload ->> 'status' NOT IN ('active', 'archived') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_STATUS_INVALID';
    END IF;
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_client(
  p_company_id UUID,
  p_payload JSONB,
  p_created_at TIMESTAMPTZ
) RETURNS TABLE (
  client_id UUID,
  client_no INTEGER,
  status TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  vat_number TEXT,
  notes TEXT,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_client_no INTEGER;
  v_client public.clients%ROWTYPE;
  v_created_at TIMESTAMPTZ := COALESCE(p_created_at, pg_catalog.clock_timestamp());
BEGIN
  v_membership_id := private.require_api_client_mutation_access(p_company_id);
  PERFORM private.validate_api_client_payload(p_payload, true, false);
  v_client_no := private.allocate_company_counter(p_company_id, 'client_no');

  INSERT INTO public.clients (
    company_id,
    client_no,
    status,
    name,
    phone,
    email,
    address,
    city,
    vat_number,
    notes,
    created_by_membership_id,
    created_at,
    updated_at
  ) VALUES (
    p_company_id,
    v_client_no,
    'active',
    pg_catalog.btrim(p_payload ->> 'name'),
    NULLIF(pg_catalog.btrim(p_payload ->> 'phone'), ''),
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_payload ->> 'email')), ''),
    NULLIF(pg_catalog.btrim(p_payload ->> 'address'), ''),
    NULLIF(pg_catalog.btrim(p_payload ->> 'city'), ''),
    NULLIF(pg_catalog.btrim(p_payload ->> 'vatNumber'), ''),
    NULLIF(pg_catalog.btrim(p_payload ->> 'notes'), ''),
    v_membership_id,
    v_created_at,
    v_created_at
  )
  RETURNING * INTO v_client;

  PERFORM private.bump_company_sync_version(p_company_id, 'clients_version');

  RETURN QUERY SELECT
    v_client.id,
    v_client.client_no,
    v_client.status::TEXT,
    v_client.name::TEXT,
    v_client.phone::TEXT,
    v_client.email::TEXT,
    v_client.address::TEXT,
    v_client.city::TEXT,
    v_client.vat_number::TEXT,
    v_client.notes::TEXT,
    v_client.entity_version,
    v_client.created_at,
    v_client.updated_at,
    v_client.archived_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.update_api_client(
  p_company_id UUID,
  p_client_id UUID,
  p_expected_entity_version BIGINT,
  p_patch JSONB,
  p_updated_at TIMESTAMPTZ
) RETURNS TABLE (
  client_id UUID,
  client_no INTEGER,
  status TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  vat_number TEXT,
  notes TEXT,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_updated_at TIMESTAMPTZ := COALESCE(p_updated_at, pg_catalog.clock_timestamp());
BEGIN
  PERFORM private.require_api_client_mutation_access(p_company_id);
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_ID_INVALID';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_VERSION_INVALID';
  END IF;
  PERFORM private.validate_api_client_payload(p_patch, false, true);

  UPDATE public.clients AS client
  SET
    name = CASE WHEN p_patch ? 'name'
      THEN pg_catalog.btrim(p_patch ->> 'name') ELSE client.name END,
    phone = CASE WHEN p_patch ? 'phone'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'phone'), '') ELSE client.phone END,
    email = CASE WHEN p_patch ? 'email'
      THEN NULLIF(pg_catalog.lower(pg_catalog.btrim(p_patch ->> 'email')), '') ELSE client.email END,
    address = CASE WHEN p_patch ? 'address'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'address'), '') ELSE client.address END,
    city = CASE WHEN p_patch ? 'city'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'city'), '') ELSE client.city END,
    vat_number = CASE WHEN p_patch ? 'vatNumber'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'vatNumber'), '') ELSE client.vat_number END,
    notes = CASE WHEN p_patch ? 'notes'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'notes'), '') ELSE client.notes END,
    status = CASE WHEN p_patch ? 'status'
      THEN (p_patch ->> 'status')::public.client_status ELSE client.status END,
    archived_at = CASE
      WHEN p_patch ->> 'status' = 'active' THEN NULL
      WHEN p_patch ->> 'status' = 'archived' THEN COALESCE(client.archived_at, v_updated_at)
      ELSE client.archived_at
    END,
    updated_at = v_updated_at
  WHERE client.company_id = p_company_id
    AND client.id = p_client_id
    AND client.entity_version = p_expected_entity_version
  RETURNING client.* INTO v_client;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.clients AS existing_client
      WHERE existing_client.company_id = p_company_id
        AND existing_client.id = p_client_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'CLIENT_ENTITY_VERSION_CONFLICT';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CLIENT_NOT_FOUND';
  END IF;

  PERFORM private.bump_company_sync_version(p_company_id, 'clients_version');

  RETURN QUERY SELECT
    v_client.id,
    v_client.client_no,
    v_client.status::TEXT,
    v_client.name::TEXT,
    v_client.phone::TEXT,
    v_client.email::TEXT,
    v_client.address::TEXT,
    v_client.city::TEXT,
    v_client.vat_number::TEXT,
    v_client.notes::TEXT,
    v_client.entity_version,
    v_client.created_at,
    v_client.updated_at,
    v_client.archived_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.delete_or_archive_api_client(
  p_company_id UUID,
  p_client_id UUID,
  p_expected_entity_version BIGINT,
  p_removed_at TIMESTAMPTZ
) RETURNS TABLE (
  client_id UUID,
  client_no INTEGER,
  disposition TEXT,
  entity_version BIGINT,
  archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_removed_at TIMESTAMPTZ := COALESCE(p_removed_at, pg_catalog.clock_timestamp());
  v_referenced BOOLEAN;
BEGIN
  PERFORM private.require_api_client_mutation_access(p_company_id);
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_ID_INVALID';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_VERSION_INVALID';
  END IF;

  SELECT client.*
  INTO v_client
  FROM public.clients AS client
  WHERE client.company_id = p_company_id
    AND client.id = p_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CLIENT_NOT_FOUND';
  END IF;
  IF v_client.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'CLIENT_ENTITY_VERSION_CONFLICT';
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.jobs AS job
      WHERE job.company_id = p_company_id
        AND job.client_id = p_client_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.documents AS document
      WHERE document.company_id = p_company_id
        AND document.client_id = p_client_id
    )
  INTO v_referenced;

  IF v_referenced THEN
    UPDATE public.clients AS client
    SET
      status = 'archived',
      archived_at = COALESCE(client.archived_at, v_removed_at),
      updated_at = v_removed_at
    WHERE client.id = p_client_id
      AND client.company_id = p_company_id
    RETURNING client.* INTO v_client;

    client_id := v_client.id;
    client_no := v_client.client_no;
    disposition := 'archived';
    entity_version := v_client.entity_version;
    archived_at := v_client.archived_at;
  ELSE
    DELETE FROM public.clients AS client
    WHERE client.id = p_client_id
      AND client.company_id = p_company_id;

    client_id := v_client.id;
    client_no := v_client.client_no;
    disposition := 'deleted';
    entity_version := NULL;
    archived_at := NULL;
  END IF;

  PERFORM private.bump_company_sync_version(p_company_id, 'clients_version');
  RETURN NEXT;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.increment_client_entity_version()
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.require_api_client_mutation_access(UUID)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.validate_api_client_payload(JSONB, BOOLEAN, BOOLEAN)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.create_api_client(UUID, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.update_api_client(UUID, UUID, BIGINT, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.delete_or_archive_api_client(UUID, UUID, BIGINT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.create_api_client(UUID, JSONB, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.update_api_client(UUID, UUID, BIGINT, JSONB, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.delete_or_archive_api_client(UUID, UUID, BIGINT, TIMESTAMPTZ)
TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0019_api_inventory_mutations.sql
-- ============================================================================
-- Secure, versioned, and atomic inventory mutations for the Node API.

ALTER TABLE public.inventory_parts
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT inventory_parts_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

ALTER TABLE public.inventory_balances
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT inventory_balances_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.increment_inventory_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER inventory_parts_increment_entity_version
BEFORE UPDATE ON public.inventory_parts
FOR EACH ROW
EXECUTE FUNCTION private.increment_inventory_entity_version();--> statement-breakpoint

CREATE TRIGGER inventory_balances_increment_entity_version
BEFORE UPDATE ON public.inventory_balances
FOR EACH ROW
EXECUTE FUNCTION private.increment_inventory_entity_version();--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.require_api_inventory_access(
  p_company_id UUID,
  p_manager_required BOOLEAN
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_membership_id UUID;
  v_inventory_enabled BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_company_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.companies AS company
    WHERE company.id = p_company_id AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_COMPANY_NOT_FOUND';
  END IF;

  SELECT entitlement.inventory_enabled
  INTO v_inventory_enabled
  FROM private.get_company_module_entitlements(p_company_id) AS entitlement;
  IF NOT COALESCE(v_inventory_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_MODULE_DISABLED';
  END IF;

  IF private.app_is_dev() THEN
    RETURN NULL;
  END IF;

  SELECT membership.id
  INTO v_membership_id
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid
    AND membership.status = 'active'
    AND membership.role IN ('manager', 'worker', 'user')
    AND (NOT p_manager_required OR membership.role = 'manager')
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_MUTATION_FORBIDDEN';
  END IF;
  RETURN v_membership_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.ensure_api_inventory_location(
  p_company_id UUID,
  p_location_type public.inventory_location_type,
  p_membership_id UUID,
  p_created_at TIMESTAMPTZ
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_location_id UUID;
BEGIN
  IF p_location_type NOT IN ('company', 'member', 'adjustment') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_LOCATION_TYPE_INVALID';
  END IF;
  IF (p_location_type = 'member') <> (p_membership_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_LOCATION_MEMBERSHIP_INVALID';
  END IF;
  IF p_membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_memberships AS membership
    WHERE membership.id = p_membership_id
      AND membership.company_id = p_company_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_MEMBER_NOT_FOUND';
  END IF;

  INSERT INTO public.inventory_locations AS location (
    company_id, location_type, membership_id, name, created_at
  ) VALUES (
    p_company_id,
    p_location_type,
    p_membership_id,
    CASE p_location_type
      WHEN 'company' THEN 'Company Inventory'
      WHEN 'adjustment' THEN 'Inventory Adjustments'
      ELSE 'Member Inventory'
    END,
    COALESCE(p_created_at, pg_catalog.clock_timestamp())
  ) ON CONFLICT DO NOTHING;

  SELECT location.id INTO v_location_id
  FROM public.inventory_locations AS location
  WHERE location.company_id = p_company_id
    AND location.location_type = p_location_type
    AND location.membership_id IS NOT DISTINCT FROM p_membership_id
  LIMIT 1;
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_LOCATION_NOT_FOUND';
  END IF;
  RETURN v_location_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.get_api_inventory_snapshot(
  p_company_id UUID,
  p_part_id UUID,
  p_location_id UUID
) RETURNS TABLE (
  part_id UUID,
  part_no INTEGER,
  status TEXT,
  name TEXT,
  active BOOLEAN,
  quantity_on_hand NUMERIC,
  low_threshold NUMERIC,
  unit TEXT,
  entity_version BIGINT,
  stock_entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    part.id,
    part.part_no,
    CASE
      WHEN part.archived_at IS NOT NULL THEN 'archived'
      WHEN part.active THEN 'active'
      ELSE 'inactive'
    END,
    part.name::TEXT,
    part.active,
    COALESCE(balance.quantity_on_hand, 0),
    part.low_threshold,
    part.unit::TEXT,
    part.entity_version,
    COALESCE(balance.entity_version, 1),
    part.created_at,
    GREATEST(part.updated_at, COALESCE(balance.updated_at, part.updated_at)),
    part.archived_at
  FROM public.inventory_parts AS part
  LEFT JOIN public.inventory_balances AS balance
    ON balance.location_id = p_location_id
   AND balance.part_id = part.id
  WHERE part.company_id = p_company_id
    AND part.id = p_part_id;
$$;--> statement-breakpoint

-- Harden the shared movement primitive used by API inventory, legacy Edge, and
-- atomic job completion. Every referenced entity must belong to one tenant and
-- both balance rows are locked in canonical location order.
CREATE OR REPLACE FUNCTION private.apply_inventory_movement(
  p_company_id UUID,
  p_part_id UUID,
  p_quantity NUMERIC,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_movement_type public.inventory_movement_type,
  p_created_by_membership_id UUID,
  p_job_id UUID DEFAULT NULL,
  p_document_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT pg_catalog.now()
) RETURNS TABLE (
  movement_id UUID,
  from_quantity NUMERIC,
  to_quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from_quantity NUMERIC := NULL;
  v_to_quantity NUMERIC := NULL;
  v_created_at TIMESTAMPTZ := COALESCE(p_created_at, pg_catalog.clock_timestamp());
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0
     OR p_quantity > 99999999999.999
     OR p_quantity <> pg_catalog.round(p_quantity, 3) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_QUANTITY_INVALID';
  END IF;
  IF p_from_location_id IS NULL AND p_to_location_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_LOCATION_REQUIRED';
  END IF;
  IF p_from_location_id IS NOT NULL AND p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_LOCATIONS_IDENTICAL';
  END IF;
  IF p_note IS NOT NULL AND pg_catalog.char_length(p_note) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_NOTE_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_parts AS part
    WHERE part.id = p_part_id AND part.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES (p_from_location_id), (p_to_location_id)) AS wanted(id)
    WHERE wanted.id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_locations AS location
        WHERE location.id = wanted.id AND location.company_id = p_company_id
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_LOCATION_TENANT_MISMATCH';
  END IF;
  IF p_created_by_membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_memberships AS membership
    WHERE membership.id = p_created_by_membership_id
      AND membership.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_CREATOR_TENANT_MISMATCH';
  END IF;
  IF p_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.jobs AS job
    WHERE job.id = p_job_id AND job.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_JOB_TENANT_MISMATCH';
  END IF;
  IF p_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.documents AS document
    WHERE document.id = p_document_id AND document.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_DOCUMENT_TENANT_MISMATCH';
  END IF;

  INSERT INTO public.inventory_balances AS balance (
    location_id, part_id, quantity_on_hand, updated_at
  )
  SELECT location_id, p_part_id, 0, v_created_at
  FROM (VALUES (p_from_location_id), (p_to_location_id)) AS wanted(location_id)
  WHERE wanted.location_id IS NOT NULL
  ON CONFLICT ON CONSTRAINT inventory_balances_pk DO NOTHING;

  PERFORM balance.location_id
  FROM public.inventory_balances AS balance
  WHERE balance.part_id = p_part_id
    AND balance.location_id IN (p_from_location_id, p_to_location_id)
  ORDER BY balance.location_id
  FOR UPDATE;

  IF p_from_location_id IS NOT NULL THEN
    UPDATE public.inventory_balances AS balance
    SET quantity_on_hand = balance.quantity_on_hand - p_quantity,
        updated_at = v_created_at
    WHERE balance.location_id = p_from_location_id
      AND balance.part_id = p_part_id
      AND balance.quantity_on_hand >= p_quantity
    RETURNING balance.quantity_on_hand INTO v_from_quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'inventory_insufficient_stock';
    END IF;
  END IF;

  IF p_to_location_id IS NOT NULL THEN
    UPDATE public.inventory_balances AS balance
    SET quantity_on_hand = balance.quantity_on_hand + p_quantity,
        updated_at = v_created_at
    WHERE balance.location_id = p_to_location_id
      AND balance.part_id = p_part_id
    RETURNING balance.quantity_on_hand INTO v_to_quantity;
  END IF;

  INSERT INTO public.inventory_movements AS movement (
    company_id, part_id, quantity, from_location_id, to_location_id,
    movement_type, job_id, document_id, created_by_membership_id, note, created_at
  ) VALUES (
    p_company_id, p_part_id, p_quantity, p_from_location_id, p_to_location_id,
    p_movement_type, p_job_id, p_document_id, p_created_by_membership_id,
    NULLIF(pg_catalog.btrim(p_note), ''), v_created_at
  ) RETURNING movement.id INTO movement_id;

  from_quantity := v_from_quantity;
  to_quantity := v_to_quantity;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.apply_inventory_pick_batch(
  p_company_id UUID,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_created_by_membership_id UUID,
  p_picks JSONB,
  p_created_at TIMESTAMPTZ DEFAULT pg_catalog.now()
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pick RECORD;
  v_movement RECORD;
  v_count INTEGER;
  v_distinct_count INTEGER;
BEGIN
  IF p_picks IS NULL OR pg_catalog.jsonb_typeof(p_picks) <> 'array'
     OR pg_catalog.jsonb_array_length(p_picks) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICKS_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations AS location
    WHERE location.id = p_from_location_id
      AND location.company_id = p_company_id
      AND location.location_type = 'company'
      AND location.membership_id IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.inventory_locations AS location
    WHERE location.id = p_to_location_id
      AND location.company_id = p_company_id
      AND location.location_type = 'member'
      AND location.membership_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_PICK_LOCATION_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_picks) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_object_keys(item.value) AS key(name)
         WHERE key.name NOT IN ('part_id', 'part_no', 'quantity')
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICK_FIELDS_INVALID';
  END IF;

  SELECT pg_catalog.count(*), pg_catalog.count(DISTINCT parsed.part_id)
  INTO v_count, v_distinct_count
  FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
    part_id UUID, part_no INTEGER, quantity NUMERIC
  );
  IF v_count <> v_distinct_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICK_DUPLICATE_PART';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
      part_id UUID, part_no INTEGER, quantity NUMERIC
    )
    LEFT JOIN public.inventory_parts AS part
      ON part.id = parsed.part_id AND part.company_id = p_company_id
    WHERE parsed.part_id IS NULL
       OR parsed.quantity IS NULL OR parsed.quantity <= 0
       OR parsed.quantity > 99999999999.999
       OR parsed.quantity <> pg_catalog.round(parsed.quantity, 3)
       OR part.id IS NULL OR part.archived_at IS NOT NULL OR NOT part.active
       OR (parsed.part_no IS NOT NULL AND parsed.part_no <> part.part_no)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICK_ITEM_INVALID';
  END IF;

  INSERT INTO public.inventory_balances AS balance (
    location_id, part_id, quantity_on_hand, updated_at
  )
  SELECT p_from_location_id, parsed.part_id, 0, COALESCE(p_created_at, pg_catalog.clock_timestamp())
  FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
    part_id UUID, part_no INTEGER, quantity NUMERIC
  )
  ON CONFLICT ON CONSTRAINT inventory_balances_pk DO NOTHING;

  PERFORM balance.part_id
  FROM public.inventory_balances AS balance
  WHERE balance.location_id = p_from_location_id
    AND balance.part_id IN (
      SELECT parsed.part_id
      FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
        part_id UUID, part_no INTEGER, quantity NUMERIC
      )
    )
  ORDER BY balance.part_id
  FOR UPDATE;

  FOR v_pick IN
    SELECT parsed.part_id, part.part_no, parsed.quantity
    FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
      part_id UUID, part_no INTEGER, quantity NUMERIC
    )
    INNER JOIN public.inventory_parts AS part
      ON part.id = parsed.part_id AND part.company_id = p_company_id
    ORDER BY parsed.part_id
  LOOP
    SELECT movement.* INTO v_movement
    FROM private.apply_inventory_movement(
      p_company_id,
      v_pick.part_id,
      v_pick.quantity,
      p_from_location_id,
      p_to_location_id,
      'pick'::public.inventory_movement_type,
      p_created_by_membership_id,
      NULL,
      NULL,
      'Picked part #' || v_pick.part_no::TEXT,
      p_created_at
    ) AS movement;
    movement_id := v_movement.movement_id;
    part_id := v_pick.part_id;
    part_no := v_pick.part_no;
    quantity := v_pick.quantity;
    RETURN NEXT;
  END LOOP;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.adjust_api_inventory_stock(
  p_company_id UUID,
  p_part_id UUID,
  p_scope TEXT,
  p_expected_stock_entity_version BIGINT,
  p_quantity_delta NUMERIC,
  p_note TEXT,
  p_adjusted_at TIMESTAMPTZ
) RETURNS TABLE (
  part_id UUID, part_no INTEGER, status TEXT, name TEXT, active BOOLEAN,
  quantity_on_hand NUMERIC, low_threshold NUMERIC, unit TEXT,
  entity_version BIGINT, stock_entity_version BIGINT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_location_id UUID;
  v_adjustment_location_id UUID;
  v_balance public.inventory_balances%ROWTYPE;
  v_adjusted_at TIMESTAMPTZ := COALESCE(p_adjusted_at, pg_catalog.clock_timestamp());
BEGIN
  IF p_scope NOT IN ('company', 'member')
     OR p_expected_stock_entity_version IS NULL OR p_expected_stock_entity_version < 1
     OR p_quantity_delta IS NULL OR p_quantity_delta = 0
     OR pg_catalog.abs(p_quantity_delta) > 99999999999.999
     OR p_quantity_delta <> pg_catalog.round(p_quantity_delta, 3)
     OR (p_note IS NOT NULL AND pg_catalog.char_length(p_note) > 500) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_ADJUSTMENT_INVALID';
  END IF;
  v_membership_id := private.require_api_inventory_access(
    p_company_id, p_scope = 'company'
  );
  IF p_scope = 'member' AND v_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INVENTORY_MEMBER_MUTATION_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_parts AS part
    WHERE part.id = p_part_id AND part.company_id = p_company_id
      AND part.archived_at IS NULL AND part.active
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;

  v_location_id := private.ensure_api_inventory_location(
    p_company_id,
    CASE WHEN p_scope = 'company'
      THEN 'company'::public.inventory_location_type
      ELSE 'member'::public.inventory_location_type
    END,
    CASE WHEN p_scope = 'member' THEN v_membership_id ELSE NULL END,
    v_adjusted_at
  );
  INSERT INTO public.inventory_balances AS balance (
    location_id, part_id, quantity_on_hand, updated_at
  ) VALUES (v_location_id, p_part_id, 0, v_adjusted_at)
  ON CONFLICT ON CONSTRAINT inventory_balances_pk DO NOTHING;
  SELECT balance.* INTO v_balance
  FROM public.inventory_balances AS balance
  WHERE balance.location_id = v_location_id AND balance.part_id = p_part_id
  FOR UPDATE;
  IF v_balance.entity_version <> p_expected_stock_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'INVENTORY_STOCK_VERSION_CONFLICT';
  END IF;

  IF p_quantity_delta > 0 THEN
    PERFORM 1 FROM private.apply_inventory_movement(
      p_company_id, p_part_id, p_quantity_delta, NULL, v_location_id,
      'adjust'::public.inventory_movement_type, v_membership_id,
      NULL, NULL, p_note, v_adjusted_at
    );
  ELSE
    v_adjustment_location_id := private.ensure_api_inventory_location(
      p_company_id, 'adjustment'::public.inventory_location_type, NULL, v_adjusted_at
    );
    PERFORM 1 FROM private.apply_inventory_movement(
      p_company_id, p_part_id, pg_catalog.abs(p_quantity_delta),
      v_location_id, v_adjustment_location_id,
      'adjust'::public.inventory_movement_type, v_membership_id,
      NULL, NULL, p_note, v_adjusted_at
    );
  END IF;
  PERFORM private.bump_company_sync_version(p_company_id, 'company_inventory_version');
  RETURN QUERY SELECT * FROM private.get_api_inventory_snapshot(
    p_company_id, p_part_id, v_location_id
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.transfer_api_inventory_stock(
  p_company_id UUID,
  p_part_id UUID,
  p_member_no INTEGER,
  p_direction TEXT,
  p_quantity NUMERIC,
  p_expected_source_stock_entity_version BIGINT,
  p_note TEXT,
  p_transferred_at TIMESTAMPTZ
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC,
  source_quantity NUMERIC,
  source_stock_entity_version BIGINT,
  destination_quantity NUMERIC,
  destination_stock_entity_version BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_requester_membership_id UUID;
  v_target_membership_id UUID;
  v_company_location_id UUID;
  v_member_location_id UUID;
  v_source_location_id UUID;
  v_destination_location_id UUID;
  v_source_balance public.inventory_balances%ROWTYPE;
  v_movement RECORD;
  v_part_no INTEGER;
  v_transferred_at TIMESTAMPTZ := COALESCE(p_transferred_at, pg_catalog.clock_timestamp());
BEGIN
  IF p_member_no IS NULL OR p_member_no < 1
     OR p_direction NOT IN ('company_to_member', 'member_to_company')
     OR p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 99999999999.999
     OR p_quantity <> pg_catalog.round(p_quantity, 3)
     OR p_expected_source_stock_entity_version IS NULL
     OR p_expected_source_stock_entity_version < 1
     OR (p_note IS NOT NULL AND pg_catalog.char_length(p_note) > 500) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_TRANSFER_INVALID';
  END IF;
  v_requester_membership_id := private.require_api_inventory_access(p_company_id, true);
  SELECT membership.id INTO v_target_membership_id
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.member_no = p_member_no
    AND membership.status = 'active'
  LIMIT 1;
  IF v_target_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_MEMBER_NOT_FOUND';
  END IF;
  SELECT part.part_no INTO v_part_no
  FROM public.inventory_parts AS part
  WHERE part.id = p_part_id AND part.company_id = p_company_id
    AND part.archived_at IS NULL AND part.active;
  IF v_part_no IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;
  v_company_location_id := private.ensure_api_inventory_location(
    p_company_id, 'company'::public.inventory_location_type, NULL, v_transferred_at
  );
  v_member_location_id := private.ensure_api_inventory_location(
    p_company_id, 'member'::public.inventory_location_type,
    v_target_membership_id, v_transferred_at
  );
  IF p_direction = 'company_to_member' THEN
    v_source_location_id := v_company_location_id;
    v_destination_location_id := v_member_location_id;
  ELSE
    v_source_location_id := v_member_location_id;
    v_destination_location_id := v_company_location_id;
  END IF;
  INSERT INTO public.inventory_balances AS balance (
    location_id, part_id, quantity_on_hand, updated_at
  ) VALUES (v_source_location_id, p_part_id, 0, v_transferred_at)
  ON CONFLICT ON CONSTRAINT inventory_balances_pk DO NOTHING;
  SELECT balance.* INTO v_source_balance
  FROM public.inventory_balances AS balance
  WHERE balance.location_id = v_source_location_id AND balance.part_id = p_part_id
  FOR UPDATE;
  IF v_source_balance.entity_version <> p_expected_source_stock_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'INVENTORY_STOCK_VERSION_CONFLICT';
  END IF;
  SELECT movement.* INTO v_movement
  FROM private.apply_inventory_movement(
    p_company_id, p_part_id, p_quantity,
    v_source_location_id, v_destination_location_id,
    CASE WHEN p_direction = 'company_to_member'
      THEN 'pick'::public.inventory_movement_type
      ELSE 'return'::public.inventory_movement_type
    END,
    v_requester_membership_id, NULL, NULL, p_note, v_transferred_at
  ) AS movement;
  PERFORM private.bump_company_sync_version(p_company_id, 'company_inventory_version');

  RETURN QUERY
  SELECT
    v_movement.movement_id,
    p_part_id,
    v_part_no,
    p_quantity,
    source_balance.quantity_on_hand,
    source_balance.entity_version,
    destination_balance.quantity_on_hand,
    destination_balance.entity_version
  FROM public.inventory_balances AS source_balance
  INNER JOIN public.inventory_balances AS destination_balance
    ON destination_balance.location_id = v_destination_location_id
   AND destination_balance.part_id = p_part_id
  WHERE source_balance.location_id = v_source_location_id
    AND source_balance.part_id = p_part_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.pick_api_inventory_stock(
  p_company_id UUID,
  p_member_no INTEGER,
  p_picks JSONB,
  p_picked_at TIMESTAMPTZ
) RETURNS TABLE (
  movement_id UUID,
  part_id UUID,
  part_no INTEGER,
  quantity NUMERIC,
  source_quantity NUMERIC,
  source_stock_entity_version BIGINT,
  destination_quantity NUMERIC,
  destination_stock_entity_version BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_requester_membership_id UUID;
  v_target_membership_id UUID;
  v_company_location_id UUID;
  v_member_location_id UUID;
  v_count INTEGER;
  v_distinct_count INTEGER;
  v_applied JSONB := '[]'::JSONB;
  v_movement RECORD;
  v_picked_at TIMESTAMPTZ := COALESCE(p_picked_at, pg_catalog.clock_timestamp());
BEGIN
  IF p_member_no IS NULL OR p_member_no < 1
     OR p_picks IS NULL OR pg_catalog.jsonb_typeof(p_picks) <> 'array'
     OR pg_catalog.jsonb_array_length(p_picks) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICKS_INVALID';
  END IF;
  v_requester_membership_id := private.require_api_inventory_access(p_company_id, true);
  SELECT membership.id INTO v_target_membership_id
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.member_no = p_member_no
    AND membership.status = 'active'
  LIMIT 1;
  IF v_target_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_MEMBER_NOT_FOUND';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_picks) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_object_keys(item.value) AS key(name)
         WHERE key.name NOT IN ('partId', 'quantity', 'expectedStockEntityVersion')
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICK_FIELDS_INVALID';
  END IF;
  SELECT pg_catalog.count(*), pg_catalog.count(DISTINCT parsed."partId")
  INTO v_count, v_distinct_count
  FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
    "partId" UUID, quantity NUMERIC, "expectedStockEntityVersion" BIGINT
  );
  IF v_count <> v_distinct_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICK_DUPLICATE_PART';
  END IF;

  v_company_location_id := private.ensure_api_inventory_location(
    p_company_id, 'company'::public.inventory_location_type, NULL, v_picked_at
  );
  v_member_location_id := private.ensure_api_inventory_location(
    p_company_id, 'member'::public.inventory_location_type,
    v_target_membership_id, v_picked_at
  );
  INSERT INTO public.inventory_balances AS balance (
    location_id, part_id, quantity_on_hand, updated_at
  )
  SELECT v_company_location_id, parsed."partId", 0, v_picked_at
  FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
    "partId" UUID, quantity NUMERIC, "expectedStockEntityVersion" BIGINT
  )
  ON CONFLICT ON CONSTRAINT inventory_balances_pk DO NOTHING;

  PERFORM balance.part_id
  FROM public.inventory_balances AS balance
  WHERE balance.location_id = v_company_location_id
    AND balance.part_id IN (
      SELECT parsed."partId"
      FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
        "partId" UUID, quantity NUMERIC, "expectedStockEntityVersion" BIGINT
      )
    )
  ORDER BY balance.part_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
      "partId" UUID, quantity NUMERIC, "expectedStockEntityVersion" BIGINT
    )
    LEFT JOIN public.inventory_parts AS part
      ON part.id = parsed."partId" AND part.company_id = p_company_id
    LEFT JOIN public.inventory_balances AS balance
      ON balance.location_id = v_company_location_id AND balance.part_id = parsed."partId"
    WHERE parsed."partId" IS NULL OR parsed.quantity IS NULL OR parsed.quantity <= 0
       OR parsed.quantity > 99999999999.999
       OR parsed.quantity <> pg_catalog.round(parsed.quantity, 3)
       OR parsed."expectedStockEntityVersion" IS NULL
       OR parsed."expectedStockEntityVersion" < 1
       OR part.id IS NULL OR part.archived_at IS NOT NULL OR NOT part.active
       OR balance.entity_version <> parsed."expectedStockEntityVersion"
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
        "partId" UUID, quantity NUMERIC, "expectedStockEntityVersion" BIGINT
      )
      INNER JOIN public.inventory_balances AS balance
        ON balance.location_id = v_company_location_id AND balance.part_id = parsed."partId"
      WHERE balance.entity_version <> parsed."expectedStockEntityVersion"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'INVENTORY_STOCK_VERSION_CONFLICT';
    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PICK_ITEM_INVALID';
  END IF;

  FOR v_movement IN
    SELECT movement.*
    FROM private.apply_inventory_pick_batch(
      p_company_id,
      v_company_location_id,
      v_member_location_id,
      v_requester_membership_id,
      (
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'part_id', part.id,
          'part_no', part.part_no,
          'quantity', parsed.quantity
        ) ORDER BY part.id)
        FROM pg_catalog.jsonb_to_recordset(p_picks) AS parsed(
          "partId" UUID, quantity NUMERIC, "expectedStockEntityVersion" BIGINT
        )
        INNER JOIN public.inventory_parts AS part
          ON part.id = parsed."partId" AND part.company_id = p_company_id
      ),
      v_picked_at
    ) AS movement
  LOOP
    v_applied := v_applied || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'movement_id', v_movement.movement_id,
      'part_id', v_movement.part_id,
      'part_no', v_movement.part_no,
      'quantity', v_movement.quantity
    ));
  END LOOP;

  RETURN QUERY
  SELECT
    applied.movement_id,
    applied.part_id,
    applied.part_no,
    applied.quantity,
    source_balance.quantity_on_hand,
    source_balance.entity_version,
    destination_balance.quantity_on_hand,
    destination_balance.entity_version
  FROM pg_catalog.jsonb_to_recordset(v_applied) AS applied(
    movement_id UUID, part_id UUID, part_no INTEGER, quantity NUMERIC
  )
  INNER JOIN public.inventory_balances AS source_balance
    ON source_balance.location_id = v_company_location_id
   AND source_balance.part_id = applied.part_id
  INNER JOIN public.inventory_balances AS destination_balance
    ON destination_balance.location_id = v_member_location_id
   AND destination_balance.part_id = applied.part_id
  ORDER BY applied.part_no;
  PERFORM private.bump_company_sync_version(p_company_id, 'company_inventory_version');
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_inventory_part(
  p_company_id UUID,
  p_payload JSONB,
  p_created_at TIMESTAMPTZ
) RETURNS TABLE (
  part_id UUID, part_no INTEGER, status TEXT, name TEXT, active BOOLEAN,
  quantity_on_hand NUMERIC, low_threshold NUMERIC, unit TEXT,
  entity_version BIGINT, stock_entity_version BIGINT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_location_id UUID;
  v_part_id UUID;
  v_part_no INTEGER;
  v_name TEXT;
  v_unit TEXT;
  v_initial_quantity NUMERIC := 0;
  v_low_threshold NUMERIC := 0;
  v_created_at TIMESTAMPTZ := COALESCE(p_created_at, pg_catalog.clock_timestamp());
BEGIN
  v_membership_id := private.require_api_inventory_access(p_company_id, true);
  IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_object_keys(p_payload) AS key(name)
       WHERE key.name NOT IN ('name', 'initialQuantity', 'lowThreshold', 'unit')
     )
     OR pg_catalog.jsonb_typeof(p_payload -> 'name') <> 'string' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_PAYLOAD_INVALID';
  END IF;
  v_name := pg_catalog.btrim(p_payload ->> 'name');
  IF v_name = '' OR pg_catalog.char_length(v_name) > 240 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_NAME_INVALID';
  END IF;
  IF p_payload ? 'initialQuantity' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'initialQuantity') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_QUANTITY_INVALID';
    END IF;
    v_initial_quantity := (p_payload ->> 'initialQuantity')::NUMERIC;
  END IF;
  IF p_payload ? 'lowThreshold' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'lowThreshold') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_THRESHOLD_INVALID';
    END IF;
    v_low_threshold := (p_payload ->> 'lowThreshold')::NUMERIC;
  END IF;
  IF v_initial_quantity < 0 OR v_initial_quantity > 99999999999.999
     OR v_initial_quantity <> pg_catalog.round(v_initial_quantity, 3) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_QUANTITY_INVALID';
  END IF;
  IF v_low_threshold < 0 OR v_low_threshold > 99999999999.999
     OR v_low_threshold <> pg_catalog.round(v_low_threshold, 3) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_THRESHOLD_INVALID';
  END IF;
  IF p_payload ? 'unit' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'unit') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_UNIT_INVALID';
    END IF;
    v_unit := NULLIF(pg_catalog.btrim(p_payload ->> 'unit'), '');
    IF v_unit IS NOT NULL AND (pg_catalog.char_length(v_unit) > 40 OR v_unit ~ '[[:cntrl:]]') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_UNIT_INVALID';
    END IF;
  END IF;

  v_part_no := private.allocate_company_counter(p_company_id, 'part_no');
  INSERT INTO public.inventory_parts AS part (
    company_id, part_no, name, active, low_threshold, unit, created_at, updated_at
  ) VALUES (
    p_company_id, v_part_no, v_name, true, v_low_threshold, v_unit, v_created_at, v_created_at
  ) RETURNING part.id INTO v_part_id;

  v_location_id := private.ensure_api_inventory_location(
    p_company_id, 'company'::public.inventory_location_type, NULL, v_created_at
  );
  INSERT INTO public.inventory_balances AS balance (
    location_id, part_id, quantity_on_hand, updated_at
  ) VALUES (v_location_id, v_part_id, 0, v_created_at);
  IF v_initial_quantity > 0 THEN
    PERFORM 1 FROM private.apply_inventory_movement(
      p_company_id, v_part_id, v_initial_quantity, NULL, v_location_id,
      'add'::public.inventory_movement_type, v_membership_id,
      NULL, NULL, 'Initial company inventory', v_created_at
    );
  END IF;
  PERFORM private.bump_company_sync_version(p_company_id, 'company_inventory_version');
  RETURN QUERY SELECT * FROM private.get_api_inventory_snapshot(
    p_company_id, v_part_id, v_location_id
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.update_api_inventory_part(
  p_company_id UUID,
  p_part_id UUID,
  p_expected_entity_version BIGINT,
  p_payload JSONB,
  p_updated_at TIMESTAMPTZ
) RETURNS TABLE (
  part_id UUID, part_no INTEGER, status TEXT, name TEXT, active BOOLEAN,
  quantity_on_hand NUMERIC, low_threshold NUMERIC, unit TEXT,
  entity_version BIGINT, stock_entity_version BIGINT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_part public.inventory_parts%ROWTYPE;
  v_location_id UUID;
  v_updated_at TIMESTAMPTZ := COALESCE(p_updated_at, pg_catalog.clock_timestamp());
  v_name TEXT;
  v_unit TEXT;
  v_threshold NUMERIC;
BEGIN
  PERFORM private.require_api_inventory_access(p_company_id, true);
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1
     OR p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
     OR p_payload = '{}'::JSONB
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_object_keys(p_payload) AS key(name)
       WHERE key.name NOT IN ('name', 'active', 'lowThreshold', 'unit')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_PAYLOAD_INVALID';
  END IF;
  SELECT part.* INTO v_part
  FROM public.inventory_parts AS part
  WHERE part.company_id = p_company_id AND part.id = p_part_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;
  IF v_part.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'INVENTORY_PART_VERSION_CONFLICT';
  END IF;
  IF v_part.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40900', MESSAGE = 'INVENTORY_PART_ARCHIVED';
  END IF;

  IF p_payload ? 'name' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'name') <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_NAME_INVALID';
    END IF;
    v_name := pg_catalog.btrim(p_payload ->> 'name');
    IF v_name = '' OR pg_catalog.char_length(v_name) > 240 OR v_name ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_NAME_INVALID';
    END IF;
  END IF;
  IF p_payload ? 'active' AND pg_catalog.jsonb_typeof(p_payload -> 'active') <> 'boolean' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_ACTIVE_INVALID';
  END IF;
  IF p_payload ? 'lowThreshold' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'lowThreshold') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_THRESHOLD_INVALID';
    END IF;
    v_threshold := (p_payload ->> 'lowThreshold')::NUMERIC;
    IF v_threshold < 0 OR v_threshold > 99999999999.999
       OR v_threshold <> pg_catalog.round(v_threshold, 3) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_THRESHOLD_INVALID';
    END IF;
  END IF;
  IF p_payload ? 'unit' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'unit') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_UNIT_INVALID';
    END IF;
    v_unit := NULLIF(pg_catalog.btrim(p_payload ->> 'unit'), '');
    IF v_unit IS NOT NULL AND (pg_catalog.char_length(v_unit) > 40 OR v_unit ~ '[[:cntrl:]]') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_UNIT_INVALID';
    END IF;
  END IF;

  UPDATE public.inventory_parts AS part
  SET name = CASE WHEN p_payload ? 'name' THEN v_name ELSE part.name END,
      active = CASE WHEN p_payload ? 'active' THEN (p_payload ->> 'active')::BOOLEAN ELSE part.active END,
      low_threshold = CASE WHEN p_payload ? 'lowThreshold' THEN v_threshold ELSE part.low_threshold END,
      unit = CASE WHEN p_payload ? 'unit' THEN v_unit ELSE part.unit END,
      updated_at = v_updated_at
  WHERE part.company_id = p_company_id AND part.id = p_part_id;

  v_location_id := private.ensure_api_inventory_location(
    p_company_id, 'company'::public.inventory_location_type, NULL, v_updated_at
  );
  PERFORM private.bump_company_sync_version(p_company_id, 'company_inventory_version');
  RETURN QUERY SELECT * FROM private.get_api_inventory_snapshot(
    p_company_id, p_part_id, v_location_id
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.archive_api_inventory_part(
  p_company_id UUID,
  p_part_id UUID,
  p_expected_entity_version BIGINT,
  p_archived_at TIMESTAMPTZ
) RETURNS TABLE (
  part_id UUID, part_no INTEGER, status TEXT, name TEXT, active BOOLEAN,
  quantity_on_hand NUMERIC, low_threshold NUMERIC, unit TEXT,
  entity_version BIGINT, stock_entity_version BIGINT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_part public.inventory_parts%ROWTYPE;
  v_location_id UUID;
  v_archived_at TIMESTAMPTZ := COALESCE(p_archived_at, pg_catalog.clock_timestamp());
BEGIN
  PERFORM private.require_api_inventory_access(p_company_id, true);
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVENTORY_PART_VERSION_INVALID';
  END IF;
  SELECT part.* INTO v_part
  FROM public.inventory_parts AS part
  WHERE part.company_id = p_company_id AND part.id = p_part_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;
  IF v_part.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'INVENTORY_PART_VERSION_CONFLICT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_balances AS balance
    INNER JOIN public.inventory_locations AS location ON location.id = balance.location_id
    WHERE location.company_id = p_company_id
      AND location.location_type IN ('company', 'member')
      AND balance.part_id = p_part_id
      AND balance.quantity_on_hand > 0
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVENTORY_STOCK_REMAINS';
  END IF;
  UPDATE public.inventory_parts AS part
  SET active = false,
      archived_at = COALESCE(part.archived_at, v_archived_at),
      updated_at = v_archived_at
  WHERE part.company_id = p_company_id AND part.id = p_part_id;
  v_location_id := private.ensure_api_inventory_location(
    p_company_id, 'company'::public.inventory_location_type, NULL, v_archived_at
  );
  PERFORM private.bump_company_sync_version(p_company_id, 'company_inventory_version');
  RETURN QUERY SELECT * FROM private.get_api_inventory_snapshot(
    p_company_id, p_part_id, v_location_id
  );
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.increment_inventory_entity_version()
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.require_api_inventory_access(UUID, BOOLEAN)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.ensure_api_inventory_location(UUID, public.inventory_location_type, UUID, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.get_api_inventory_snapshot(UUID, UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.apply_inventory_movement(UUID, UUID, NUMERIC, UUID, UUID, public.inventory_movement_type, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.apply_inventory_pick_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.create_api_inventory_part(UUID, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.update_api_inventory_part(UUID, UUID, BIGINT, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.archive_api_inventory_part(UUID, UUID, BIGINT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.adjust_api_inventory_stock(UUID, UUID, TEXT, BIGINT, NUMERIC, TEXT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.transfer_api_inventory_stock(UUID, UUID, INTEGER, TEXT, NUMERIC, BIGINT, TEXT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.pick_api_inventory_stock(UUID, INTEGER, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.apply_inventory_movement(UUID, UUID, NUMERIC, UUID, UUID, public.inventory_movement_type, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
TO service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.apply_inventory_pick_batch(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ)
TO service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.create_api_inventory_part(UUID, JSONB, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.update_api_inventory_part(UUID, UUID, BIGINT, JSONB, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.archive_api_inventory_part(UUID, UUID, BIGINT, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.adjust_api_inventory_stock(UUID, UUID, TEXT, BIGINT, NUMERIC, TEXT, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.transfer_api_inventory_stock(UUID, UUID, INTEGER, TEXT, NUMERIC, BIGINT, TEXT, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.pick_api_inventory_stock(UUID, INTEGER, JSONB, TIMESTAMPTZ)
TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0020_api_worker_mutations.sql
-- ============================================================================
-- Secure, versioned company-member mutations for the Node API.
--
-- New members join through the invitation flow. This surface deliberately
-- supports only membership-scoped edits and guarded disabling; it never creates
-- Auth users, accepts passwords, or hard-deletes historical membership rows.

ALTER TABLE public.company_memberships
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT company_memberships_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

CREATE INDEX company_memberships_company_member_version_idx
  ON public.company_memberships (company_id, member_no, entity_version);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.increment_company_membership_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER company_memberships_increment_entity_version
BEFORE UPDATE ON public.company_memberships
FOR EACH ROW
EXECUTE FUNCTION private.increment_company_membership_entity_version();--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.require_api_worker_mutation_access(
  p_company_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_is_dev BOOLEAN := false;
  v_team_enabled BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_company_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.companies AS company
    WHERE company.id = p_company_id
      AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'WORKER_COMPANY_NOT_FOUND';
  END IF;

  SELECT private.app_is_dev() INTO v_is_dev;
  IF NOT v_is_dev AND NOT EXISTS (
    SELECT 1
    FROM public.company_memberships AS requester
    WHERE requester.company_id = p_company_id
      AND requester.user_id = v_uid
      AND requester.status = 'active'
      AND requester.role = 'manager'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WORKER_MANAGER_REQUIRED';
  END IF;

  SELECT
    subscription.status IN ('active', 'trial')
    AND (
      subscription.expires_at IS NULL
      OR subscription.expires_at > pg_catalog.statement_timestamp()
    )
    AND CASE
      WHEN pg_catalog.jsonb_typeof(subscription.enabled_modules -> 'team') = 'boolean'
        THEN (subscription.enabled_modules ->> 'team')::BOOLEAN
      WHEN pg_catalog.jsonb_typeof(subscription.enabled_modules -> 'workers') = 'boolean'
        THEN (subscription.enabled_modules ->> 'workers')::BOOLEAN
      ELSE subscription.tier IN ('Team', 'Enterprise')
    END
  INTO v_team_enabled
  FROM public.company_subscriptions AS subscription
  WHERE subscription.company_id = p_company_id
  LIMIT 1;

  IF NOT v_is_dev AND NOT COALESCE(v_team_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WORKERS_MODULE_DISABLED';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.validate_api_worker_patch(
  p_patch JSONB
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_display_name TEXT;
  v_phone_number TEXT;
BEGIN
  IF p_patch IS NULL
     OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
     OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_PATCH_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS patch_key(key)
    WHERE patch_key.key NOT IN ('displayName', 'phoneNumber', 'role', 'status')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_PATCH_FIELDS_INVALID';
  END IF;

  IF p_patch ? 'displayName' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'displayName') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_DISPLAY_NAME_INVALID';
    END IF;
    v_display_name := p_patch ->> 'displayName';
    IF v_display_name IS NOT NULL AND (
      pg_catalog.btrim(v_display_name) = ''
      OR pg_catalog.char_length(pg_catalog.btrim(v_display_name)) > 200
      OR v_display_name ~ '[[:cntrl:]]'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_DISPLAY_NAME_INVALID';
    END IF;
  END IF;

  IF p_patch ? 'phoneNumber' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'phoneNumber') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_PHONE_INVALID';
    END IF;
    v_phone_number := p_patch ->> 'phoneNumber';
    IF v_phone_number IS NOT NULL AND (
      pg_catalog.btrim(v_phone_number) = ''
      OR pg_catalog.char_length(pg_catalog.btrim(v_phone_number)) > 40
      OR v_phone_number ~ '[[:cntrl:]]'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_PHONE_INVALID';
    END IF;
  END IF;

  IF p_patch ? 'role' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'role') <> 'string'
    OR p_patch ->> 'role' NOT IN ('worker', 'user', 'basic')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_ROLE_INVALID';
  END IF;
  IF p_patch ? 'status' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'status') <> 'string'
    OR p_patch ->> 'status' NOT IN ('active', 'disabled')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_STATUS_INVALID';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.assert_api_worker_can_be_disabled(
  p_company_id UUID,
  p_membership_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.jobs AS job
    WHERE job.company_id = p_company_id
      AND job.assigned_membership_id = p_membership_id
      AND job.status IN ('pending', 'waiting')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'WORKER_HAS_ACTIVE_JOBS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_locations AS location
    INNER JOIN public.inventory_balances AS balance
      ON balance.location_id = location.id
     AND balance.quantity_on_hand > 0
    WHERE location.company_id = p_company_id
      AND location.membership_id = p_membership_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'WORKER_HAS_INVENTORY';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.update_api_worker_membership(
  p_company_id UUID,
  p_member_no INTEGER,
  p_expected_entity_version BIGINT,
  p_patch JSONB,
  p_updated_at TIMESTAMPTZ
) RETURNS TABLE (
  member_no INTEGER,
  role TEXT,
  status TEXT,
  display_name TEXT,
  email TEXT,
  phone_number TEXT,
  entity_version BIGINT,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership public.company_memberships%ROWTYPE;
  v_email TEXT;
  v_updated_at TIMESTAMPTZ := COALESCE(p_updated_at, pg_catalog.clock_timestamp());
BEGIN
  PERFORM private.require_api_worker_mutation_access(p_company_id);
  PERFORM private.validate_api_worker_patch(p_patch);
  IF p_member_no IS NULL OR p_member_no < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_MEMBER_NO_INVALID';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WORKER_VERSION_INVALID';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.member_no = p_member_no
    AND membership.role IN ('worker', 'user', 'basic')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'WORKER_NOT_FOUND';
  END IF;
  IF v_membership.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'WORKER_ENTITY_VERSION_CONFLICT';
  END IF;
  IF p_patch ->> 'status' = 'disabled' AND v_membership.status <> 'disabled' THEN
    PERFORM private.assert_api_worker_can_be_disabled(p_company_id, v_membership.id);
  END IF;

  UPDATE public.company_memberships AS membership
  SET
    display_name = CASE WHEN p_patch ? 'displayName'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'displayName'), '')
      ELSE membership.display_name END,
    phone_number = CASE WHEN p_patch ? 'phoneNumber'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'phoneNumber'), '')
      ELSE membership.phone_number END,
    role = CASE WHEN p_patch ? 'role'
      THEN (p_patch ->> 'role')::public.membership_role
      ELSE membership.role END,
    status = CASE WHEN p_patch ? 'status'
      THEN (p_patch ->> 'status')::public.membership_status
      ELSE membership.status END,
    updated_at = v_updated_at
  WHERE membership.id = v_membership.id
  RETURNING membership.* INTO v_membership;

  SELECT app_user.email
  INTO v_email
  FROM public.app_users AS app_user
  WHERE app_user.id = v_membership.user_id;

  PERFORM private.bump_company_sync_version(p_company_id, 'workers_version');
  RETURN QUERY SELECT
    v_membership.member_no,
    v_membership.role::TEXT,
    v_membership.status::TEXT,
    v_membership.display_name::TEXT,
    v_email,
    v_membership.phone_number::TEXT,
    v_membership.entity_version,
    v_membership.joined_at,
    v_membership.created_at,
    v_membership.updated_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.disable_api_worker_membership(
  p_company_id UUID,
  p_member_no INTEGER,
  p_expected_entity_version BIGINT,
  p_disabled_at TIMESTAMPTZ
) RETURNS TABLE (
  member_no INTEGER,
  role TEXT,
  status TEXT,
  display_name TEXT,
  email TEXT,
  phone_number TEXT,
  entity_version BIGINT,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT *
  FROM private.update_api_worker_membership(
    p_company_id,
    p_member_no,
    p_expected_entity_version,
    '{"status":"disabled"}'::JSONB,
    p_disabled_at
  );
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.increment_company_membership_entity_version()
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.require_api_worker_mutation_access(UUID)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.validate_api_worker_patch(JSONB)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.assert_api_worker_can_be_disabled(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.update_api_worker_membership(UUID, INTEGER, BIGINT, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.disable_api_worker_membership(UUID, INTEGER, BIGINT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.update_api_worker_membership(UUID, INTEGER, BIGINT, JSONB, TIMESTAMPTZ)
TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.disable_api_worker_membership(UUID, INTEGER, BIGINT, TIMESTAMPTZ)
TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0021_api_job_mutations.sql
-- ============================================================================
-- Secure, versioned job metadata, acceptance, and deletion mutations for the
-- Node API. Job completion with field details remains owned by
-- private.complete_job_with_details(...).

CREATE OR REPLACE FUNCTION private.require_api_job_mutation_actor(
  p_company_id UUID
) RETURNS TABLE (
  actor_user_id TEXT,
  actor_membership_id UUID,
  actor_role TEXT,
  actor_is_dev BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_membership public.company_memberships%ROWTYPE;
  v_is_dev BOOLEAN := false;
  v_jobs_enabled BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_company_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.companies AS company
    WHERE company.id = p_company_id
      AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'JOB_COMPANY_NOT_FOUND';
  END IF;

  SELECT private.app_is_dev() INTO v_is_dev;
  SELECT membership.*
  INTO v_membership
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid
    AND membership.status = 'active'
  ORDER BY membership.joined_at, membership.created_at, membership.id
  LIMIT 1;

  IF v_membership.id IS NULL AND NOT v_is_dev THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'COMPANY_MEMBERSHIP_REQUIRED';
  END IF;

  SELECT entitlement.jobs_enabled
  INTO v_jobs_enabled
  FROM private.get_company_module_entitlements(p_company_id) AS entitlement;
  IF NOT COALESCE(v_jobs_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOBS_MODULE_DISABLED';
  END IF;

  actor_user_id := v_uid;
  actor_membership_id := v_membership.id;
  actor_role := CASE WHEN v_is_dev THEN 'dev' ELSE v_membership.role::TEXT END;
  actor_is_dev := v_is_dev;
  IF actor_role NOT IN ('manager', 'worker', 'user', 'dev') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOB_MUTATION_FORBIDDEN';
  END IF;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.validate_api_job_patch(
  p_patch JSONB
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_patch IS NULL
     OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
     OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PATCH_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS patch_key(key)
    WHERE patch_key.key NOT IN (
      'title',
      'description',
      'notes',
      'location',
      'address',
      'category',
      'priority',
      'dueAt',
      'clientId',
      'assigneeMemberNo',
      'status'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PATCH_FIELDS_INVALID';
  END IF;

  IF p_patch ? 'title' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'title') <> 'string'
    OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'title')) NOT BETWEEN 1 AND 200
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_TITLE_INVALID';
  END IF;
  IF p_patch ? 'description' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'description') NOT IN ('string', 'null')
    OR pg_catalog.char_length(p_patch ->> 'description') > 10000
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DESCRIPTION_INVALID';
  END IF;
  IF p_patch ? 'notes' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'notes') NOT IN ('string', 'null')
    OR pg_catalog.char_length(p_patch ->> 'notes') > 10000
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_NOTES_INVALID';
  END IF;
  IF p_patch ? 'location' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'location') NOT IN ('string', 'null')
    OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'location')) > 240
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_LOCATION_INVALID';
  END IF;
  IF p_patch ? 'address' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'address') NOT IN ('string', 'null')
    OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'address')) > 500
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_ADDRESS_INVALID';
  END IF;
  IF p_patch ? 'category' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'category') NOT IN ('string', 'null')
    OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'category')) > 120
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_CATEGORY_INVALID';
  END IF;
  IF p_patch ? 'priority' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'priority') NOT IN ('string', 'null')
    OR pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'priority')) > 40
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_PRIORITY_INVALID';
  END IF;
  IF p_patch ? 'dueAt' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'dueAt') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DUE_AT_INVALID';
    END IF;
    IF pg_catalog.jsonb_typeof(p_patch -> 'dueAt') = 'string' THEN
      BEGIN
        PERFORM (p_patch ->> 'dueAt')::TIMESTAMPTZ;
      EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DUE_AT_INVALID';
      END;
    END IF;
  END IF;
  IF p_patch ? 'clientId' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'clientId') NOT IN ('string', 'null')
    OR (
      pg_catalog.jsonb_typeof(p_patch -> 'clientId') = 'string'
      AND (p_patch ->> 'clientId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CLIENT_ID_INVALID';
  END IF;
  IF p_patch ? 'assigneeMemberNo' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'assigneeMemberNo') NOT IN ('number', 'null')
    OR (
      pg_catalog.jsonb_typeof(p_patch -> 'assigneeMemberNo') = 'number'
      AND (
        (p_patch ->> 'assigneeMemberNo') !~ '^[1-9][0-9]*$'
        OR (p_patch ->> 'assigneeMemberNo')::NUMERIC > 2147483647
      )
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ASSIGNEE_MEMBER_NO_INVALID';
  END IF;
  IF p_patch ? 'status' AND (
    pg_catalog.jsonb_typeof(p_patch -> 'status') <> 'string'
    OR p_patch ->> 'status' NOT IN ('pending', 'waiting', 'denied')
  ) THEN
    IF p_patch ->> 'status' = 'finished' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_DIRECT_FINISH_FORBIDDEN';
    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_STATUS_INVALID';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.get_api_job_mutation_result(
  p_company_id UUID,
  p_job_id UUID
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status TEXT,
  title TEXT,
  description TEXT,
  notes TEXT,
  location TEXT,
  address TEXT,
  category TEXT,
  priority TEXT,
  due_at TIMESTAMPTZ,
  client_id UUID,
  client_name TEXT,
  client_phone TEXT,
  assignee_member_no INTEGER,
  assignee_display_name TEXT,
  creator_uid UUID,
  creator_member_no INTEGER,
  creator_display_name TEXT,
  is_certificate BOOLEAN,
  meta JSONB,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    job.id,
    job.job_no,
    job.status::TEXT,
    COALESCE(job.title, ''),
    COALESCE(job.description, ''),
    job.notes,
    job.location,
    job.address,
    job.category,
    job.priority,
    job.due_at,
    job.client_id,
    job.client_name_snapshot,
    job.client_phone_snapshot,
    assignee.member_no,
    COALESCE(
      NULLIF(pg_catalog.btrim(assignee.display_name), ''),
      NULLIF(pg_catalog.btrim(assignee_user.display_name), ''),
      job.assigned_member_name_snapshot
    ),
    CASE
      WHEN creator.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN creator.user_id::UUID
      ELSE NULL
    END,
    creator.member_no,
    COALESCE(
      NULLIF(pg_catalog.btrim(creator.display_name), ''),
      NULLIF(pg_catalog.btrim(creator_user.display_name), ''),
      job.created_by_name_snapshot
    ),
    job.is_cert,
    job.meta,
    job.entity_version,
    job.created_at,
    job.updated_at,
    job.finished_at,
    job.denied_at
  FROM public.jobs AS job
  LEFT JOIN public.company_memberships AS assignee
    ON assignee.id = job.assigned_membership_id
   AND assignee.company_id = job.company_id
  LEFT JOIN public.app_users AS assignee_user
    ON assignee_user.id = assignee.user_id
  LEFT JOIN public.company_memberships AS creator
    ON creator.id = job.created_by_membership_id
   AND creator.company_id = job.company_id
  LEFT JOIN public.app_users AS creator_user
    ON creator_user.id = creator.user_id
  WHERE job.company_id = p_company_id
    AND job.id = p_job_id;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.update_api_job(
  p_company_id UUID,
  p_job_id UUID,
  p_expected_entity_version BIGINT,
  p_patch JSONB,
  p_updated_at TIMESTAMPTZ
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status TEXT,
  title TEXT,
  description TEXT,
  notes TEXT,
  location TEXT,
  address TEXT,
  category TEXT,
  priority TEXT,
  due_at TIMESTAMPTZ,
  client_id UUID,
  client_name TEXT,
  client_phone TEXT,
  assignee_member_no INTEGER,
  assignee_display_name TEXT,
  creator_uid UUID,
  creator_member_no INTEGER,
  creator_display_name TEXT,
  is_certificate BOOLEAN,
  meta JSONB,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_assignee public.company_memberships%ROWTYPE;
  v_actor_user_id TEXT;
  v_actor_membership_id UUID;
  v_actor_role TEXT;
  v_updated_at TIMESTAMPTZ := COALESCE(p_updated_at, pg_catalog.clock_timestamp());
BEGIN
  IF p_company_id IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_AND_JOB_REQUIRED';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ENTITY_VERSION_INVALID';
  END IF;
  PERFORM private.validate_api_job_patch(p_patch);

  SELECT
    actor.actor_user_id,
    actor.actor_membership_id,
    actor.actor_role
  INTO v_actor_user_id, v_actor_membership_id, v_actor_role
  FROM private.require_api_job_mutation_actor(p_company_id) AS actor;

  SELECT job.*
  INTO v_job
  FROM public.jobs AS job
  WHERE job.company_id = p_company_id
    AND job.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'JOB_NOT_FOUND';
  END IF;
  IF v_job.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ENTITY_VERSION_CONFLICT';
  END IF;

  IF v_actor_role IN ('worker', 'user') THEN
    IF v_job.assigned_membership_id IS DISTINCT FROM v_actor_membership_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOB_NOT_ASSIGNED_TO_VIEWER';
    END IF;
    IF p_patch ? 'clientId' OR p_patch ? 'assigneeMemberNo' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOB_CLIENT_ASSIGNEE_CHANGE_FORBIDDEN';
    END IF;
  END IF;

  IF v_job.status = 'finished' AND p_patch ? 'status' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_FINISHED_STATUS_LOCKED';
  END IF;

  IF p_patch ? 'clientId' AND pg_catalog.jsonb_typeof(p_patch -> 'clientId') <> 'null' THEN
    SELECT client.*
    INTO v_client
    FROM public.clients AS client
    WHERE client.company_id = p_company_id
      AND client.id = (p_patch ->> 'clientId')::UUID
      AND client.status = 'active'
    LIMIT 1;
    IF v_client.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CLIENT_NOT_FOUND';
    END IF;
  END IF;

  IF p_patch ? 'assigneeMemberNo'
     AND pg_catalog.jsonb_typeof(p_patch -> 'assigneeMemberNo') <> 'null' THEN
    SELECT membership.*
    INTO v_assignee
    FROM public.company_memberships AS membership
    WHERE membership.company_id = p_company_id
      AND membership.member_no = (p_patch ->> 'assigneeMemberNo')::INTEGER
      AND membership.status = 'active'
    LIMIT 1;
    IF v_assignee.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ASSIGNEE_NOT_FOUND';
    END IF;
  END IF;

  UPDATE public.jobs AS job
  SET
    title = CASE WHEN p_patch ? 'title'
      THEN pg_catalog.btrim(p_patch ->> 'title') ELSE job.title END,
    description = CASE WHEN p_patch ? 'description'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'description'), '') ELSE job.description END,
    notes = CASE WHEN p_patch ? 'notes'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'notes'), '') ELSE job.notes END,
    location = CASE WHEN p_patch ? 'location'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'location'), '') ELSE job.location END,
    address = CASE WHEN p_patch ? 'address'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'address'), '') ELSE job.address END,
    category = CASE WHEN p_patch ? 'category'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'category'), '') ELSE job.category END,
    priority = CASE WHEN p_patch ? 'priority'
      THEN NULLIF(pg_catalog.btrim(p_patch ->> 'priority'), '') ELSE job.priority END,
    due_at = CASE WHEN p_patch ? 'dueAt'
      THEN (p_patch ->> 'dueAt')::TIMESTAMPTZ ELSE job.due_at END,
    client_id = CASE WHEN p_patch ? 'clientId' THEN v_client.id ELSE job.client_id END,
    client_name_snapshot = CASE WHEN p_patch ? 'clientId'
      THEN v_client.name ELSE job.client_name_snapshot END,
    client_phone_snapshot = CASE WHEN p_patch ? 'clientId'
      THEN v_client.phone ELSE job.client_phone_snapshot END,
    assigned_membership_id = CASE WHEN p_patch ? 'assigneeMemberNo'
      THEN v_assignee.id ELSE job.assigned_membership_id END,
    assigned_member_name_snapshot = CASE WHEN p_patch ? 'assigneeMemberNo'
      THEN v_assignee.display_name ELSE job.assigned_member_name_snapshot END,
    status = CASE WHEN p_patch ? 'status'
      THEN (p_patch ->> 'status')::public.job_status ELSE job.status END,
    denied_at = CASE
      WHEN NOT (p_patch ? 'status') THEN job.denied_at
      WHEN p_patch ->> 'status' = 'denied' AND job.status = 'denied' THEN job.denied_at
      WHEN p_patch ->> 'status' = 'denied' THEN v_updated_at
      ELSE NULL
    END,
    denied_by_user_id = CASE
      WHEN NOT (p_patch ? 'status') THEN job.denied_by_user_id
      WHEN p_patch ->> 'status' = 'denied' AND job.status = 'denied' THEN job.denied_by_user_id
      WHEN p_patch ->> 'status' = 'denied' THEN v_actor_user_id
      ELSE NULL
    END,
    updated_at = v_updated_at
  WHERE job.id = p_job_id
    AND job.company_id = p_company_id
  RETURNING job.* INTO v_job;

  PERFORM private.bump_company_sync_version(p_company_id, 'jobs_version');
  RETURN QUERY
  SELECT result.*
  FROM private.get_api_job_mutation_result(p_company_id, p_job_id) AS result;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.accept_api_job(
  p_company_id UUID,
  p_job_id UUID,
  p_expected_entity_version BIGINT,
  p_accepted_at TIMESTAMPTZ
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status TEXT,
  title TEXT,
  description TEXT,
  notes TEXT,
  location TEXT,
  address TEXT,
  category TEXT,
  priority TEXT,
  due_at TIMESTAMPTZ,
  client_id UUID,
  client_name TEXT,
  client_phone TEXT,
  assignee_member_no INTEGER,
  assignee_display_name TEXT,
  creator_uid UUID,
  creator_member_no INTEGER,
  creator_display_name TEXT,
  is_certificate BOOLEAN,
  meta JSONB,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_actor_user_id TEXT;
  v_actor_role TEXT;
  v_accepted_at TIMESTAMPTZ := COALESCE(p_accepted_at, pg_catalog.clock_timestamp());
BEGIN
  IF p_company_id IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_AND_JOB_REQUIRED';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ENTITY_VERSION_INVALID';
  END IF;

  SELECT
    actor.actor_user_id,
    actor.actor_role
  INTO v_actor_user_id, v_actor_role
  FROM private.require_api_job_mutation_actor(p_company_id) AS actor;
  IF v_actor_role NOT IN ('manager', 'dev') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOB_ACCEPT_FORBIDDEN';
  END IF;

  SELECT job.*
  INTO v_job
  FROM public.jobs AS job
  WHERE job.company_id = p_company_id
    AND job.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'JOB_NOT_FOUND';
  END IF;
  IF v_job.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ENTITY_VERSION_CONFLICT';
  END IF;
  IF v_job.status NOT IN ('pending', 'waiting') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_NOT_ACCEPTABLE';
  END IF;

  UPDATE public.jobs AS job
  SET
    status = 'finished',
    accepted_by_user_id = v_actor_user_id,
    accepted_at = v_accepted_at,
    finished_at = v_accepted_at,
    denied_at = NULL,
    denied_by_user_id = NULL,
    updated_at = v_accepted_at
  WHERE job.id = p_job_id
    AND job.company_id = p_company_id
  RETURNING job.* INTO v_job;

  PERFORM private.bump_company_sync_version(p_company_id, 'jobs_version');
  RETURN QUERY
  SELECT result.*
  FROM private.get_api_job_mutation_result(p_company_id, p_job_id) AS result;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.delete_api_job(
  p_company_id UUID,
  p_job_id UUID,
  p_expected_entity_version BIGINT
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  deleted BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_actor_membership_id UUID;
  v_actor_role TEXT;
BEGIN
  IF p_company_id IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPANY_AND_JOB_REQUIRED';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ENTITY_VERSION_INVALID';
  END IF;

  SELECT
    actor.actor_membership_id,
    actor.actor_role
  INTO v_actor_membership_id, v_actor_role
  FROM private.require_api_job_mutation_actor(p_company_id) AS actor;

  SELECT job.*
  INTO v_job
  FROM public.jobs AS job
  WHERE job.company_id = p_company_id
    AND job.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'JOB_NOT_FOUND';
  END IF;
  IF v_job.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ENTITY_VERSION_CONFLICT';
  END IF;
  IF v_job.is_cert THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'JOB_CERTIFICATE_LOCKED';
  END IF;
  IF v_job.status IN ('pending', 'waiting') AND v_actor_role NOT IN ('manager', 'dev') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOB_PENDING_DELETE_FORBIDDEN';
  END IF;
  IF v_actor_role IN ('worker', 'user')
     AND v_job.assigned_membership_id IS DISTINCT FROM v_actor_membership_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JOB_NOT_ASSIGNED_TO_VIEWER';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.document_job_links AS document_link
    WHERE document_link.job_id = p_job_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'JOB_HAS_LINKED_DOCUMENTS';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.inventory_movements AS movement
    WHERE movement.company_id = p_company_id
      AND movement.job_id = p_job_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'JOB_HAS_INVENTORY_MOVEMENTS';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.job_attachments AS attachment
    WHERE attachment.job_id = p_job_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'JOB_HAS_ATTACHMENTS';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM private.file_upload_sessions AS upload_session
    WHERE upload_session.target_job_id = p_job_id
       OR upload_session.consumed_by_job_id = p_job_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'JOB_HAS_UPLOAD_SESSION';
  END IF;

  DELETE FROM public.jobs AS job
  WHERE job.id = p_job_id
    AND job.company_id = p_company_id;
  PERFORM private.bump_company_sync_version(p_company_id, 'jobs_version');

  job_id := v_job.id;
  job_no := v_job.job_no;
  deleted := true;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.require_api_job_mutation_actor(UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.validate_api_job_patch(JSONB)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.get_api_job_mutation_result(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.update_api_job(UUID, UUID, BIGINT, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.accept_api_job(UUID, UUID, BIGINT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.delete_api_job(UUID, UUID, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.update_api_job(UUID, UUID, BIGINT, JSONB, TIMESTAMPTZ)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.accept_api_job(UUID, UUID, BIGINT, TIMESTAMPTZ)
  TO smart_job_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.delete_api_job(UUID, UUID, BIGINT)
  TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0022_api_document_tasks.sql
-- ============================================================================
-- Atomic non-tax document creation and durable PDF dispatch outbox.
--
-- Client payloads never choose tenant authority, counters, totals, VAT, company
-- snapshots, creator snapshots, or inventory references. The API role may only
-- execute these narrow SECURITY DEFINER entrypoints.

ALTER TABLE public.documents
  ADD COLUMN entity_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT documents_entity_version_positive_check
    CHECK (entity_version > 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.increment_document_entity_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.entity_version := OLD.entity_version + 1;
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER documents_increment_entity_version
BEFORE UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION private.increment_document_entity_version();--> statement-breakpoint

ALTER TABLE public.document_tasks
  ADD COLUMN dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN dispatch_lease_token UUID,
  ADD COLUMN dispatch_lease_until TIMESTAMPTZ,
  ADD COLUMN next_dispatch_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN dispatched_at TIMESTAMPTZ,
  ADD COLUMN dispatch_error TEXT,
  ADD CONSTRAINT document_tasks_dispatch_attempts_non_negative_check
    CHECK (dispatch_attempts >= 0),
  ADD CONSTRAINT document_tasks_dispatch_lease_consistency_check
    CHECK (
      (dispatch_lease_token IS NULL AND dispatch_lease_until IS NULL)
      OR (dispatch_lease_token IS NOT NULL AND dispatch_lease_until IS NOT NULL)
    );--> statement-breakpoint

CREATE INDEX document_tasks_dispatch_outbox_idx
  ON public.document_tasks (next_dispatch_at, created_at, id)
  WHERE status = 'pending' AND dispatched_at IS NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.require_api_document_mutation_access(
  p_company_id UUID,
  p_manager_only BOOLEAN DEFAULT false
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_membership_id UUID;
  v_documents_enabled BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_company_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.companies AS company
    WHERE company.id = p_company_id
      AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DOCUMENT_COMPANY_NOT_FOUND';
  END IF;

  SELECT entitlement.documents_enabled
  INTO v_documents_enabled
  FROM private.get_company_module_entitlements(p_company_id) AS entitlement;
  IF NOT COALESCE(v_documents_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DOCUMENTS_MODULE_DISABLED';
  END IF;

  IF private.app_is_dev() THEN
    RETURN NULL;
  END IF;

  SELECT membership.id
  INTO v_membership_id
  FROM public.company_memberships AS membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = v_uid
    AND membership.status = 'active'
    AND (
      (p_manager_only AND membership.role = 'manager')
      OR (NOT p_manager_only AND membership.role IN ('manager', 'user', 'basic'))
    )
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DOCUMENT_MUTATION_FORBIDDEN';
  END IF;
  RETURN v_membership_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.prepare_api_document_data(
  p_company_id UUID,
  p_membership_id UUID,
  p_document_data JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client JSONB;
  v_client_id UUID;
  v_client_row public.clients%ROWTYPE;
  v_company JSONB;
  v_creator JSONB;
  v_total_before_vat NUMERIC(14, 2);
  v_vat_amount NUMERIC(14, 2);
  v_total_with_vat NUMERIC(14, 2);
  v_document_date TIMESTAMPTZ;
  v_invalid_part_count INTEGER;
BEGIN
  IF p_document_data IS NULL
     OR pg_catalog.jsonb_typeof(p_document_data) <> 'object'
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_object_keys(p_document_data) AS key(name)
       WHERE key.name NOT IN (
         'client', 'items', 'language', 'date', 'notes',
         'paymentMethod', 'paymentInfo', 'invoiceReference'
       )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DATA_INVALID';
  END IF;
  IF pg_catalog.jsonb_typeof(p_document_data -> 'client') <> 'object'
     OR pg_catalog.jsonb_typeof(p_document_data -> 'items') <> 'array'
     OR pg_catalog.jsonb_array_length(p_document_data -> 'items') NOT BETWEEN 1 AND 100
     OR COALESCE(p_document_data ->> 'language', '') NOT IN ('he', 'ar', 'en') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DATA_INVALID';
  END IF;

  v_client := p_document_data -> 'client';
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(v_client) AS key(name)
    WHERE key.name NOT IN (
      'clientId', 'name', 'email', 'phone', 'address', 'city', 'clientVatNumber'
    )
  )
     OR pg_catalog.jsonb_typeof(v_client -> 'name') <> 'string'
     OR pg_catalog.btrim(v_client ->> 'name') = ''
     OR pg_catalog.char_length(pg_catalog.btrim(v_client ->> 'name')) > 240 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_CLIENT_INVALID';
  END IF;
  IF v_client ? 'email' AND (
    pg_catalog.jsonb_typeof(v_client -> 'email') <> 'string'
    OR pg_catalog.char_length(pg_catalog.btrim(v_client ->> 'email')) > 320
    OR pg_catalog.lower(pg_catalog.btrim(v_client ->> 'email'))
      !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_CLIENT_EMAIL_INVALID';
  END IF;
  IF (v_client ? 'phone' AND (
        pg_catalog.jsonb_typeof(v_client -> 'phone') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(v_client ->> 'phone')) NOT BETWEEN 1 AND 40
      ))
     OR (v_client ? 'address' AND (
        pg_catalog.jsonb_typeof(v_client -> 'address') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(v_client ->> 'address')) NOT BETWEEN 1 AND 500
      ))
     OR (v_client ? 'city' AND (
        pg_catalog.jsonb_typeof(v_client -> 'city') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(v_client ->> 'city')) NOT BETWEEN 1 AND 120
      ))
     OR (v_client ? 'clientVatNumber' AND (
        pg_catalog.jsonb_typeof(v_client -> 'clientVatNumber') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(v_client ->> 'clientVatNumber')) NOT BETWEEN 1 AND 32
      )) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_CLIENT_INVALID';
  END IF;

  IF v_client ? 'clientId' THEN
    BEGIN
      v_client_id := (v_client ->> 'clientId')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_CLIENT_INVALID';
    END;
    SELECT client.*
    INTO v_client_row
    FROM public.clients AS client
    WHERE client.id = v_client_id
      AND client.company_id = p_company_id
      AND client.status = 'active'
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DOCUMENT_CLIENT_NOT_FOUND';
    END IF;
    v_client := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'clientId', v_client_row.id,
      'name', v_client_row.name,
      'email', v_client_row.email,
      'phone', v_client_row.phone,
      'address', v_client_row.address,
      'city', v_client_row.city,
      'clientVatNumber', v_client_row.vat_number
    ));
  ELSE
    v_client := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'name', pg_catalog.btrim(v_client ->> 'name'),
      'email', NULLIF(pg_catalog.lower(pg_catalog.btrim(v_client ->> 'email')), ''),
      'phone', NULLIF(pg_catalog.btrim(v_client ->> 'phone'), ''),
      'address', NULLIF(pg_catalog.btrim(v_client ->> 'address'), ''),
      'city', NULLIF(pg_catalog.btrim(v_client ->> 'city'), ''),
      'clientVatNumber', NULLIF(pg_catalog.btrim(v_client ->> 'clientVatNumber'), '')
    ));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_document_data -> 'items') AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.jsonb_object_keys(item.value) AS key(name)
         WHERE key.name NOT IN ('description', 'quantity', 'price', 'partNo')
       )
       OR pg_catalog.jsonb_typeof(item.value -> 'description') <> 'string'
       OR pg_catalog.btrim(item.value ->> 'description') = ''
       OR pg_catalog.char_length(pg_catalog.btrim(item.value ->> 'description')) > 240
       OR pg_catalog.jsonb_typeof(item.value -> 'quantity') <> 'number'
       OR (item.value ->> 'quantity')::NUMERIC <= 0
       OR (item.value ->> 'quantity')::NUMERIC > 99999999999.999
       OR pg_catalog.jsonb_typeof(item.value -> 'price') <> 'number'
       OR (item.value ->> 'price')::NUMERIC < 0
       OR (item.value ->> 'price')::NUMERIC > 99999999999.99
       OR (item.value ? 'partNo' AND (
         pg_catalog.jsonb_typeof(item.value -> 'partNo') <> 'number'
         OR (item.value ->> 'partNo')::NUMERIC <= 0
         OR (item.value ->> 'partNo')::NUMERIC <> pg_catalog.trunc((item.value ->> 'partNo')::NUMERIC)
       ))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_ITEMS_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::INTEGER
  INTO v_invalid_part_count
  FROM pg_catalog.jsonb_array_elements(p_document_data -> 'items') AS item(value)
  WHERE item.value ? 'partNo'
    AND NOT EXISTS (
      SELECT 1
      FROM public.inventory_parts AS part
      WHERE part.company_id = p_company_id
        AND part.part_no = (item.value ->> 'partNo')::INTEGER
        AND part.active
        AND part.archived_at IS NULL
    );
  IF v_invalid_part_count > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DOCUMENT_PART_NOT_FOUND';
  END IF;

  IF pg_catalog.jsonb_typeof(p_document_data -> 'date') <> 'string' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DATE_INVALID';
  END IF;
  BEGIN
    v_document_date := (p_document_data ->> 'date')::TIMESTAMPTZ;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DATE_INVALID';
  END;
  IF (p_document_data ? 'notes' AND (
        pg_catalog.jsonb_typeof(p_document_data -> 'notes') <> 'string'
        OR pg_catalog.char_length(p_document_data ->> 'notes') > 4000
      ))
     OR (p_document_data ? 'paymentMethod' AND (
        pg_catalog.jsonb_typeof(p_document_data -> 'paymentMethod') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(p_document_data ->> 'paymentMethod')) NOT BETWEEN 1 AND 80
      ))
     OR (p_document_data ? 'invoiceReference' AND (
        pg_catalog.jsonb_typeof(p_document_data -> 'invoiceReference') <> 'string'
        OR pg_catalog.char_length(pg_catalog.btrim(p_document_data ->> 'invoiceReference')) NOT BETWEEN 1 AND 128
      ))
     OR (p_document_data ? 'paymentInfo'
         AND pg_catalog.jsonb_typeof(p_document_data -> 'paymentInfo') NOT IN ('string', 'object')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DATA_INVALID';
  END IF;

  SELECT pg_catalog.round(pg_catalog.sum(
    (item.value ->> 'quantity')::NUMERIC * (item.value ->> 'price')::NUMERIC
  ), 2)
  INTO v_total_before_vat
  FROM pg_catalog.jsonb_array_elements(p_document_data -> 'items') AS item(value);
  IF v_total_before_vat IS NULL OR v_total_before_vat > 999999999999.99 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_TOTAL_INVALID';
  END IF;
  v_vat_amount := pg_catalog.round(v_total_before_vat * 0.18, 2);
  v_total_with_vat := v_total_before_vat + v_vat_amount;

  SELECT pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'name', COALESCE(profile.he_name, profile.en_name, ''),
    'nameHe', profile.he_name,
    'nameEn', profile.en_name,
    'email', profile.business_email,
    'phone', profile.business_phone,
    'address', NULLIF(pg_catalog.concat_ws(' ', profile.address, profile.city), ''),
    'vatNumber', profile.vat_number
  ))
  INTO v_company
  FROM (SELECT 1) AS seed
  LEFT JOIN public.company_profiles AS profile
    ON profile.company_id = p_company_id;

  IF p_membership_id IS NULL THEN
    v_creator := '{}'::JSONB;
  ELSE
    SELECT pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'wid', membership.member_no::TEXT,
      'name', COALESCE(membership.display_name, app_user.display_name, app_user.email)
    ))
    INTO v_creator
    FROM public.company_memberships AS membership
    LEFT JOIN public.app_users AS app_user ON app_user.id = membership.user_id
    WHERE membership.id = p_membership_id
      AND membership.company_id = p_company_id;
  END IF;

  RETURN pg_catalog.jsonb_strip_nulls(
    p_document_data
    || pg_catalog.jsonb_build_object(
      'client', v_client,
      'company', COALESCE(v_company, '{}'::JSONB),
      'creator', COALESCE(v_creator, '{}'::JSONB),
      'date', pg_catalog.to_char(v_document_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'totalBeforeVat', v_total_before_vat,
      'vatAmount', v_vat_amount,
      'totalWithVat', v_total_with_vat,
      'totals', pg_catalog.jsonb_build_object(
        'totalBeforeVat', v_total_before_vat,
        'vatAmount', v_vat_amount,
        'totalWithVat', v_total_with_vat
      )
    )
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_document_preview_task(
  p_company_id UUID,
  p_document_type SMALLINT,
  p_document_data JSONB,
  p_created_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS TABLE (
  task_key TEXT,
  task_status public.document_generation_status,
  document_id UUID,
  document_code TEXT,
  entity_version BIGINT,
  dispatch_payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_task_id UUID := extensions.gen_random_uuid();
  v_uid TEXT := private.app_auth_uid();
  v_public_company_id BIGINT;
  v_data JSONB;
  v_dispatch JSONB;
BEGIN
  IF p_document_type NOT IN (10, 200, 210, 305, 330, 400) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_TYPE_INVALID';
  END IF;
  v_membership_id := private.require_api_document_mutation_access(p_company_id, false);
  SELECT company.public_company_id
  INTO v_public_company_id
  FROM public.companies AS company
  WHERE company.id = p_company_id;
  v_data := private.prepare_api_document_data(p_company_id, v_membership_id, p_document_data);
  v_dispatch := pg_catalog.jsonb_build_object(
    'taskId', v_task_id::TEXT,
    'documentType', p_document_type,
    'documentData', v_data,
    'uid', v_uid,
    'companyId', v_public_company_id
  );

  INSERT INTO public.document_tasks (
    id, task_key, lock_key, company_id, user_id, document_id,
    task_type, document_type, status, request_payload, expire_at,
    next_dispatch_at, created_at
  ) VALUES (
    v_task_id, v_task_id::TEXT, 'task:' || v_task_id::TEXT, p_company_id, v_uid, NULL,
    'preview', p_document_type, 'pending', v_dispatch, p_created_at + interval '1 hour',
    p_created_at, p_created_at
  );

  task_key := v_task_id::TEXT;
  task_status := 'pending';
  document_id := NULL;
  document_code := NULL;
  entity_version := NULL;
  dispatch_payload := v_dispatch;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_document_generation_task(
  p_company_id UUID,
  p_document_type SMALLINT,
  p_document_data JSONB,
  p_created_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS TABLE (
  task_key TEXT,
  task_status public.document_generation_status,
  document_id UUID,
  document_code TEXT,
  entity_version BIGINT,
  dispatch_payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_task_id UUID := extensions.gen_random_uuid();
  v_document_id UUID := extensions.gen_random_uuid();
  v_uid TEXT := private.app_auth_uid();
  v_public_company_id BIGINT;
  v_document_number INTEGER;
  v_document_code TEXT;
  v_suffix TEXT;
  v_data JSONB;
  v_dispatch JSONB;
  v_client_id UUID;
BEGIN
  IF p_document_type NOT IN (10, 200, 210, 330, 400) THEN
    IF p_document_type = 305 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_WORKFLOW_REQUIRED';
    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_TYPE_INVALID';
  END IF;
  v_membership_id := private.require_api_document_mutation_access(p_company_id, false);
  SELECT company.public_company_id
  INTO v_public_company_id
  FROM public.companies AS company
  WHERE company.id = p_company_id;

  v_data := private.prepare_api_document_data(p_company_id, v_membership_id, p_document_data);
  v_document_number := private.allocate_company_counter(p_company_id, 'doc_' || p_document_type::TEXT);
  v_suffix := CASE p_document_type
    WHEN 10 THEN 'PP'
    WHEN 200 THEN 'DN'
    WHEN 210 THEN 'RC'
    WHEN 330 THEN 'RD'
    WHEN 400 THEN 'RT'
  END;
  v_document_code := v_suffix || v_document_number::TEXT || '-' || v_public_company_id::TEXT;
  v_data := v_data || pg_catalog.jsonb_build_object('documentNumber', v_document_number);
  IF v_data #>> '{client,clientId}' IS NOT NULL THEN
    v_client_id := (v_data #>> '{client,clientId}')::UUID;
  END IF;

  INSERT INTO public.documents (
    id, company_id, document_type, document_number, document_code,
    generation_status, tax_authority_status, client_id, created_by_membership_id,
    language, document_date, notes, total_before_vat, vat_amount, total_with_vat,
    company_name_snapshot, company_vat_snapshot, company_address_snapshot,
    client_name_snapshot, client_phone_snapshot, client_city_snapshot, client_vat_snapshot,
    payload, created_at, updated_at
  ) VALUES (
    v_document_id, p_company_id, p_document_type, v_document_number, v_document_code,
    'pending', 'none', v_client_id, v_membership_id,
    v_data ->> 'language', (v_data ->> 'date')::TIMESTAMPTZ, NULLIF(v_data ->> 'notes', ''),
    (v_data ->> 'totalBeforeVat')::NUMERIC(14, 2),
    (v_data ->> 'vatAmount')::NUMERIC(14, 2),
    (v_data ->> 'totalWithVat')::NUMERIC(14, 2),
    NULLIF(v_data #>> '{company,name}', ''),
    NULLIF(v_data #>> '{company,vatNumber}', ''),
    NULLIF(v_data #>> '{company,address}', ''),
    NULLIF(v_data #>> '{client,name}', ''),
    NULLIF(v_data #>> '{client,phone}', ''),
    NULLIF(v_data #>> '{client,city}', ''),
    NULLIF(v_data #>> '{client,clientVatNumber}', ''),
    v_data, p_created_at, p_created_at
  );

  INSERT INTO public.document_items (
    document_id, line_no, description, quantity, unit_price,
    line_total, source_inventory_part_id, metadata
  )
  SELECT
    v_document_id,
    item.line_no::INTEGER,
    pg_catalog.btrim(item.value ->> 'description'),
    (item.value ->> 'quantity')::NUMERIC(14, 3),
    (item.value ->> 'price')::NUMERIC(14, 2),
    pg_catalog.round(
      (item.value ->> 'quantity')::NUMERIC * (item.value ->> 'price')::NUMERIC,
      2
    )::NUMERIC(14, 2),
    part.id,
    CASE WHEN item.value ? 'partNo'
      THEN pg_catalog.jsonb_build_object('partNo', (item.value ->> 'partNo')::INTEGER)
      ELSE '{}'::JSONB
    END
  FROM pg_catalog.jsonb_array_elements(v_data -> 'items') WITH ORDINALITY AS item(value, line_no)
  LEFT JOIN public.inventory_parts AS part
    ON part.company_id = p_company_id
   AND part.part_no = CASE WHEN item.value ? 'partNo'
     THEN (item.value ->> 'partNo')::INTEGER ELSE NULL END;

  v_dispatch := pg_catalog.jsonb_build_object(
    'taskId', v_task_id::TEXT,
    'documentType', p_document_type,
    'documentData', v_data,
    'uid', v_uid,
    'companyId', v_public_company_id,
    'documentId', v_document_code,
    'documentNumber', v_document_number
  );
  INSERT INTO public.document_tasks (
    id, task_key, lock_key, company_id, user_id, document_id,
    task_type, document_type, status, request_payload, expire_at,
    next_dispatch_at, created_at
  ) VALUES (
    v_task_id, v_task_id::TEXT, 'document:' || v_document_id::TEXT,
    p_company_id, v_uid, v_document_id,
    'generate', p_document_type, 'pending', v_dispatch, p_created_at + interval '24 hours',
    p_created_at, p_created_at
  );

  PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  task_key := v_task_id::TEXT;
  task_status := 'pending';
  document_id := v_document_id;
  document_code := v_document_code;
  entity_version := 1;
  dispatch_payload := v_dispatch;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.delete_api_document(
  p_company_id UUID,
  p_document_id UUID,
  p_expected_entity_version BIGINT
) RETURNS TABLE (
  document_id UUID,
  document_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_document public.documents%ROWTYPE;
BEGIN
  PERFORM private.require_api_document_mutation_access(p_company_id, true);
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_ENTITY_VERSION_INVALID';
  END IF;
  SELECT document.*
  INTO v_document
  FROM public.documents AS document
  WHERE document.id = p_document_id
    AND document.company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DOCUMENT_NOT_FOUND';
  END IF;
  IF v_document.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'DOCUMENT_ENTITY_VERSION_CONFLICT';
  END IF;
  IF v_document.document_type = 305 AND v_document.tax_authority_status = 'approved' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'APPROVED_TAX_DOCUMENT_IMMUTABLE';
  END IF;
  IF v_document.storage_path IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'GENERATED_DOCUMENT_DELETE_REQUIRES_CLEANUP';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.document_tasks AS task
    WHERE task.document_id = v_document.id
      AND task.status IN ('pending', 'queued', 'processing')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'DOCUMENT_TASK_ACTIVE';
  END IF;

  DELETE FROM public.documents AS document
  WHERE document.id = v_document.id
    AND document.company_id = p_company_id;
  PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  document_id := v_document.id;
  document_code := v_document.document_code;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_api_document_dispatch_batch(
  p_lease_token UUID,
  p_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 30,
  p_task_key TEXT DEFAULT NULL
) RETURNS TABLE (
  task_key TEXT,
  task_type public.document_task_type,
  user_id TEXT,
  dispatch_attempt INTEGER,
  dispatch_payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_lease_token IS NULL
     OR p_limit NOT BETWEEN 1 AND 100
     OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DISPATCH_CLAIM_INVALID';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT task.id
    FROM public.document_tasks AS task
    WHERE task.status = 'pending'
      AND task.dispatched_at IS NULL
      AND (p_task_key IS NULL OR task.task_key = p_task_key)
      AND task.next_dispatch_at <= pg_catalog.clock_timestamp()
      AND (
        task.dispatch_lease_until IS NULL
        OR task.dispatch_lease_until <= pg_catalog.clock_timestamp()
      )
    ORDER BY task.next_dispatch_at, task.created_at, task.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.document_tasks AS task
    SET dispatch_attempts = task.dispatch_attempts + 1,
        dispatch_lease_token = p_lease_token,
        dispatch_lease_until = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_lease_seconds),
        dispatch_error = NULL
    FROM candidates
    WHERE task.id = candidates.id
    RETURNING task.task_key, task.task_type, task.user_id,
      task.dispatch_attempts, task.request_payload
  )
  SELECT claimed.task_key::TEXT, claimed.task_type, claimed.user_id,
    claimed.dispatch_attempts, claimed.request_payload
  FROM claimed;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.complete_api_document_dispatch(
  p_task_key TEXT,
  p_lease_token UUID,
  p_dispatched_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.document_tasks AS task
  SET status = 'queued',
      dispatched_at = p_dispatched_at,
      dispatch_lease_token = NULL,
      dispatch_lease_until = NULL,
      dispatch_error = NULL
  WHERE task.task_key = p_task_key
    AND task.status = 'pending'
    AND task.dispatched_at IS NULL
    AND task.dispatch_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.retry_api_document_dispatch(
  p_task_key TEXT,
  p_lease_token UUID,
  p_error TEXT,
  p_retry_after_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_retry_after_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_DISPATCH_RETRY_INVALID';
  END IF;
  UPDATE public.document_tasks AS task
  SET next_dispatch_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_retry_after_seconds),
      dispatch_lease_token = NULL,
      dispatch_lease_until = NULL,
      dispatch_error = pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'Dispatch failed'), 2000)
  WHERE task.task_key = p_task_key
    AND task.status = 'pending'
    AND task.dispatched_at IS NULL
    AND task.dispatch_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.increment_document_entity_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.require_api_document_mutation_access(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.prepare_api_document_data(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.create_api_document_preview_task(UUID, SMALLINT, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.create_api_document_generation_task(UUID, SMALLINT, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.delete_api_document(UUID, UUID, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.claim_api_document_dispatch_batch(UUID, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.complete_api_document_dispatch(TEXT, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.retry_api_document_dispatch(TEXT, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION private.create_api_document_preview_task(UUID, SMALLINT, JSONB, TIMESTAMPTZ)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.create_api_document_generation_task(UUID, SMALLINT, JSONB, TIMESTAMPTZ)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.delete_api_document(UUID, UUID, BIGINT)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.claim_api_document_dispatch_batch(UUID, INTEGER, INTEGER, TEXT)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.complete_api_document_dispatch(TEXT, UUID, TIMESTAMPTZ)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.retry_api_document_dispatch(TEXT, UUID, TEXT, INTEGER)
  TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0023_api_tax_callback_processing.sql
-- ============================================================================
-- Tax callback processing: idempotent event tracking and document status updates.
--
-- The cloudrun-tax service forwards authenticated callbacks to a protected
-- internal main-API endpoint. This migration adds the private callback event
-- log, an indexed OAuth-session link on tax invoice reservations, and the
-- single SECURITY DEFINER entrypoint that atomically records the event and
-- updates the document and reservation status.

ALTER TABLE public.tax_invoice_reservations
  ADD COLUMN oauth_session_id VARCHAR(128);--> statement-breakpoint

CREATE UNIQUE INDEX tax_invoice_reservations_oauth_session_id_unique
  ON public.tax_invoice_reservations (oauth_session_id)
  WHERE oauth_session_id IS NOT NULL;--> statement-breakpoint

CREATE TABLE private.tax_callback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(128) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  reservation_id UUID REFERENCES public.tax_invoice_reservations(id) ON DELETE SET NULL,
  callback_status VARCHAR(32) NOT NULL,
  confirmation_number VARCHAR(128),
  error_code VARCHAR(128),
  error_message TEXT,
  oauth_session_id VARCHAR(128) NOT NULL,
  occurred_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT tax_callback_events_event_id_length_check
    CHECK (length(event_id) >= 8 AND length(event_id) <= 128),
  CONSTRAINT tax_callback_events_payload_hash_length_check
    CHECK (length(payload_hash) = 64),
  CONSTRAINT tax_callback_events_callback_status_check
    CHECK (callback_status IN ('approved', 'rejected', 'error'))
);--> statement-breakpoint

CREATE UNIQUE INDEX tax_callback_events_event_id_unique
  ON private.tax_callback_events (event_id);--> statement-breakpoint

CREATE INDEX tax_callback_events_company_created_idx
  ON private.tax_callback_events (company_id, created_at DESC);--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.bind_api_tax_approval_session(
  p_document_id UUID,
  p_oauth_session_id VARCHAR(128)
) RETURNS TABLE(bound BOOLEAN, idempotent_replay BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.tax_invoice_reservations%ROWTYPE;
  v_document_type INTEGER;
BEGIN
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_APPROVAL_DOCUMENT_ID_INVALID';
  END IF;
  IF p_oauth_session_id IS NULL OR length(p_oauth_session_id) < 1 OR length(p_oauth_session_id) > 128 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_APPROVAL_OAUTH_SESSION_ID_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tax-approval-session:' || p_oauth_session_id, 0)
  );

  SELECT reservation.*
  INTO v_reservation
  FROM public.tax_invoice_reservations reservation
  INNER JOIN public.documents document ON document.id = reservation.document_id
  WHERE reservation.document_id = p_document_id
  FOR UPDATE OF reservation;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TAX_APPROVAL_RESERVATION_NOT_FOUND';
  END IF;
  SELECT document_type INTO v_document_type
  FROM public.documents
  WHERE id = v_reservation.document_id;
  IF v_document_type <> 305 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_APPROVAL_NOT_TAX_INVOICE';
  END IF;
  IF v_reservation.oauth_session_id IS NOT NULL THEN
    IF v_reservation.oauth_session_id = p_oauth_session_id THEN
      RETURN QUERY SELECT true, true;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TAX_APPROVAL_SESSION_CONFLICT';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tax_invoice_reservations reservation
    WHERE reservation.oauth_session_id = p_oauth_session_id
      AND reservation.id <> v_reservation.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TAX_APPROVAL_SESSION_CONFLICT';
  END IF;
  IF v_reservation.status NOT IN ('reserved', 'submitted') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_APPROVAL_RESERVATION_NOT_SUBMITTABLE';
  END IF;

  UPDATE public.tax_invoice_reservations
  SET oauth_session_id = p_oauth_session_id,
      status = 'submitted',
      status_payload = status_payload || jsonb_build_object(
        'oauthSessionId', p_oauth_session_id,
        'submittedAt', pg_catalog.clock_timestamp()
      ),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_reservation.id;

  RETURN QUERY SELECT true, false;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.process_api_tax_callback(
  p_event_id VARCHAR,
  p_payload_hash VARCHAR(64),
  p_oauth_session_id VARCHAR(128),
  p_callback_status VARCHAR(32),
  p_confirmation_number VARCHAR(128),
  p_error_code VARCHAR(128),
  p_error_message TEXT,
  p_occurred_at TIMESTAMPTZ
) RETURNS TABLE(processed BOOLEAN, idempotent_replay BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_event private.tax_callback_events%ROWTYPE;
  v_reservation public.tax_invoice_reservations%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_new_tax_status public.tax_authority_status;
  v_new_reservation_status public.tax_invoice_reservation_status;
  v_callback_response JSONB;
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) < 8 OR length(p_event_id) > 128 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_CALLBACK_INVALID_EVENT_ID';
  END IF;
  IF p_payload_hash IS NULL OR length(p_payload_hash) <> 64 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_CALLBACK_INVALID_PAYLOAD_HASH';
  END IF;
  IF p_oauth_session_id IS NULL OR length(p_oauth_session_id) < 1 OR length(p_oauth_session_id) > 128 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_CALLBACK_INVALID_OAUTH_SESSION_ID';
  END IF;
  IF p_callback_status NOT IN ('approved', 'rejected', 'error') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_CALLBACK_INVALID_STATUS';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tax-callback-event:' || p_event_id, 0)
  );

  -- Idempotency: lock existing event by event_id
  SELECT * INTO v_existing_event
  FROM private.tax_callback_events
  WHERE event_id = p_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_event.payload_hash = p_payload_hash THEN
      RETURN QUERY SELECT true, true;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TAX_CALLBACK_PAYLOAD_CONFLICT';
  END IF;

  -- Look up the reservation by OAuth session ID
  SELECT * INTO v_reservation
  FROM public.tax_invoice_reservations
  WHERE oauth_session_id = p_oauth_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TAX_CALLBACK_RESERVATION_NOT_FOUND';
  END IF;

  -- Lock the linked document
  SELECT * INTO v_document
  FROM public.documents
  WHERE id = v_reservation.document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TAX_CALLBACK_DOCUMENT_NOT_FOUND';
  END IF;

  -- Only tax invoices (doc type 305) participate in the tax workflow
  IF v_document.document_type <> 305 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_CALLBACK_NOT_TAX_INVOICE';
  END IF;

  -- Map callback status to internal enums
  v_new_tax_status := CASE p_callback_status
    WHEN 'approved' THEN 'approved'::public.tax_authority_status
    WHEN 'rejected' THEN 'rejected'::public.tax_authority_status
    WHEN 'error' THEN 'failed'::public.tax_authority_status
  END;

  v_new_reservation_status := CASE p_callback_status
    WHEN 'approved' THEN 'approved'::public.tax_invoice_reservation_status
    WHEN 'rejected' THEN 'rejected'::public.tax_invoice_reservation_status
    WHEN 'error' THEN 'failed'::public.tax_invoice_reservation_status
  END;

  v_callback_response := jsonb_build_object(
    'status', p_callback_status,
    'eventId', p_event_id,
    'oauthSessionId', p_oauth_session_id,
    'confirmationNumber', p_confirmation_number,
    'errorCode', p_error_code,
    'errorMessage', p_error_message,
    'occurredAt', p_occurred_at,
    'processedAt', pg_catalog.clock_timestamp()
  );

  -- Update the document
  UPDATE public.documents
  SET tax_authority_status = v_new_tax_status,
      confirmation_number = COALESCE(p_confirmation_number, documents.confirmation_number),
      tax_authority_response = v_callback_response,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_document.id;

  -- Update the reservation
  UPDATE public.tax_invoice_reservations
  SET status = v_new_reservation_status,
      external_confirmation_number = COALESCE(p_confirmation_number, tax_invoice_reservations.external_confirmation_number),
      status_payload = tax_invoice_reservations.status_payload
        || jsonb_build_object(
          'callbackStatus', p_callback_status,
          'errorCode', p_error_code,
          'errorMessage', p_error_message,
          'processedAt', pg_catalog.clock_timestamp()
        ),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_reservation.id;

  -- Record the event
  INSERT INTO private.tax_callback_events (
    event_id, payload_hash, company_id, document_id, reservation_id,
    callback_status, confirmation_number, error_code, error_message,
    oauth_session_id, occurred_at
  ) VALUES (
    p_event_id, p_payload_hash, v_reservation.company_id, v_document.id, v_reservation.id,
    p_callback_status, p_confirmation_number, p_error_code, p_error_message,
    p_oauth_session_id, p_occurred_at
  );

  -- Bump sync version so clients see the updated document
  PERFORM private.bump_company_sync_version(v_reservation.company_id, 'documents_version');

  RETURN QUERY SELECT true, false;
END;
$$;--> statement-breakpoint

-- Bounded cleanup for old callback events (called by the maintenance workload)
CREATE OR REPLACE FUNCTION private.cleanup_tax_callback_events(
  p_retention_days INTEGER DEFAULT 90
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INTEGER;
  v_retention INTEGER := LEAST(GREATEST(COALESCE(p_retention_days, 90), 1), 365);
BEGIN
  DELETE FROM private.tax_callback_events
  WHERE created_at < pg_catalog.clock_timestamp()
    - pg_catalog.make_interval(days => v_retention);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.process_api_tax_callback(
  VARCHAR, VARCHAR(64), VARCHAR(128), VARCHAR(32),
  VARCHAR(128), VARCHAR(128), TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.bind_api_tax_approval_session(UUID, VARCHAR(128))
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.cleanup_tax_callback_events(INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.process_api_tax_callback(
  VARCHAR, VARCHAR(64), VARCHAR(128), VARCHAR(32),
  VARCHAR(128), VARCHAR(128), TEXT, TIMESTAMPTZ
) TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.bind_api_tax_approval_session(UUID, VARCHAR(128))
  TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.cleanup_tax_callback_events(INTEGER)
  TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0024_api_archive_retrieval.sql
-- ============================================================================
-- Archive retrieval: RLS policies, API role grants, and a list RPC.
--
-- The archive_runs table existed in the baseline but had RLS enabled with no
-- policies and no grants to smart_job_api, making it unreadable through the
-- API role. This migration adds the missing policies, grants, and a bounded
-- list function so company members can discover their monthly archives.

CREATE OR REPLACE FUNCTION private.app_has_archive_access(
  p_company_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.app_is_dev()
    OR EXISTS (
      SELECT 1
      FROM public.company_memberships membership
      WHERE membership.company_id = p_company_id
        AND membership.user_id = private.app_auth_uid()
        AND membership.status = 'active'
    )
    OR (
      EXISTS (
        SELECT 1
        FROM public.company_memberships membership
        WHERE membership.company_id = p_company_id
          AND membership.user_id = private.app_auth_uid()
          AND membership.status = 'active'
      )
      AND EXISTS (
        SELECT 1
        FROM public.company_subscriptions subscription
        WHERE subscription.company_id = p_company_id
      )
    )
$$;--> statement-breakpoint

CREATE POLICY archive_runs_company_read_policy
  ON public.archive_runs
  FOR SELECT
  USING (private.app_has_archive_access(company_id));--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.list_api_company_archives(
  p_internal_company_id UUID,
  p_data_type VARCHAR(32) DEFAULT NULL,
  p_page_size INTEGER DEFAULT 50,
  p_after_created_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL
) RETURNS TABLE(
  id UUID,
  archive_key VARCHAR,
  data_type VARCHAR,
  status archive_run_status,
  doc_count INTEGER,
  deleted_count INTEGER,
  storage_path VARCHAR,
  checksum VARCHAR,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_page_size INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200);
  v_has_access BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'COMPANY_MEMBERSHIP_REQUIRED';
  END IF;

  SELECT private.app_has_archive_access(p_internal_company_id) INTO v_has_access;
  IF NOT v_has_access THEN
    RAISE EXCEPTION 'COMPANY_ACCESS_DENIED';
  END IF;

  IF p_data_type IS NOT NULL AND p_data_type NOT IN ('jobs', 'documents') THEN
    RAISE EXCEPTION 'INVALID_DATA_TYPE';
  END IF;

  RETURN QUERY
  SELECT
    ar.id,
    ar.archive_key,
    ar.data_type,
    ar.status,
    ar.doc_count,
    ar.deleted_count,
    ar.storage_path,
    ar.checksum,
    ar.created_at,
    ar.completed_at
  FROM public.archive_runs ar
  WHERE ar.company_id = p_internal_company_id
    AND (p_data_type IS NULL OR ar.data_type = p_data_type)
    AND (
      p_after_created_at IS NULL
      OR (ar.created_at, ar.id) < (p_after_created_at, COALESCE(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  ORDER BY ar.created_at DESC, ar.id DESC
  LIMIT v_page_size + 1;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.app_has_archive_access(UUID)
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.list_api_company_archives(UUID, VARCHAR(32), INTEGER, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.list_api_company_archives(UUID, VARCHAR(32), INTEGER, TIMESTAMPTZ, UUID)
  TO smart_job_api;--> statement-breakpoint

GRANT SELECT ON public.archive_runs TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0025_post_0024_metadata_baseline.sql
-- ============================================================================
-- Metadata-only baseline.
--
-- Migrations 0013 through 0024 were intentionally authored as custom SQL and
-- therefore did not advance Drizzle Kit's schema snapshot. The companion
-- 0025_snapshot.json captures the schema after applying 0000 through 0024.
-- All DDL originally emitted while producing that snapshot already exists in
-- those migrations, so this migration must remain a database no-op.
SELECT 1;

-- ============================================================================
-- Consolidated source: 0026_job_acceptance_inventory_consumption.sql
-- ============================================================================
-- Accepting a submitted job must consume its recorded inventory-backed parts
-- in the same transaction, before the job becomes finished. The locked job row
-- is the exactly-once gate for concurrent acceptance attempts.

CREATE OR REPLACE FUNCTION private.accept_api_job(
  p_company_id UUID,
  p_job_id UUID,
  p_expected_entity_version BIGINT,
  p_accepted_at TIMESTAMPTZ
) RETURNS TABLE (
  job_id UUID,
  job_no INTEGER,
  status TEXT,
  title TEXT,
  description TEXT,
  notes TEXT,
  location TEXT,
  address TEXT,
  category TEXT,
  priority TEXT,
  due_at TIMESTAMPTZ,
  client_id UUID,
  client_name TEXT,
  client_phone TEXT,
  assignee_member_no INTEGER,
  assignee_display_name TEXT,
  creator_uid UUID,
  creator_member_no INTEGER,
  creator_display_name TEXT,
  is_certificate BOOLEAN,
  meta JSONB,
  entity_version BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_actor_user_id TEXT;
  v_actor_membership_id UUID;
  v_actor_role TEXT;
  v_consumer_membership_id UUID;
  v_consumption_parts JSONB := '[]'::JSONB;
  v_accepted_at TIMESTAMPTZ := COALESCE(
    p_accepted_at,
    pg_catalog.clock_timestamp()
  );
BEGIN
  IF p_company_id IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COMPANY_AND_JOB_REQUIRED';
  END IF;
  IF p_expected_entity_version IS NULL OR p_expected_entity_version < 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ENTITY_VERSION_INVALID';
  END IF;

  SELECT
    actor.actor_user_id,
    actor.actor_membership_id,
    actor.actor_role
  INTO v_actor_user_id, v_actor_membership_id, v_actor_role
  FROM private.require_api_job_mutation_actor(p_company_id) AS actor;
  IF v_actor_role NOT IN ('manager', 'dev') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'JOB_ACCEPT_FORBIDDEN';
  END IF;

  SELECT job.*
  INTO v_job
  FROM public.jobs AS job
  WHERE job.company_id = p_company_id
    AND job.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'JOB_NOT_FOUND';
  END IF;
  IF v_job.entity_version <> p_expected_entity_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'ENTITY_VERSION_CONFLICT';
  END IF;
  IF v_job.status NOT IN ('pending', 'waiting') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'JOB_NOT_ACCEPTABLE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.job_part_usages AS usage
    WHERE usage.job_id = v_job.id
      AND usage.inventory_part_id IS NOT NULL
      AND usage.quantity > 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.inventory_parts AS part
        WHERE part.id = usage.inventory_part_id
          AND part.company_id = p_company_id
          AND part.active
          AND part.archived_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'INVENTORY_PART_NOT_FOUND';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'part_id', consumption.inventory_part_id,
        'part_no', consumption.part_no,
        'quantity', consumption.quantity
      )
      ORDER BY consumption.inventory_part_id
    ),
    '[]'::JSONB
  )
  INTO v_consumption_parts
  FROM (
    SELECT
      usage.inventory_part_id,
      part.part_no,
      pg_catalog.sum(usage.quantity)::NUMERIC AS quantity
    FROM public.job_part_usages AS usage
    INNER JOIN public.inventory_parts AS part
      ON part.id = usage.inventory_part_id
     AND part.company_id = p_company_id
     AND part.active
     AND part.archived_at IS NULL
    WHERE usage.job_id = v_job.id
      AND usage.inventory_part_id IS NOT NULL
      AND usage.quantity > 0
    GROUP BY usage.inventory_part_id, part.part_no
  ) AS consumption;

  IF pg_catalog.jsonb_array_length(v_consumption_parts) > 0 THEN
    v_consumer_membership_id := COALESCE(
      v_job.assigned_membership_id,
      v_actor_membership_id
    );
    IF v_consumer_membership_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'INVENTORY_CONSUMER_MEMBERSHIP_REQUIRED';
    END IF;

    PERFORM 1
    FROM private.apply_job_inventory_consumption_batch(
      p_company_id,
      v_consumer_membership_id,
      p_job_id,
      COALESCE(
        v_actor_membership_id,
        v_job.created_by_membership_id,
        v_consumer_membership_id
      ),
      v_consumption_parts,
      v_accepted_at
    );
  END IF;

  UPDATE public.jobs AS job
  SET
    status = 'finished',
    accepted_by_user_id = v_actor_user_id,
    accepted_at = v_accepted_at,
    finished_at = v_accepted_at,
    denied_at = NULL,
    denied_by_user_id = NULL,
    updated_at = v_accepted_at
  WHERE job.id = p_job_id
    AND job.company_id = p_company_id
  RETURNING job.* INTO v_job;

  IF pg_catalog.jsonb_array_length(v_consumption_parts) > 0 THEN
    PERFORM private.bump_company_sync_version(
      p_company_id,
      'company_inventory_version'
    );
  END IF;
  PERFORM private.bump_company_sync_version(p_company_id, 'jobs_version');

  RETURN QUERY
  SELECT result.*
  FROM private.get_api_job_mutation_result(p_company_id, p_job_id) AS result;
END;
$$;

REVOKE ALL ON FUNCTION private.accept_api_job(UUID, UUID, BIGINT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.accept_api_job(UUID, UUID, BIGINT, TIMESTAMPTZ)
  TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0027_durable_workflow_foundations.sql
-- ============================================================================
-- Expand-only workflow types. Existing public tax enums gain the explicit
-- submitted state; new worker state machines live in the private schema.
ALTER TYPE public.tax_authority_status
  ADD VALUE IF NOT EXISTS 'submitted' AFTER 'reserved';
--> statement-breakpoint
ALTER TYPE public.tax_invoice_reservation_status
  ADD VALUE IF NOT EXISTS 'submitted' AFTER 'reserved';
--> statement-breakpoint
CREATE TYPE public.email_delivery_status AS ENUM (
  'queued', 'sending', 'sent', 'failed', 'delivery_unknown'
);
--> statement-breakpoint
CREATE TYPE public.tax_submission_status AS ENUM (
  'queued', 'submitting', 'submitted', 'approved', 'rejected', 'failed',
  'submission_unknown'
);
--> statement-breakpoint
CREATE TYPE public.archive_run_lease_status AS ENUM (
  'pending', 'leased', 'completed', 'failed'
);
--> statement-breakpoint

-- Passwords are intentionally absent. Platform provisioning assigns strong
-- passwords out of band and injects only role-specific connection URLs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'smart_job_pdf') THEN
    CREATE ROLE smart_job_pdf LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS PASSWORD NULL CONNECTION LIMIT 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'smart_job_email') THEN
    CREATE ROLE smart_job_email LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS PASSWORD NULL CONNECTION LIMIT 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'smart_job_archiver') THEN
    CREATE ROLE smart_job_archiver LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS PASSWORD NULL CONNECTION LIMIT 1;
  END IF;
END
$$;
--> statement-breakpoint
-- The migration owner may assume worker roles for local permission tests and
-- production diagnostics. This grants no capability to the worker roles.
GRANT smart_job_pdf, smart_job_email, smart_job_archiver TO postgres;
--> statement-breakpoint
ALTER ROLE smart_job_pdf SET statement_timeout = '300s';
ALTER ROLE smart_job_pdf SET lock_timeout = '5s';
ALTER ROLE smart_job_pdf SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE smart_job_email SET statement_timeout = '30s';
ALTER ROLE smart_job_email SET lock_timeout = '3s';
ALTER ROLE smart_job_email SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE smart_job_archiver SET statement_timeout = '60min';
ALTER ROLE smart_job_archiver SET lock_timeout = '5s';
ALTER ROLE smart_job_archiver SET idle_in_transaction_session_timeout = '30s';
--> statement-breakpoint

CREATE TABLE "private"."archive_run_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"archive_key" varchar(64) NOT NULL,
	"data_type" varchar(32) NOT NULL,
	"status" "archive_run_lease_status" DEFAULT 'pending' NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_run_leases_attempt_count_check" CHECK ("private"."archive_run_leases"."attempt_count" BETWEEN 0 AND 100),
	CONSTRAINT "archive_run_leases_data_type_check" CHECK ("private"."archive_run_leases"."data_type" IN ('jobs', 'documents')),
	CONSTRAINT "archive_run_leases_lease_check" CHECK ((
      ("private"."archive_run_leases"."status" = 'leased' AND "private"."archive_run_leases"."lease_token" IS NOT NULL AND "private"."archive_run_leases"."lease_until" IS NOT NULL)
      OR ("private"."archive_run_leases"."status" <> 'leased' AND "private"."archive_run_leases"."lease_token" IS NULL AND "private"."archive_run_leases"."lease_until" IS NULL)
    ))
);
--> statement-breakpoint
CREATE TABLE "private"."document_email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"status" "email_delivery_status" DEFAULT 'queued' NOT NULL,
	"recipient_email" varchar(320) NOT NULL,
	"dispatch_attempts" integer DEFAULT 0 NOT NULL,
	"dispatch_lease_token" uuid,
	"dispatch_lease_until" timestamp with time zone,
	"next_dispatch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"send_lease_token" uuid,
	"send_lease_until" timestamp with time zone,
	"provider_message_id" varchar(256),
	"last_error" text,
	"manual_retry_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_email_deliveries_dispatch_attempts_check" CHECK ("private"."document_email_deliveries"."dispatch_attempts" BETWEEN 0 AND 100),
	CONSTRAINT "document_email_deliveries_send_attempts_check" CHECK ("private"."document_email_deliveries"."send_attempts" BETWEEN 0 AND 100),
	CONSTRAINT "document_email_deliveries_manual_retry_count_check" CHECK ("private"."document_email_deliveries"."manual_retry_count" BETWEEN 0 AND 20),
	CONSTRAINT "document_email_deliveries_dispatch_lease_check" CHECK ((
      ("private"."document_email_deliveries"."dispatch_lease_token" IS NULL AND "private"."document_email_deliveries"."dispatch_lease_until" IS NULL)
      OR ("private"."document_email_deliveries"."dispatch_lease_token" IS NOT NULL AND "private"."document_email_deliveries"."dispatch_lease_until" IS NOT NULL)
    )),
	CONSTRAINT "document_email_deliveries_send_lease_check" CHECK ((
      ("private"."document_email_deliveries"."status" = 'sending' AND "private"."document_email_deliveries"."send_lease_token" IS NOT NULL AND "private"."document_email_deliveries"."send_lease_until" IS NOT NULL)
      OR ("private"."document_email_deliveries"."status" <> 'sending' AND "private"."document_email_deliveries"."send_lease_token" IS NULL AND "private"."document_email_deliveries"."send_lease_until" IS NULL)
    )),
	CONSTRAINT "document_email_deliveries_sent_state_check" CHECK ((
      ("private"."document_email_deliveries"."status" = 'sent' AND "private"."document_email_deliveries"."sent_at" IS NOT NULL AND "private"."document_email_deliveries"."provider_message_id" IS NOT NULL)
      OR ("private"."document_email_deliveries"."status" <> 'sent' AND "private"."document_email_deliveries"."sent_at" IS NULL)
    )),
	CONSTRAINT "document_email_deliveries_recipient_check" CHECK (char_length(btrim("private"."document_email_deliveries"."recipient_email")) BETWEEN 3 AND 320
      AND "private"."document_email_deliveries"."recipient_email" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
);
--> statement-breakpoint
CREATE TABLE "private"."tax_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"correlation_id" varchar(128) NOT NULL,
	"status" "tax_submission_status" DEFAULT 'queued' NOT NULL,
	"request_payload" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"authority_request_id" varchar(256),
	"response_payload" jsonb,
	"last_error" text,
	"submitted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_submissions_attempt_count_check" CHECK ("private"."tax_submissions"."attempt_count" BETWEEN 0 AND 100),
	CONSTRAINT "tax_submissions_lease_check" CHECK ((
      ("private"."tax_submissions"."status" = 'submitting' AND "private"."tax_submissions"."lease_token" IS NOT NULL AND "private"."tax_submissions"."lease_until" IS NOT NULL)
      OR ("private"."tax_submissions"."status" <> 'submitting' AND "private"."tax_submissions"."lease_token" IS NULL AND "private"."tax_submissions"."lease_until" IS NULL)
    )),
	CONSTRAINT "tax_submissions_correlation_check" CHECK (char_length(btrim("private"."tax_submissions"."correlation_id")) BETWEEN 8 AND 128),
	CONSTRAINT "tax_submissions_request_payload_check" CHECK (jsonb_typeof("private"."tax_submissions"."request_payload") = 'object')
);
--> statement-breakpoint
ALTER TABLE "document_tasks" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_tasks" ADD COLUMN "processing_lease_token" uuid;--> statement-breakpoint
ALTER TABLE "document_tasks" ADD COLUMN "processing_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "private"."archive_run_leases" ADD CONSTRAINT "archive_run_leases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."document_email_deliveries" ADD CONSTRAINT "document_email_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."document_email_deliveries" ADD CONSTRAINT "document_email_deliveries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."tax_submissions" ADD CONSTRAINT "tax_submissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."tax_submissions" ADD CONSTRAINT "tax_submissions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."tax_submissions" ADD CONSTRAINT "tax_submissions_reservation_id_tax_invoice_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."tax_invoice_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "archive_run_leases_company_archive_type_unique" ON "private"."archive_run_leases" USING btree ("company_id","archive_key","data_type");--> statement-breakpoint
CREATE INDEX "archive_run_leases_queue_idx" ON "private"."archive_run_leases" USING btree ("status","lease_until","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_email_deliveries_document_unique" ON "private"."document_email_deliveries" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_email_deliveries_company_status_created_idx" ON "private"."document_email_deliveries" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX "document_email_deliveries_dispatch_queue_idx" ON "private"."document_email_deliveries" USING btree ("next_dispatch_at","created_at","id") WHERE "private"."document_email_deliveries"."status" = 'queued' AND "private"."document_email_deliveries"."dispatched_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_submissions_document_unique" ON "private"."tax_submissions" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_submissions_reservation_unique" ON "private"."tax_submissions" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_submissions_correlation_unique" ON "private"."tax_submissions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "tax_submissions_queue_idx" ON "private"."tax_submissions" USING btree ("next_attempt_at","created_at","id") WHERE "private"."tax_submissions"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "tax_submissions_company_status_created_idx" ON "private"."tax_submissions" USING btree ("company_id","status","created_at");--> statement-breakpoint
ALTER TABLE "document_tasks" ADD CONSTRAINT "document_tasks_processing_attempts_non_negative_check" CHECK ("document_tasks"."processing_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "document_tasks" ADD CONSTRAINT "document_tasks_processing_lease_consistency_check" CHECK ((
      ("document_tasks"."processing_lease_token" IS NULL AND "document_tasks"."processing_lease_until" IS NULL)
      OR ("document_tasks"."processing_lease_token" IS NOT NULL AND "document_tasks"."processing_lease_until" IS NOT NULL)
    ));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_archive_run_lease(
  p_company_id UUID,
  p_archive_key TEXT,
  p_data_type TEXT,
  p_snapshot_at TIMESTAMPTZ,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 3600
) RETURNS TABLE (
  lease_id UUID,
  claimed BOOLEAN,
  attempt_count INTEGER,
  snapshot_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
BEGIN
  IF p_company_id IS NULL
     OR p_lease_token IS NULL
     OR p_snapshot_at IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_archive_key, ''))) NOT BETWEEN 1 AND 64
     OR p_data_type NOT IN ('jobs', 'documents')
     OR p_lease_seconds NOT BETWEEN 60 AND 7200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_LEASE_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.companies AS company
    WHERE company.id = p_company_id AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ARCHIVE_COMPANY_NOT_FOUND';
  END IF;

  INSERT INTO private.archive_run_leases (
    company_id, archive_key, data_type, status, snapshot_at
  ) VALUES (
    p_company_id,
    pg_catalog.btrim(p_archive_key),
    p_data_type,
    'pending',
    p_snapshot_at
  )
  ON CONFLICT (company_id, archive_key, data_type) DO NOTHING;

  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.company_id = p_company_id
    AND lease.archive_key = pg_catalog.btrim(p_archive_key)
    AND lease.data_type = p_data_type
  FOR UPDATE;

  IF v_lease.status = 'completed'
     OR (
       v_lease.status = 'leased'
       AND v_lease.lease_until > pg_catalog.clock_timestamp()
     ) THEN
    lease_id := v_lease.id;
    claimed := false;
    attempt_count := v_lease.attempt_count;
    snapshot_at := v_lease.snapshot_at;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE private.archive_run_leases AS lease
  SET status = 'leased',
      snapshot_at = LEAST(lease.snapshot_at, p_snapshot_at),
      lease_token = p_lease_token,
      lease_until = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_lease_seconds),
      attempt_count = lease.attempt_count + 1,
      last_error = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE lease.id = v_lease.id
  RETURNING lease.* INTO v_lease;

  lease_id := v_lease.id;
  claimed := true;
  attempt_count := v_lease.attempt_count;
  snapshot_at := v_lease.snapshot_at;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.finish_archive_run_lease(
  p_lease_id UUID,
  p_lease_token UUID,
  p_succeeded BOOLEAN,
  p_error TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_lease_id IS NULL OR p_lease_token IS NULL OR p_succeeded IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_LEASE_RESULT_INVALID';
  END IF;
  UPDATE private.archive_run_leases AS lease
  SET status = (CASE WHEN p_succeeded THEN 'completed' ELSE 'failed' END)::public.archive_run_lease_status,
      lease_token = NULL,
      lease_until = NULL,
      last_error = CASE
        WHEN p_succeeded THEN NULL
        ELSE pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'Archive run failed'), 2000)
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

-- New private objects stay opt-in even if platform defaults differ by project.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON TABLE
  private.archive_run_leases,
  private.document_email_deliveries,
  private.tax_submissions
FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
  smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.claim_archive_run_lease(
  UUID, TEXT, TEXT, TIMESTAMPTZ, UUID, INTEGER
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
  smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.finish_archive_run_lease(
  UUID, UUID, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
  smart_job_pdf, smart_job_email;

GRANT USAGE ON SCHEMA private TO smart_job_pdf, smart_job_email, smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.claim_archive_run_lease(
  UUID, TEXT, TEXT, TIMESTAMPTZ, UUID, INTEGER
) TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.finish_archive_run_lease(
  UUID, UUID, BOOLEAN, TEXT
) TO smart_job_archiver;

-- ============================================================================
-- Consolidated source: 0028_reliable_document_email_pipeline.sql
-- ============================================================================
-- Opaque Pub/Sub messages carry only task/delivery IDs. Worker roles load all
-- canonical tenant, user, document, and request state through these private
-- lease-token RPCs and receive no direct table privileges.

CREATE OR REPLACE FUNCTION private.complete_api_document_dispatch(
  p_task_key TEXT,
  p_lease_token UUID,
  p_dispatched_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.document_tasks AS task
  SET status = CASE WHEN task.status = 'pending' THEN 'queued' ELSE task.status END,
      dispatched_at = COALESCE(task.dispatched_at, p_dispatched_at),
      dispatch_lease_token = NULL,
      dispatch_lease_until = NULL,
      dispatch_error = NULL
  WHERE task.task_key = p_task_key
    AND task.status IN ('pending', 'queued', 'processing', 'completed')
    AND task.dispatch_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_pdf_document_task(
  p_task_key TEXT,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS TABLE (
  task_key TEXT,
  task_type public.document_task_type,
  internal_company_id UUID,
  public_company_id BIGINT,
  user_id TEXT,
  internal_document_id UUID,
  document_code TEXT,
  document_number INTEGER,
  document_type SMALLINT,
  document_data JSONB,
  confirmation_number TEXT,
  processing_attempt INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task public.document_tasks%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_document public.documents%ROWTYPE;
BEGIN
  IF p_lease_token IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_task_key, ''))) NOT BETWEEN 1 AND 160
     OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PDF_TASK_CLAIM_INVALID';
  END IF;

  SELECT task.*
  INTO v_task
  FROM public.document_tasks AS task
  WHERE task.task_key = pg_catalog.btrim(p_task_key)
  FOR UPDATE;
  IF NOT FOUND OR v_task.status IN ('completed', 'failed') THEN
    RETURN;
  END IF;
  IF v_task.status = 'processing'
     AND v_task.processing_lease_until > pg_catalog.clock_timestamp() THEN
    RETURN;
  END IF;
  IF v_task.status NOT IN ('pending', 'queued', 'processing') THEN
    RETURN;
  END IF;
  IF v_task.status = 'pending' AND v_task.dispatch_lease_token IS NULL THEN
    RETURN;
  END IF;

  SELECT company.*
  INTO STRICT v_company
  FROM public.companies AS company
  WHERE company.id = v_task.company_id
    AND company.status = 'active';

  IF v_task.document_id IS NOT NULL THEN
    SELECT document.*
    INTO STRICT v_document
    FROM public.documents AS document
    WHERE document.id = v_task.document_id
      AND document.company_id = v_task.company_id
      AND document.document_type = v_task.document_type
    FOR UPDATE;
    IF v_document.document_type = 305
       AND v_document.tax_authority_status <> 'approved' THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'TAX_DOCUMENT_NOT_APPROVED';
    END IF;
  ELSIF v_task.task_type = 'generate' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PDF_DOCUMENT_NOT_FOUND';
  END IF;

  IF pg_catalog.jsonb_typeof(v_task.request_payload -> 'documentData') <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PDF_TASK_PAYLOAD_INVALID';
  END IF;

  UPDATE public.document_tasks AS task
  SET status = 'processing',
      processing_started_at = pg_catalog.clock_timestamp(),
      processing_attempts = task.processing_attempts + 1,
      processing_lease_token = p_lease_token,
      processing_lease_until = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_lease_seconds),
      error = NULL
  WHERE task.id = v_task.id
  RETURNING task.* INTO v_task;

  task_key := v_task.task_key::TEXT;
  task_type := v_task.task_type;
  internal_company_id := v_task.company_id;
  public_company_id := v_company.public_company_id;
  user_id := v_task.user_id;
  internal_document_id := v_task.document_id;
  document_code := v_document.document_code;
  document_number := v_document.document_number;
  document_type := v_task.document_type;
  document_data := v_task.request_payload -> 'documentData';
  confirmation_number := v_document.confirmation_number;
  processing_attempt := v_task.processing_attempts;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.complete_pdf_document_task(
  p_task_key TEXT,
  p_lease_token UUID,
  p_company_id UUID,
  p_document_id UUID,
  p_storage_path TEXT,
  p_pdf_size INTEGER,
  p_completed_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS TABLE (
  completed BOOLEAN,
  delivery_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task public.document_tasks%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_expected_path TEXT;
  v_recipient TEXT;
BEGIN
  IF p_lease_token IS NULL
     OR p_company_id IS NULL
     OR p_pdf_size IS NULL
     OR p_pdf_size NOT BETWEEN 1 AND 52428800
     OR pg_catalog.char_length(COALESCE(p_storage_path, '')) NOT BETWEEN 1 AND 1024 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PDF_TASK_COMPLETION_INVALID';
  END IF;

  SELECT task.*
  INTO v_task
  FROM public.document_tasks AS task
  WHERE task.task_key = p_task_key
    AND task.status = 'processing'
    AND task.processing_lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PDF_TASK_LEASE_LOST';
  END IF;
  IF v_task.company_id <> p_company_id
     OR v_task.document_id IS DISTINCT FROM p_document_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PDF_TASK_CANONICAL_MISMATCH';
  END IF;

  IF v_task.task_type = 'preview' THEN
    v_expected_path := p_company_id::TEXT || '/previews/' || v_task.user_id || '/';
    IF pg_catalog.left(p_storage_path, pg_catalog.char_length(v_expected_path)) <> v_expected_path
       OR p_document_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PDF_TASK_STORAGE_PATH_INVALID';
    END IF;
  ELSE
    IF p_document_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PDF_DOCUMENT_REQUIRED';
    END IF;
    v_expected_path := p_company_id::TEXT || '/documents/' || p_document_id::TEXT || '.pdf';
    IF p_storage_path <> v_expected_path THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PDF_TASK_STORAGE_PATH_INVALID';
    END IF;

    SELECT document.*
    INTO v_document
    FROM public.documents AS document
    WHERE document.id = p_document_id
      AND document.company_id = p_company_id
      AND document.document_type = v_task.document_type
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PDF_DOCUMENT_NOT_FOUND';
    END IF;
    IF v_document.document_type = 305
       AND v_document.tax_authority_status <> 'approved' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TAX_DOCUMENT_NOT_APPROVED';
    END IF;
    IF v_document.storage_path IS NOT NULL
       AND (
         v_document.storage_path <> p_storage_path
         OR v_document.generation_status <> 'completed'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PDF_DOCUMENT_FINALIZATION_CONFLICT';
    END IF;

    UPDATE public.documents AS document
    SET storage_path = COALESCE(document.storage_path, p_storage_path),
        generation_status = 'completed',
        updated_at = p_completed_at
    WHERE document.id = v_document.id;

    v_recipient := pg_catalog.lower(pg_catalog.btrim(
      v_document.payload #>> '{client,email}'
    ));
    IF v_recipient IS NOT NULL
       AND pg_catalog.char_length(v_recipient) BETWEEN 3 AND 320
       AND v_recipient ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
      INSERT INTO private.document_email_deliveries (
        company_id, document_id, recipient_email, status,
        next_dispatch_at, created_at, updated_at
      ) VALUES (
        p_company_id, p_document_id, v_recipient, 'queued',
        p_completed_at, p_completed_at, p_completed_at
      )
      ON CONFLICT (document_id) DO NOTHING
      RETURNING id INTO delivery_id;
      IF delivery_id IS NULL THEN
        SELECT email_delivery.id
        INTO delivery_id
        FROM private.document_email_deliveries AS email_delivery
        WHERE email_delivery.document_id = p_document_id;
      END IF;
    END IF;
    PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  END IF;

  UPDATE public.document_tasks AS task
  SET status = 'completed',
      storage_path = p_storage_path,
      pdf_size = p_pdf_size,
      error = NULL,
      processing_lease_token = NULL,
      processing_lease_until = NULL,
      completed_at = p_completed_at
  WHERE task.id = v_task.id;

  completed := true;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.fail_pdf_document_task(
  p_task_key TEXT,
  p_lease_token UUID,
  p_company_id UUID,
  p_document_id UUID,
  p_error TEXT,
  p_retryable BOOLEAN,
  p_retry_after_seconds INTEGER DEFAULT 30
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task public.document_tasks%ROWTYPE;
BEGIN
  IF p_lease_token IS NULL
     OR p_company_id IS NULL
     OR p_retryable IS NULL
     OR (p_retryable AND p_retry_after_seconds NOT BETWEEN 1 AND 3600) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PDF_TASK_FAILURE_INVALID';
  END IF;
  SELECT task.*
  INTO v_task
  FROM public.document_tasks AS task
  WHERE task.task_key = p_task_key
    AND task.status = 'processing'
    AND task.processing_lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_task.company_id <> p_company_id
     OR v_task.document_id IS DISTINCT FROM p_document_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PDF_TASK_CANONICAL_MISMATCH';
  END IF;

  UPDATE public.document_tasks AS task
  SET status = (CASE WHEN p_retryable THEN 'queued' ELSE 'failed' END)::public.document_generation_status,
      processing_started_at = NULL,
      processing_lease_token = NULL,
      processing_lease_until = NULL,
      dispatched_at = CASE WHEN p_retryable THEN NULL ELSE task.dispatched_at END,
      next_dispatch_at = CASE WHEN p_retryable
        THEN pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_retry_after_seconds)
        ELSE task.next_dispatch_at
      END,
      error = pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'PDF processing failed'), 2000),
      completed_at = CASE WHEN p_retryable THEN NULL ELSE pg_catalog.clock_timestamp() END
  WHERE task.id = v_task.id;

  IF NOT p_retryable AND p_document_id IS NOT NULL THEN
    UPDATE public.documents AS document
    SET generation_status = 'failed',
        payload = COALESCE(document.payload, '{}'::JSONB)
          || pg_catalog.jsonb_build_object(
            'generationError',
            pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'PDF processing failed'), 2000)
          ),
        updated_at = pg_catalog.clock_timestamp()
    WHERE document.id = p_document_id
      AND document.company_id = p_company_id
      AND document.storage_path IS NULL
      AND document.generation_status <> 'completed';
    PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  END IF;
  RETURN true;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_api_email_dispatch_batch(
  p_lease_token UUID,
  p_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 30,
  p_delivery_id UUID DEFAULT NULL
) RETURNS TABLE (
  delivery_id UUID,
  dispatch_attempt INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_lease_token IS NULL
     OR p_limit NOT BETWEEN 1 AND 100
     OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMAIL_DISPATCH_CLAIM_INVALID';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT delivery.id
    FROM private.document_email_deliveries AS delivery
    WHERE delivery.status = 'queued'
      AND delivery.dispatched_at IS NULL
      AND delivery.next_dispatch_at <= pg_catalog.clock_timestamp()
      AND (p_delivery_id IS NULL OR delivery.id = p_delivery_id)
      AND (
        delivery.dispatch_lease_until IS NULL
        OR delivery.dispatch_lease_until <= pg_catalog.clock_timestamp()
      )
    ORDER BY delivery.next_dispatch_at, delivery.created_at, delivery.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE private.document_email_deliveries AS delivery
    SET dispatch_attempts = delivery.dispatch_attempts + 1,
        dispatch_lease_token = p_lease_token,
        dispatch_lease_until = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_lease_seconds),
        last_error = NULL,
        updated_at = pg_catalog.clock_timestamp()
    FROM candidates
    WHERE delivery.id = candidates.id
    RETURNING delivery.id, delivery.dispatch_attempts
  )
  SELECT claimed.id, claimed.dispatch_attempts FROM claimed;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.complete_api_email_dispatch(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_dispatched_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE private.document_email_deliveries AS delivery
  SET dispatched_at = CASE
        -- Pub/Sub push can reach the worker before this publisher transaction
        -- commits. Preserve a worker-scheduled retry instead of marking that
        -- already-acknowledged message as durably dispatched.
        WHEN delivery.status = 'queued'
          AND delivery.next_dispatch_at > p_dispatched_at
          THEN NULL
        ELSE COALESCE(delivery.dispatched_at, p_dispatched_at)
      END,
      dispatch_lease_token = NULL,
      dispatch_lease_until = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE delivery.id = p_delivery_id
    AND delivery.status IN ('queued', 'sending', 'sent', 'failed', 'delivery_unknown')
    AND delivery.dispatch_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.retry_api_email_dispatch(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_error TEXT,
  p_retry_after_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_retry_after_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMAIL_DISPATCH_RETRY_INVALID';
  END IF;
  UPDATE private.document_email_deliveries AS delivery
  SET next_dispatch_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_retry_after_seconds),
      dispatch_lease_token = NULL,
      dispatch_lease_until = NULL,
      last_error = pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'Email dispatch failed'), 2000),
      updated_at = pg_catalog.clock_timestamp()
  WHERE delivery.id = p_delivery_id
    AND delivery.status = 'queued'
    AND delivery.dispatched_at IS NULL
    AND delivery.dispatch_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_email_delivery(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 30
) RETURNS TABLE (
  delivery_id UUID,
  internal_company_id UUID,
  public_company_id BIGINT,
  internal_document_id UUID,
  document_code TEXT,
  document_number INTEGER,
  document_type SMALLINT,
  language TEXT,
  recipient_email TEXT,
  recipient_name TEXT,
  business_name TEXT,
  storage_path TEXT,
  send_attempt INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery private.document_email_deliveries%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_company public.companies%ROWTYPE;
BEGIN
  IF p_delivery_id IS NULL OR p_lease_token IS NULL
     OR p_lease_seconds NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMAIL_DELIVERY_CLAIM_INVALID';
  END IF;
  SELECT delivery.*
  INTO v_delivery
  FROM private.document_email_deliveries AS delivery
  WHERE delivery.id = p_delivery_id
  FOR UPDATE;
  IF NOT FOUND OR v_delivery.status IN ('sent', 'failed', 'delivery_unknown') THEN
    RETURN;
  END IF;

  IF v_delivery.status = 'sending' THEN
    IF v_delivery.send_lease_until > pg_catalog.clock_timestamp() THEN
      RETURN;
    END IF;
    UPDATE private.document_email_deliveries AS delivery
    SET status = 'delivery_unknown',
        send_lease_token = NULL,
        send_lease_until = NULL,
        last_error = 'Previous SES submission ended without a durable result',
        updated_at = pg_catalog.clock_timestamp()
    WHERE delivery.id = v_delivery.id;
    PERFORM private.bump_company_sync_version(v_delivery.company_id, 'documents_version');
    RETURN;
  END IF;
  IF v_delivery.status <> 'queued'
     OR (
       v_delivery.dispatched_at IS NULL
       AND v_delivery.dispatch_lease_token IS NULL
     ) THEN
    RETURN;
  END IF;

  SELECT document.*
  INTO v_document
  FROM public.documents AS document
  WHERE document.id = v_delivery.document_id
    AND document.company_id = v_delivery.company_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_document.generation_status <> 'completed'
     OR v_document.storage_path IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'EMAIL_DOCUMENT_NOT_READY';
  END IF;
  IF v_document.document_type = 305
     AND v_document.tax_authority_status <> 'approved' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TAX_DOCUMENT_NOT_APPROVED';
  END IF;
  SELECT company.*
  INTO STRICT v_company
  FROM public.companies AS company
  WHERE company.id = v_delivery.company_id
    AND company.status = 'active';

  UPDATE private.document_email_deliveries AS delivery
  SET status = 'sending',
      send_attempts = delivery.send_attempts + 1,
      send_lease_token = p_lease_token,
      send_lease_until = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_lease_seconds),
      last_error = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE delivery.id = v_delivery.id
  RETURNING delivery.* INTO v_delivery;

  delivery_id := v_delivery.id;
  internal_company_id := v_delivery.company_id;
  public_company_id := v_company.public_company_id;
  internal_document_id := v_document.id;
  document_code := v_document.document_code;
  document_number := v_document.document_number;
  document_type := v_document.document_type;
  language := COALESCE(NULLIF(v_document.language, ''), 'he');
  recipient_email := v_delivery.recipient_email;
  recipient_name := v_document.payload #>> '{client,name}';
  business_name := COALESCE(
    NULLIF(v_document.company_name_snapshot, ''),
    v_document.payload #>> '{company,name}',
    'Smart-Job'
  );
  storage_path := v_document.storage_path;
  send_attempt := v_delivery.send_attempts;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.complete_email_delivery(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_company_id UUID,
  p_document_id UUID,
  p_provider_message_id TEXT,
  p_sent_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_provider_message_id, ''))) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMAIL_PROVIDER_MESSAGE_ID_INVALID';
  END IF;
  UPDATE private.document_email_deliveries AS delivery
  SET status = 'sent',
      send_lease_token = NULL,
      send_lease_until = NULL,
      provider_message_id = pg_catalog.btrim(p_provider_message_id),
      last_error = NULL,
      sent_at = p_sent_at,
      updated_at = p_sent_at
  WHERE delivery.id = p_delivery_id
    AND delivery.company_id = p_company_id
    AND delivery.document_id = p_document_id
    AND delivery.status = 'sending'
    AND delivery.send_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    UPDATE public.documents AS document
    SET email_sent = true,
        updated_at = p_sent_at
    WHERE document.id = p_document_id
      AND document.company_id = p_company_id;
    PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  END IF;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.resolve_email_delivery_failure(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_company_id UUID,
  p_document_id UUID,
  p_outcome TEXT,
  p_error TEXT,
  p_retry_after_seconds INTEGER DEFAULT 30
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_outcome NOT IN ('queued', 'failed', 'delivery_unknown')
     OR (p_outcome = 'queued' AND p_retry_after_seconds NOT BETWEEN 1 AND 3600) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMAIL_DELIVERY_OUTCOME_INVALID';
  END IF;
  UPDATE private.document_email_deliveries AS delivery
  SET status = p_outcome::public.email_delivery_status,
      send_lease_token = NULL,
      send_lease_until = NULL,
      dispatched_at = CASE WHEN p_outcome = 'queued' THEN NULL ELSE delivery.dispatched_at END,
      next_dispatch_at = CASE WHEN p_outcome = 'queued'
        THEN pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_retry_after_seconds)
        ELSE delivery.next_dispatch_at
      END,
      last_error = pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'Email delivery failed'), 2000),
      updated_at = pg_catalog.clock_timestamp()
  WHERE delivery.id = p_delivery_id
    AND delivery.company_id = p_company_id
    AND delivery.document_id = p_document_id
    AND delivery.status = 'sending'
    AND delivery.send_lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  END IF;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.retry_api_document_email(
  p_company_id UUID,
  p_document_id UUID
) RETURNS TABLE (
  delivery_id UUID,
  document_id UUID,
  delivery_status public.email_delivery_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery private.document_email_deliveries%ROWTYPE;
BEGIN
  PERFORM private.require_api_document_mutation_access(p_company_id, true);
  SELECT delivery.*
  INTO v_delivery
  FROM private.document_email_deliveries AS delivery
  WHERE delivery.company_id = p_company_id
    AND delivery.document_id = p_document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'EMAIL_DELIVERY_NOT_FOUND';
  END IF;
  IF v_delivery.status NOT IN ('failed', 'delivery_unknown') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMAIL_DELIVERY_NOT_RETRYABLE';
  END IF;
  IF v_delivery.manual_retry_count >= 20 THEN
    RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'EMAIL_MANUAL_RETRY_LIMIT';
  END IF;

  UPDATE private.document_email_deliveries AS delivery
  SET status = 'queued',
      dispatch_lease_token = NULL,
      dispatch_lease_until = NULL,
      dispatched_at = NULL,
      next_dispatch_at = pg_catalog.clock_timestamp(),
      send_lease_token = NULL,
      send_lease_until = NULL,
      provider_message_id = NULL,
      last_error = NULL,
      manual_retry_count = delivery.manual_retry_count + 1,
      sent_at = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE delivery.id = v_delivery.id
  RETURNING delivery.* INTO v_delivery;

  delivery_id := v_delivery.id;
  document_id := v_delivery.document_id;
  delivery_status := v_delivery.status;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.get_api_document_email_delivery_status(
  p_company_id UUID,
  p_document_id UUID
) RETURNS public.email_delivery_status
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT delivery.status
  FROM private.document_email_deliveries AS delivery
  WHERE delivery.company_id = p_company_id
    AND delivery.document_id = p_document_id
    AND (
      private.app_is_dev()
      OR EXISTS (
        SELECT 1
        FROM public.company_memberships AS membership
        WHERE membership.company_id = p_company_id
          AND membership.user_id = private.app_auth_uid()
          AND membership.status = 'active'
          AND membership.role IN ('manager', 'user', 'basic')
      )
    )
  LIMIT 1
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION private.get_api_document_email_delivery_status(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.claim_pdf_document_task(TEXT, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.complete_pdf_document_task(TEXT, UUID, UUID, UUID, TEXT, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.fail_pdf_document_task(TEXT, UUID, UUID, UUID, TEXT, BOOLEAN, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.claim_email_delivery(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api, smart_job_pdf, smart_job_archiver;
REVOKE ALL ON FUNCTION private.complete_email_delivery(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api, smart_job_pdf, smart_job_archiver;
REVOKE ALL ON FUNCTION private.resolve_email_delivery_failure(UUID, UUID, UUID, UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api, smart_job_pdf, smart_job_archiver;
REVOKE ALL ON FUNCTION private.claim_api_email_dispatch_batch(UUID, INTEGER, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.complete_api_email_dispatch(UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.retry_api_email_dispatch(UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.retry_api_document_email(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;

GRANT EXECUTE ON FUNCTION private.claim_pdf_document_task(TEXT, UUID, INTEGER)
  TO smart_job_pdf;
GRANT EXECUTE ON FUNCTION private.complete_pdf_document_task(TEXT, UUID, UUID, UUID, TEXT, INTEGER, TIMESTAMPTZ)
  TO smart_job_pdf;
GRANT EXECUTE ON FUNCTION private.fail_pdf_document_task(TEXT, UUID, UUID, UUID, TEXT, BOOLEAN, INTEGER)
  TO smart_job_pdf;
GRANT EXECUTE ON FUNCTION private.claim_email_delivery(UUID, UUID, INTEGER)
  TO smart_job_email;
GRANT EXECUTE ON FUNCTION private.complete_email_delivery(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
  TO smart_job_email;
GRANT EXECUTE ON FUNCTION private.resolve_email_delivery_failure(UUID, UUID, UUID, UUID, TEXT, TEXT, INTEGER)
  TO smart_job_email;
GRANT EXECUTE ON FUNCTION private.claim_api_email_dispatch_batch(UUID, INTEGER, INTEGER, UUID)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.complete_api_email_dispatch(UUID, UUID, TIMESTAMPTZ)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.retry_api_email_dispatch(UUID, UUID, TEXT, INTEGER)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.retry_api_document_email(UUID, UUID)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.get_api_document_email_delivery_status(UUID, UUID)
  TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0029_authoritative_tax_workflow.sql
-- ============================================================================
-- Authoritative tax-invoice creation, durable submission claiming, and one
-- idempotent result path shared by immediate authority responses and callbacks.

ALTER TABLE private.tax_submissions
  ADD COLUMN requested_by_user_id TEXT;
--> statement-breakpoint
UPDATE private.tax_submissions AS submission
SET requested_by_user_id = reservation.reserved_by_user_id
FROM public.tax_invoice_reservations AS reservation
WHERE reservation.id = submission.reservation_id
  AND submission.requested_by_user_id IS NULL;
--> statement-breakpoint
ALTER TABLE private.tax_submissions
  ALTER COLUMN requested_by_user_id SET NOT NULL,
  ADD CONSTRAINT tax_submissions_requested_by_user_id_app_users_id_fk
    FOREIGN KEY (requested_by_user_id)
    REFERENCES public.app_users(id)
    ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE private.tax_callback_events
  DROP CONSTRAINT tax_callback_events_callback_status_check,
  ADD CONSTRAINT tax_callback_events_callback_status_check
    CHECK (callback_status IN ('submitted', 'approved', 'rejected', 'error'));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.create_api_tax_invoice(
  p_company_id UUID,
  p_document_data JSONB,
  p_created_at TIMESTAMPTZ DEFAULT clock_timestamp()
) RETURNS TABLE (
  document_id UUID,
  document_code TEXT,
  document_number INTEGER,
  tax_authority_status public.tax_authority_status,
  tax_submission_status public.tax_submission_status,
  correlation_id TEXT,
  entity_version BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID;
  v_uid TEXT := private.app_auth_uid();
  v_public_company_id BIGINT;
  v_document_id UUID := extensions.gen_random_uuid();
  v_reservation_id UUID := extensions.gen_random_uuid();
  v_submission_id UUID := extensions.gen_random_uuid();
  v_document_number INTEGER;
  v_document_code TEXT;
  v_correlation_id TEXT := extensions.gen_random_uuid()::TEXT;
  v_data JSONB;
  v_client_id UUID;
BEGIN
  IF p_created_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_INVOICE_CREATED_AT_INVALID';
  END IF;
  v_membership_id := private.require_api_document_mutation_access(p_company_id, false);
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;

  SELECT company.public_company_id
  INTO STRICT v_public_company_id
  FROM public.companies AS company
  WHERE company.id = p_company_id
    AND company.status = 'active';

  v_data := private.prepare_api_document_data(
    p_company_id,
    v_membership_id,
    p_document_data
  );
  IF (v_data ->> 'totalBeforeVat')::NUMERIC <= 0
     OR (v_data ->> 'vatAmount')::NUMERIC <= 0
     OR (v_data ->> 'totalWithVat')::NUMERIC <= 0
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_array_elements(v_data -> 'items') AS item(value)
       WHERE (item.value ->> 'quantity')::NUMERIC <= 0
          OR (item.value ->> 'price')::NUMERIC <= 0
          OR (item.value ->> 'quantity')::NUMERIC > 99999999999.999
          OR (item.value ->> 'price')::NUMERIC > 99999999999.99
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_INVOICE_AMOUNT_INVALID';
  END IF;

  v_document_number := private.allocate_company_counter(p_company_id, 'doc_305');
  v_document_code := 'TI' || v_document_number::TEXT || '-' || v_public_company_id::TEXT;
  v_data := v_data || pg_catalog.jsonb_build_object(
    'documentNumber', v_document_number,
    'documentCode', v_document_code
  );
  IF v_data #>> '{client,clientId}' IS NOT NULL THEN
    v_client_id := (v_data #>> '{client,clientId}')::UUID;
  END IF;

  INSERT INTO public.documents (
    id, company_id, document_type, document_number, document_code,
    generation_status, tax_authority_status, client_id,
    created_by_membership_id, language, document_date, notes,
    total_before_vat, vat_amount, total_with_vat,
    company_name_snapshot, company_vat_snapshot, company_address_snapshot,
    client_name_snapshot, client_phone_snapshot, client_city_snapshot,
    client_vat_snapshot, payload, created_at, updated_at
  ) VALUES (
    v_document_id, p_company_id, 305, v_document_number, v_document_code,
    'pending', 'reserved', v_client_id,
    v_membership_id, v_data ->> 'language', (v_data ->> 'date')::TIMESTAMPTZ,
    NULLIF(v_data ->> 'notes', ''),
    (v_data ->> 'totalBeforeVat')::NUMERIC(14, 2),
    (v_data ->> 'vatAmount')::NUMERIC(14, 2),
    (v_data ->> 'totalWithVat')::NUMERIC(14, 2),
    NULLIF(v_data #>> '{company,name}', ''),
    NULLIF(v_data #>> '{company,vatNumber}', ''),
    NULLIF(v_data #>> '{company,address}', ''),
    NULLIF(v_data #>> '{client,name}', ''),
    NULLIF(v_data #>> '{client,phone}', ''),
    NULLIF(v_data #>> '{client,city}', ''),
    NULLIF(v_data #>> '{client,clientVatNumber}', ''),
    v_data, p_created_at, p_created_at
  );

  INSERT INTO public.document_items (
    document_id, line_no, description, quantity, unit_price,
    line_total, source_inventory_part_id, metadata
  )
  SELECT
    v_document_id,
    item.line_no::INTEGER,
    pg_catalog.btrim(item.value ->> 'description'),
    (item.value ->> 'quantity')::NUMERIC(14, 3),
    (item.value ->> 'price')::NUMERIC(14, 2),
    pg_catalog.round(
      (item.value ->> 'quantity')::NUMERIC
        * (item.value ->> 'price')::NUMERIC,
      2
    )::NUMERIC(14, 2),
    part.id,
    CASE WHEN item.value ? 'partNo'
      THEN pg_catalog.jsonb_build_object(
        'partNo', (item.value ->> 'partNo')::INTEGER
      )
      ELSE '{}'::JSONB
    END
  FROM pg_catalog.jsonb_array_elements(v_data -> 'items')
    WITH ORDINALITY AS item(value, line_no)
  LEFT JOIN public.inventory_parts AS part
    ON part.company_id = p_company_id
   AND part.part_no = CASE WHEN item.value ? 'partNo'
     THEN (item.value ->> 'partNo')::INTEGER ELSE NULL END;

  INSERT INTO public.tax_invoice_reservations (
    id, company_id, document_id, document_number, status,
    reserved_by_user_id, client_name_snapshot, oauth_session_id,
    status_payload, created_at, updated_at
  ) VALUES (
    v_reservation_id, p_company_id, v_document_id, v_document_number,
    'reserved', v_uid, NULLIF(v_data #>> '{client,name}', ''),
    v_correlation_id,
    pg_catalog.jsonb_build_object(
      'correlationId', v_correlation_id,
      'reservedAt', p_created_at
    ),
    p_created_at, p_created_at
  );

  INSERT INTO private.tax_submissions (
    id, company_id, document_id, reservation_id, correlation_id,
    requested_by_user_id, status, request_payload, next_attempt_at,
    created_at, updated_at
  ) VALUES (
    v_submission_id, p_company_id, v_document_id, v_reservation_id,
    v_correlation_id, v_uid, 'queued',
    pg_catalog.jsonb_build_object(
      'documentId', v_document_id,
      'documentCode', v_document_code,
      'documentNumber', v_document_number,
      'documentType', 305,
      'invoice', v_data
    ),
    p_created_at, p_created_at, p_created_at
  );

  PERFORM private.bump_company_sync_version(p_company_id, 'documents_version');
  document_id := v_document_id;
  document_code := v_document_code;
  document_number := v_document_number;
  tax_authority_status := 'reserved';
  tax_submission_status := 'queued';
  correlation_id := v_correlation_id;
  entity_version := 1;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_api_tax_submission_batch(
  p_lease_token UUID,
  p_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 60,
  p_submission_id UUID DEFAULT NULL
) RETURNS TABLE (
  submission_id UUID,
  internal_company_id UUID,
  internal_document_id UUID,
  correlation_id TEXT,
  request_payload JSONB,
  submission_attempt INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expired RECORD;
BEGIN
  IF p_lease_token IS NULL
     OR p_limit NOT BETWEEN 1 AND 100
     OR p_lease_seconds NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_SUBMISSION_CLAIM_INVALID';
  END IF;

  -- Once a worker held the submission lease, expiry is ambiguous: it may have
  -- reached the authority before the worker died. Never reclaim it blindly.
  FOR v_expired IN
    UPDATE private.tax_submissions AS submission
    SET status = 'submission_unknown',
        lease_token = NULL,
        lease_until = NULL,
        last_error = 'Previous authority submission ended without a durable result',
        submitted_at = COALESCE(submission.submitted_at, pg_catalog.clock_timestamp()),
        updated_at = pg_catalog.clock_timestamp()
    WHERE submission.status = 'submitting'
      AND submission.lease_until <= pg_catalog.clock_timestamp()
    RETURNING submission.company_id, submission.document_id, submission.reservation_id
  LOOP
    UPDATE public.documents AS document
    SET tax_authority_status = CASE
          WHEN document.tax_authority_status = 'reserved' THEN 'submitted'
          ELSE document.tax_authority_status
        END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE document.id = v_expired.document_id
      AND document.company_id = v_expired.company_id;
    UPDATE public.tax_invoice_reservations AS reservation
    SET status = CASE
          WHEN reservation.status = 'reserved' THEN 'submitted'
          ELSE reservation.status
        END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE reservation.id = v_expired.reservation_id;
    PERFORM private.bump_company_sync_version(
      v_expired.company_id,
      'documents_version'
    );
  END LOOP;

  RETURN QUERY
  WITH candidates AS (
    SELECT submission.id
    FROM private.tax_submissions AS submission
    WHERE submission.status = 'queued'
      AND submission.next_attempt_at <= pg_catalog.clock_timestamp()
      AND (p_submission_id IS NULL OR submission.id = p_submission_id)
      AND submission.attempt_count < 100
    ORDER BY submission.next_attempt_at, submission.created_at, submission.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE private.tax_submissions AS submission
    SET status = 'submitting',
        attempt_count = submission.attempt_count + 1,
        lease_token = p_lease_token,
        lease_until = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_lease_seconds),
        last_error = NULL,
        updated_at = pg_catalog.clock_timestamp()
    FROM candidates
    WHERE submission.id = candidates.id
    RETURNING submission.*
  )
  SELECT
    claimed.id,
    claimed.company_id,
    claimed.document_id,
    claimed.correlation_id::TEXT,
    claimed.request_payload,
    claimed.attempt_count
  FROM claimed;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.retry_api_tax_submission(
  p_submission_id UUID,
  p_lease_token UUID,
  p_error TEXT,
  p_retry_after_seconds INTEGER DEFAULT 30
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_submission_id IS NULL OR p_lease_token IS NULL
     OR p_retry_after_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_SUBMISSION_RETRY_INVALID';
  END IF;
  UPDATE private.tax_submissions AS submission
  SET status = 'queued',
      lease_token = NULL,
      lease_until = NULL,
      next_attempt_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_retry_after_seconds),
      last_error = pg_catalog.left(
        COALESCE(NULLIF(p_error, ''), 'Tax submission pre-send failure'),
        2000
      ),
      updated_at = pg_catalog.clock_timestamp()
  WHERE submission.id = p_submission_id
    AND submission.status = 'submitting'
    AND submission.lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.mark_api_tax_submission_unknown(
  p_submission_id UUID,
  p_lease_token UUID,
  p_error TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission private.tax_submissions%ROWTYPE;
BEGIN
  SELECT submission.*
  INTO v_submission
  FROM private.tax_submissions AS submission
  WHERE submission.id = p_submission_id
    AND submission.status = 'submitting'
    AND submission.lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE private.tax_submissions AS submission
  SET status = 'submission_unknown',
      lease_token = NULL,
      lease_until = NULL,
      last_error = pg_catalog.left(
        COALESCE(NULLIF(p_error, ''), 'Tax authority result is unknown'),
        2000
      ),
      submitted_at = COALESCE(submission.submitted_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  WHERE submission.id = v_submission.id;
  UPDATE public.documents AS document
  SET tax_authority_status = CASE
        WHEN document.tax_authority_status = 'reserved' THEN 'submitted'
        ELSE document.tax_authority_status
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE document.id = v_submission.document_id
    AND document.company_id = v_submission.company_id;
  UPDATE public.tax_invoice_reservations AS reservation
  SET status = CASE
        WHEN reservation.status = 'reserved' THEN 'submitted'
        ELSE reservation.status
      END,
      status_payload = reservation.status_payload
        || pg_catalog.jsonb_build_object(
          'submissionUnknownAt', pg_catalog.clock_timestamp()
        ),
      updated_at = pg_catalog.clock_timestamp()
  WHERE reservation.id = v_submission.reservation_id;
  PERFORM private.bump_company_sync_version(
    v_submission.company_id,
    'documents_version'
  );
  RETURN true;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.process_api_tax_submission_result(
  p_correlation_id VARCHAR(128),
  p_result_key VARCHAR(128),
  p_payload_hash VARCHAR(64),
  p_result_status VARCHAR(32),
  p_confirmation_number VARCHAR(128),
  p_authority_request_id VARCHAR(256),
  p_error_code VARCHAR(128),
  p_error_message TEXT,
  p_occurred_at TIMESTAMPTZ
) RETURNS TABLE(processed BOOLEAN, idempotent_replay BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_event private.tax_callback_events%ROWTYPE;
  v_submission private.tax_submissions%ROWTYPE;
  v_reservation public.tax_invoice_reservations%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_tax_status public.tax_authority_status;
  v_reservation_status public.tax_invoice_reservation_status;
  v_submission_status public.tax_submission_status;
  v_response JSONB;
  v_task_id UUID;
  v_terminal BOOLEAN;
BEGIN
  IF pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_correlation_id, ''))) NOT BETWEEN 8 AND 128
     OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_result_key, ''))) NOT BETWEEN 8 AND 128
     OR p_payload_hash IS NULL
     OR p_payload_hash !~ '^[0-9a-f]{64}$'
     OR p_result_status NOT IN ('submitted', 'approved', 'rejected', 'error')
     OR (p_result_status = 'approved'
       AND pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_confirmation_number, ''))) NOT BETWEEN 1 AND 128)
     OR (p_confirmation_number IS NOT NULL AND pg_catalog.char_length(p_confirmation_number) > 128)
     OR (p_authority_request_id IS NOT NULL AND pg_catalog.char_length(p_authority_request_id) > 256)
     OR (p_error_code IS NOT NULL AND pg_catalog.char_length(p_error_code) > 128) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TAX_RESULT_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tax-result:' || p_result_key, 0)
  );
  SELECT event.*
  INTO v_existing_event
  FROM private.tax_callback_events AS event
  WHERE event.event_id = p_result_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_event.payload_hash = p_payload_hash THEN
      RETURN QUERY SELECT true, true;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TAX_CALLBACK_PAYLOAD_CONFLICT';
  END IF;

  SELECT submission.*
  INTO v_submission
  FROM private.tax_submissions AS submission
  WHERE submission.correlation_id = p_correlation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TAX_SUBMISSION_NOT_FOUND';
  END IF;
  SELECT reservation.*
  INTO STRICT v_reservation
  FROM public.tax_invoice_reservations AS reservation
  WHERE reservation.id = v_submission.reservation_id
  FOR UPDATE;
  SELECT document.*
  INTO STRICT v_document
  FROM public.documents AS document
  WHERE document.id = v_submission.document_id
    AND document.company_id = v_submission.company_id
    AND document.document_type = 305
  FOR UPDATE;

  v_tax_status := CASE p_result_status
    WHEN 'submitted' THEN 'submitted'::public.tax_authority_status
    WHEN 'approved' THEN 'approved'::public.tax_authority_status
    WHEN 'rejected' THEN 'rejected'::public.tax_authority_status
    WHEN 'error' THEN 'failed'::public.tax_authority_status
  END;
  v_reservation_status := CASE p_result_status
    WHEN 'submitted' THEN 'submitted'::public.tax_invoice_reservation_status
    WHEN 'approved' THEN 'approved'::public.tax_invoice_reservation_status
    WHEN 'rejected' THEN 'rejected'::public.tax_invoice_reservation_status
    WHEN 'error' THEN 'failed'::public.tax_invoice_reservation_status
  END;
  v_submission_status := CASE p_result_status
    WHEN 'submitted' THEN 'submitted'::public.tax_submission_status
    WHEN 'approved' THEN 'approved'::public.tax_submission_status
    WHEN 'rejected' THEN 'rejected'::public.tax_submission_status
    WHEN 'error' THEN 'failed'::public.tax_submission_status
  END;
  v_terminal := v_submission.status IN ('approved', 'rejected', 'failed');
  IF v_terminal AND v_submission.status <> v_submission_status THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TAX_RESULT_STATE_CONFLICT';
  END IF;
  IF v_document.tax_authority_status = 'approved'
     AND p_result_status = 'approved'
     AND v_document.confirmation_number IS DISTINCT FROM pg_catalog.btrim(p_confirmation_number) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TAX_RESULT_CONFIRMATION_CONFLICT';
  END IF;

  v_response := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'status', p_result_status,
    'resultKey', p_result_key,
    'correlationId', p_correlation_id,
    'confirmationNumber', p_confirmation_number,
    'authorityRequestId', p_authority_request_id,
    'errorCode', p_error_code,
    'errorMessage', p_error_message,
    'occurredAt', p_occurred_at,
    'processedAt', pg_catalog.clock_timestamp()
  ));

  UPDATE private.tax_submissions AS submission
  SET status = v_submission_status,
      lease_token = NULL,
      lease_until = NULL,
      authority_request_id = COALESCE(
        NULLIF(pg_catalog.btrim(p_authority_request_id), ''),
        submission.authority_request_id
      ),
      response_payload = v_response,
      last_error = CASE WHEN p_result_status = 'error'
        THEN pg_catalog.left(
          COALESCE(NULLIF(p_error_message, ''), NULLIF(p_error_code, ''), 'Tax submission failed'),
          2000
        )
        ELSE NULL
      END,
      submitted_at = COALESCE(submission.submitted_at, pg_catalog.clock_timestamp()),
      resolved_at = CASE WHEN p_result_status IN ('approved', 'rejected', 'error')
        THEN COALESCE(p_occurred_at, pg_catalog.clock_timestamp())
        ELSE NULL
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE submission.id = v_submission.id;

  UPDATE public.documents AS document
  SET tax_authority_status = v_tax_status,
      confirmation_number = CASE WHEN p_result_status = 'approved'
        THEN pg_catalog.btrim(p_confirmation_number)
        ELSE document.confirmation_number
      END,
      tax_authority_response = v_response,
      entity_version = document.entity_version + 1,
      updated_at = pg_catalog.clock_timestamp()
  WHERE document.id = v_document.id;
  UPDATE public.tax_invoice_reservations AS reservation
  SET status = v_reservation_status,
      external_confirmation_number = CASE WHEN p_result_status = 'approved'
        THEN pg_catalog.btrim(p_confirmation_number)
        ELSE reservation.external_confirmation_number
      END,
      status_payload = reservation.status_payload || v_response,
      updated_at = pg_catalog.clock_timestamp()
  WHERE reservation.id = v_reservation.id;

  IF p_result_status = 'approved' AND NOT EXISTS (
    SELECT 1
    FROM public.document_tasks AS task
    WHERE task.document_id = v_document.id
      AND task.company_id = v_document.company_id
      AND task.task_type = 'generate'
  ) THEN
    v_task_id := extensions.gen_random_uuid();
    INSERT INTO public.document_tasks (
      id, task_key, lock_key, company_id, user_id, document_id,
      task_type, document_type, status, request_payload, expire_at,
      next_dispatch_at, created_at
    ) VALUES (
      v_task_id, v_task_id::TEXT, 'document:' || v_document.id::TEXT,
      v_document.company_id, v_submission.requested_by_user_id, v_document.id,
      'generate', 305, 'pending',
      pg_catalog.jsonb_build_object(
        'taskId', v_task_id::TEXT,
        'documentType', 305,
        'documentData', v_document.payload,
        'documentId', v_document.document_code,
        'documentNumber', v_document.document_number
      ),
      pg_catalog.clock_timestamp() + interval '24 hours',
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    );
  END IF;

  INSERT INTO private.tax_callback_events (
    event_id, payload_hash, company_id, document_id, reservation_id,
    callback_status, confirmation_number, error_code, error_message,
    oauth_session_id, occurred_at
  ) VALUES (
    p_result_key, p_payload_hash, v_submission.company_id,
    v_submission.document_id, v_submission.reservation_id,
    p_result_status, NULLIF(pg_catalog.btrim(p_confirmation_number), ''),
    NULLIF(pg_catalog.btrim(p_error_code), ''), p_error_message,
    p_correlation_id, p_occurred_at
  );
  PERFORM private.bump_company_sync_version(
    v_submission.company_id,
    'documents_version'
  );
  RETURN QUERY SELECT true, false;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.process_api_tax_callback(
  p_event_id VARCHAR,
  p_payload_hash VARCHAR(64),
  p_oauth_session_id VARCHAR(128),
  p_callback_status VARCHAR(32),
  p_confirmation_number VARCHAR(128),
  p_error_code VARCHAR(128),
  p_error_message TEXT,
  p_occurred_at TIMESTAMPTZ
) RETURNS TABLE(processed BOOLEAN, idempotent_replay BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT result.processed, result.idempotent_replay
  FROM private.process_api_tax_submission_result(
    p_oauth_session_id,
    p_event_id,
    p_payload_hash,
    p_callback_status,
    p_confirmation_number,
    NULL,
    p_error_code,
    p_error_message,
    p_occurred_at
  ) AS result
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.get_api_tax_submission_status(
  p_company_id UUID,
  p_document_id UUID
) RETURNS public.tax_submission_status
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT submission.status
  FROM private.tax_submissions AS submission
  WHERE submission.company_id = p_company_id
    AND submission.document_id = p_document_id
    AND (
      private.app_is_dev()
      OR EXISTS (
        SELECT 1
        FROM public.company_memberships AS membership
        WHERE membership.company_id = p_company_id
          AND membership.user_id = private.app_auth_uid()
          AND membership.status = 'active'
          AND membership.role IN ('manager', 'user', 'basic')
      )
    )
  LIMIT 1
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION private.create_api_tax_invoice(UUID, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.claim_api_tax_submission_batch(UUID, INTEGER, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.retry_api_tax_submission(UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.mark_api_tax_submission_unknown(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.process_api_tax_submission_result(
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.get_api_tax_submission_status(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_pdf, smart_job_email, smart_job_archiver;

GRANT EXECUTE ON FUNCTION private.create_api_tax_invoice(UUID, JSONB, TIMESTAMPTZ)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.claim_api_tax_submission_batch(UUID, INTEGER, INTEGER, UUID)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.retry_api_tax_submission(UUID, UUID, TEXT, INTEGER)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.mark_api_tax_submission_unknown(UUID, UUID, TEXT)
  TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.process_api_tax_submission_result(
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, TIMESTAMPTZ
) TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.get_api_tax_submission_status(UUID, UUID)
  TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0030_post_tax_metadata_sync.sql
-- ============================================================================
-- Drizzle metadata synchronization for the requested_by_user_id column and
-- foreign key created by custom migration 0029. Runtime schema is unchanged.
SELECT 1;

-- ============================================================================
-- Consolidated source: 0031_batch5_archive_hardening.sql
-- ============================================================================
-- Batch 5: immutable, leased and resumable monthly archive segments.
--
-- `public.archive_runs` is the user-visible, durable object ledger. The
-- private lease row serializes one company/month/type writer and preserves a
-- snapshot plus segment number across retries. The archiver role receives only
-- the narrow SECURITY DEFINER functions declared below.

ALTER TABLE public.archive_runs
  ALTER COLUMN archive_key TYPE VARCHAR(64),
  ALTER COLUMN checksum TYPE VARCHAR(64);
--> statement-breakpoint

ALTER TABLE private.archive_run_leases
  ADD COLUMN period_start TIMESTAMPTZ,
  ADD COLUMN period_end TIMESTAMPTZ,
  ADD COLUMN segment INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint

UPDATE private.archive_run_leases AS lease
SET period_start = CASE
      WHEN lease.archive_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        pg_catalog.make_timestamptz(
          pg_catalog.split_part(lease.archive_key, '-', 1)::INTEGER,
          pg_catalog.split_part(lease.archive_key, '-', 2)::INTEGER,
          1, 0, 0, 0, 'UTC'
        )
      ELSE pg_catalog.date_trunc('month', lease.snapshot_at) - INTERVAL '1 month'
    END,
    period_end = CASE
      WHEN lease.archive_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        pg_catalog.make_timestamptz(
          pg_catalog.split_part(lease.archive_key, '-', 1)::INTEGER,
          pg_catalog.split_part(lease.archive_key, '-', 2)::INTEGER,
          1, 0, 0, 0, 'UTC'
        ) + INTERVAL '1 month'
      ELSE pg_catalog.date_trunc('month', lease.snapshot_at)
    END
WHERE lease.period_start IS NULL OR lease.period_end IS NULL;
--> statement-breakpoint

ALTER TABLE private.archive_run_leases
  ALTER COLUMN period_start SET NOT NULL,
  ALTER COLUMN period_end SET NOT NULL;
--> statement-breakpoint

ALTER TABLE public.archive_runs
  ADD COLUMN snapshot_at TIMESTAMPTZ,
  ADD COLUMN segment INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN delete_cursor INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN storage_generation BIGINT,
  ADD COLUMN id_manifest_path VARCHAR(1024),
  ADD COLUMN id_manifest_checksum VARCHAR(64),
  ADD COLUMN id_manifest_generation BIGINT;
--> statement-breakpoint

UPDATE public.archive_runs AS run
SET snapshot_at = COALESCE(run.completed_at, run.created_at)
WHERE run.snapshot_at IS NULL;
--> statement-breakpoint

ALTER TABLE public.archive_runs
  ALTER COLUMN snapshot_at SET NOT NULL;
--> statement-breakpoint

CREATE INDEX archive_runs_company_type_snapshot_idx
  ON public.archive_runs (company_id, data_type, snapshot_at, segment);
--> statement-breakpoint

ALTER TABLE private.archive_run_leases
  ADD CONSTRAINT archive_run_leases_period_check CHECK (
    period_end > period_start AND snapshot_at >= period_end
  ),
  ADD CONSTRAINT archive_run_leases_segment_positive_check CHECK (segment > 0);
--> statement-breakpoint

ALTER TABLE public.archive_runs
  ADD CONSTRAINT archive_runs_segment_positive_check CHECK (segment > 0),
  ADD CONSTRAINT archive_runs_counts_check CHECK (
    doc_count >= 0
    AND deleted_count >= 0
    AND delete_cursor >= 0
    AND deleted_count <= doc_count
    AND delete_cursor <= doc_count
  ),
  ADD CONSTRAINT archive_runs_storage_generation_check CHECK (
    storage_generation IS NULL OR storage_generation > 0
  ),
  ADD CONSTRAINT archive_runs_id_generation_check CHECK (
    id_manifest_generation IS NULL OR id_manifest_generation > 0
  ),
  ADD CONSTRAINT archive_runs_checksum_check CHECK (
    checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT archive_runs_id_checksum_check CHECK (
    id_manifest_checksum IS NULL OR id_manifest_checksum ~ '^[0-9a-f]{64}$'
  );
--> statement-breakpoint

DROP FUNCTION IF EXISTS private.claim_archive_run_lease(
  UUID, TEXT, TEXT, TIMESTAMPTZ, UUID, INTEGER
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.list_archiver_companies()
RETURNS TABLE (company_id UUID, public_company_id BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT company.id, company.public_company_id
  FROM public.companies AS company
  WHERE company.status = 'active'
  ORDER BY company.public_company_id ASC
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.list_archiver_candidates(
  p_cutoff_end TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 2000
) RETURNS TABLE (
  company_id UUID,
  public_company_id BIGINT,
  data_type TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_cutoff_end IS NULL
     OR p_cutoff_end <> (
       pg_catalog.date_trunc('month', p_cutoff_end AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
     )
     OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_CANDIDATE_QUERY_INVALID';
  END IF;

  RETURN QUERY
  WITH candidate_periods AS (
    SELECT
      job.company_id,
      'jobs'::TEXT AS data_type,
      pg_catalog.date_trunc('month', job.finished_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AS period_start
    FROM public.jobs AS job
    WHERE job.status = 'finished'
      AND job.finished_at IS NOT NULL
      AND job.finished_at < p_cutoff_end
    GROUP BY job.company_id,
      pg_catalog.date_trunc('month', job.finished_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'

    UNION ALL

    SELECT
      document.company_id,
      'documents'::TEXT AS data_type,
      pg_catalog.date_trunc('month', document.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AS period_start
    FROM public.documents AS document
    WHERE document.created_at < p_cutoff_end
      AND document.generation_status = 'completed'
      AND (document.document_type <> 305 OR document.tax_authority_status = 'approved')
    GROUP BY document.company_id,
      pg_catalog.date_trunc('month', document.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  )
  SELECT
    company.id,
    company.public_company_id,
    candidate.data_type,
    candidate.period_start,
    candidate.period_start + INTERVAL '1 month'
  FROM candidate_periods AS candidate
  INNER JOIN public.companies AS company
    ON company.id = candidate.company_id
   AND company.status = 'active'
  ORDER BY
    candidate.period_start ASC,
    company.public_company_id ASC,
    CASE WHEN candidate.data_type = 'documents' THEN 0 ELSE 1 END ASC
  LIMIT p_limit;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.claim_archive_run_lease(
  p_company_id UUID,
  p_archive_key TEXT,
  p_data_type TEXT,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ,
  p_snapshot_at TIMESTAMPTZ,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 3600
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
  v_run public.archive_runs%ROWTYPE;
  v_full_key TEXT;
  v_claimed BOOLEAN := false;
BEGIN
  IF p_company_id IS NULL
     OR p_lease_token IS NULL
     OR p_archive_key IS NULL
     OR p_archive_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     OR p_data_type IS NULL
     OR p_data_type NOT IN ('jobs', 'documents')
     OR p_period_start IS NULL
     OR p_period_end IS NULL
     OR p_period_end <> p_period_start + INTERVAL '1 month'
     OR p_snapshot_at IS NULL
     OR p_snapshot_at < p_period_end
     OR p_lease_seconds IS NULL
     OR p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_LEASE_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.companies AS company
    WHERE company.id = p_company_id AND company.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ARCHIVE_COMPANY_NOT_FOUND';
  END IF;

  -- The transaction-scoped advisory lock prevents two schedulers from both
  -- allocating a segment before either lease row is visible.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::TEXT || ':' || p_archive_key || ':' || p_data_type,
      0
    )
  );

  INSERT INTO private.archive_run_leases (
    company_id, archive_key, data_type, status, period_start, period_end,
    snapshot_at, segment
  ) VALUES (
    p_company_id, p_archive_key, p_data_type, 'pending', p_period_start,
    p_period_end, p_snapshot_at, 1
  )
  ON CONFLICT (company_id, archive_key, data_type) DO NOTHING;

  SELECT lease.*
  INTO STRICT v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.company_id = p_company_id
    AND lease.archive_key = p_archive_key
    AND lease.data_type = p_data_type
  FOR UPDATE;

  IF v_lease.period_start <> p_period_start OR v_lease.period_end <> p_period_end THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_PERIOD_CONFLICT';
  END IF;

  IF v_lease.status = 'leased'
     AND v_lease.lease_until > pg_catalog.clock_timestamp() THEN
    v_claimed := false;
  ELSE
    IF v_lease.attempt_count >= 100 THEN
      RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'ARCHIVE_ATTEMPTS_EXHAUSTED';
    END IF;
    UPDATE private.archive_run_leases AS lease
    SET status = 'leased',
        snapshot_at = CASE
          WHEN lease.status IN ('pending', 'completed') THEN p_snapshot_at
          ELSE lease.snapshot_at
        END,
        segment = CASE
          WHEN lease.status = 'completed' THEN lease.segment + 1
          ELSE lease.segment
        END,
        lease_token = p_lease_token,
        lease_until = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_lease_seconds),
        attempt_count = lease.attempt_count + 1,
        last_error = NULL,
        updated_at = pg_catalog.clock_timestamp()
    WHERE lease.id = v_lease.id
    RETURNING lease.* INTO STRICT v_lease;
    v_claimed := true;
  END IF;

  v_full_key := pg_catalog.format(
    '%s-%s-s%s',
    v_lease.archive_key,
    CASE WHEN v_lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
    pg_catalog.lpad(v_lease.segment::TEXT, 6, '0')
  );

  SELECT run.*
  INTO v_run
  FROM public.archive_runs AS run
  WHERE run.company_id = v_lease.company_id
    AND run.archive_key = v_full_key
    AND run.data_type = v_lease.data_type;

  IF v_claimed AND v_run.id IS NOT NULL AND v_run.status = 'failed' THEN
    UPDATE public.archive_runs AS run
    SET status = 'uploaded_not_deleted'
    WHERE run.id = v_run.id
    RETURNING run.* INTO STRICT v_run;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'leaseId', v_lease.id,
    'claimed', v_claimed,
    'attemptCount', v_lease.attempt_count,
    'periodStart', v_lease.period_start,
    'periodEnd', v_lease.period_end,
    'snapshotAt', v_lease.snapshot_at,
    'leaseUntil', v_lease.lease_until,
    'segment', v_lease.segment,
    'archiveKey', v_full_key,
    'runId', v_run.id,
    'runStatus', v_run.status,
    'docCount', COALESCE(v_run.doc_count, 0),
    'deleteCursor', COALESCE(v_run.delete_cursor, 0),
    'storagePath', v_run.storage_path,
    'checksum', v_run.checksum,
    'storageGeneration', v_run.storage_generation::TEXT,
    'idManifestPath', v_run.id_manifest_path,
    'idManifestChecksum', v_run.id_manifest_checksum,
    'idManifestGeneration', v_run.id_manifest_generation::TEXT
  );
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.renew_archive_run_lease(
  p_lease_id UUID,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 3600
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_until TIMESTAMPTZ;
BEGIN
  IF p_lease_id IS NULL OR p_lease_token IS NULL
     OR p_lease_seconds IS NULL
     OR p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_LEASE_RENEW_INVALID';
  END IF;
  UPDATE private.archive_run_leases AS lease
  SET lease_until = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = pg_catalog.clock_timestamp()
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
  RETURNING lease.lease_until INTO v_until;
  IF v_until IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;
  RETURN v_until;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.read_archiver_jobs_page(
  p_lease_id UUID,
  p_lease_token UUID,
  p_after_finished_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 500
) RETURNS TABLE (source_id UUID, cursor_at TIMESTAMPTZ, record JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
BEGIN
  IF p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 500
     OR ((p_after_finished_at IS NULL) <> (p_after_id IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_PAGE_INVALID';
  END IF;
  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.data_type = 'jobs'
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
    AND lease.lease_until > pg_catalog.clock_timestamp();
  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;

  RETURN QUERY
  SELECT
    job.id,
    job.finished_at,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'id', job.job_no::TEXT,
      'title', COALESCE(job.title, ''),
      'description', COALESCE(job.description, ''),
      'notes', job.notes,
      'location', job.location,
      'address', job.address,
      'category', job.category,
      'priority', job.priority,
      'dueDate', job.due_at,
      'status', job.status,
      'clientId', client.client_no,
      'client', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'name', COALESCE(job.client_name_snapshot, client.name),
        'phone', COALESCE(job.client_phone_snapshot, client.phone)
      )),
      'assignee', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'memberNo', assignee.member_no,
        'name', COALESCE(assignee.display_name, assignee_user.display_name, assignee_user.email, job.assigned_member_name_snapshot)
      )),
      'creator', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'memberNo', creator.member_no,
        'name', COALESCE(creator.display_name, creator_user.display_name, creator_user.email, job.created_by_name_snapshot)
      )),
      'createdAt', job.created_at,
      'updatedAt', job.updated_at,
      'finishedAt', job.finished_at,
      'isCertificate', job.is_cert,
      'meta', job.meta,
      'attachments', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'attachmentId', attachment.id,
            'kind', attachment.kind,
            'storagePath', attachment.storage_path,
            'createdAt', attachment.created_at
          ) ORDER BY attachment.created_at, attachment.id
        )
        FROM public.job_attachments AS attachment
        WHERE attachment.job_id = job.id
      ), '[]'::JSONB),
      'partsUsed', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'partNo', part.part_no,
            'name', usage.part_name_snapshot,
            'quantity', usage.quantity
          )) ORDER BY usage.created_at, usage.id
        )
        FROM public.job_part_usages AS usage
        LEFT JOIN public.inventory_parts AS part ON part.id = usage.inventory_part_id
        WHERE usage.job_id = job.id
      ), '[]'::JSONB)
    ))
  FROM public.jobs AS job
  LEFT JOIN public.clients AS client
    ON client.id = job.client_id AND client.company_id = job.company_id
  LEFT JOIN public.company_memberships AS assignee
    ON assignee.id = job.assigned_membership_id AND assignee.company_id = job.company_id
  LEFT JOIN public.app_users AS assignee_user ON assignee_user.id = assignee.user_id
  LEFT JOIN public.company_memberships AS creator
    ON creator.id = job.created_by_membership_id AND creator.company_id = job.company_id
  LEFT JOIN public.app_users AS creator_user ON creator_user.id = creator.user_id
  WHERE job.company_id = v_lease.company_id
    AND job.status = 'finished'
    AND job.finished_at >= v_lease.period_start
    AND job.finished_at < v_lease.period_end
    AND job.updated_at <= v_lease.snapshot_at
    AND NOT EXISTS (
      SELECT 1 FROM public.document_job_links AS link WHERE link.job_id = job.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM private.file_upload_sessions AS upload WHERE upload.target_job_id = job.id
    )
    AND (
      p_after_finished_at IS NULL
      OR (job.finished_at, job.id) > (p_after_finished_at, p_after_id)
    )
  ORDER BY job.finished_at ASC, job.id ASC
  LIMIT p_limit;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.read_archiver_documents_page(
  p_lease_id UUID,
  p_lease_token UUID,
  p_after_created_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 500
) RETURNS TABLE (source_id UUID, cursor_at TIMESTAMPTZ, record JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
BEGIN
  IF p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 500
     OR ((p_after_created_at IS NULL) <> (p_after_id IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_PAGE_INVALID';
  END IF;
  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.data_type = 'documents'
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
    AND lease.lease_until > pg_catalog.clock_timestamp();
  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;

  RETURN QUERY
  SELECT
    document.id,
    document.created_at,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'id', document.document_code,
      'documentId', document.document_code,
      'documentType', document.document_type,
      'documentNumber', document.document_number,
      'generationStatus', document.generation_status,
      'taxAuthorityStatus', document.tax_authority_status,
      'client', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'name', document.client_name_snapshot,
        'phone', document.client_phone_snapshot,
        'city', document.client_city_snapshot,
        'vatNumber', document.client_vat_snapshot
      )),
      'creator', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'memberNo', creator.member_no,
        'name', COALESCE(creator.display_name, creator_user.display_name, creator_user.email)
      )),
      'language', document.language,
      'date', document.document_date,
      'notes', document.notes,
      'totalBeforeVat', document.total_before_vat,
      'vatAmount', document.vat_amount,
      'totalWithVat', document.total_with_vat,
      'confirmationNumber', document.confirmation_number,
      'taxAuthorityResponseData', document.tax_authority_response,
      'emailSent', document.email_sent,
      'storagePath', document.storage_path,
      'documentData', document.payload,
      'createdAt', document.created_at,
      'updatedAt', document.updated_at,
      'items', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'lineNo', item.line_no,
            'description', item.description,
            'quantity', item.quantity,
            'unitPrice', item.unit_price,
            'lineTotal', item.line_total,
            'metadata', item.metadata
          ) ORDER BY item.line_no
        )
        FROM public.document_items AS item
        WHERE item.document_id = document.id
      ), '[]'::JSONB),
      'jobsData', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('jobId', linked_job.job_no::TEXT)
          ORDER BY linked_job.job_no
        )
        FROM public.document_job_links AS link
        INNER JOIN public.jobs AS linked_job ON linked_job.id = link.job_id
        WHERE link.document_id = document.id
      ), '[]'::JSONB)
    ))
  FROM public.documents AS document
  LEFT JOIN public.company_memberships AS creator
    ON creator.id = document.created_by_membership_id
   AND creator.company_id = document.company_id
  LEFT JOIN public.app_users AS creator_user ON creator_user.id = creator.user_id
  WHERE document.company_id = v_lease.company_id
    AND document.created_at >= v_lease.period_start
    AND document.created_at < v_lease.period_end
    AND document.updated_at <= v_lease.snapshot_at
    AND document.generation_status = 'completed'
    AND (document.document_type <> 305 OR document.tax_authority_status = 'approved')
    AND NOT EXISTS (
      SELECT 1
      FROM public.document_tasks AS task
      WHERE task.document_id = document.id AND task.status <> 'completed'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM private.document_email_deliveries AS delivery
      WHERE delivery.document_id = document.id AND delivery.status <> 'sent'
    )
    AND (
      p_after_created_at IS NULL
      OR (document.created_at, document.id) > (p_after_created_at, p_after_id)
    )
  ORDER BY document.created_at ASC, document.id ASC
  LIMIT p_limit;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.record_archiver_uploaded_run(
  p_lease_id UUID,
  p_lease_token UUID,
  p_doc_count INTEGER,
  p_storage_path TEXT,
  p_checksum TEXT,
  p_storage_generation BIGINT,
  p_id_manifest_path TEXT,
  p_id_manifest_checksum TEXT,
  p_id_manifest_generation BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
  v_run public.archive_runs%ROWTYPE;
  v_public_company_id BIGINT;
  v_full_key TEXT;
  v_expected_storage_path TEXT;
  v_expected_id_path TEXT;
BEGIN
  IF p_lease_id IS NULL
     OR p_lease_token IS NULL
     OR p_doc_count IS NULL
     OR p_doc_count NOT BETWEEN 1 AND 1000000
     OR p_storage_path IS NULL
     OR p_checksum IS NULL
     OR p_checksum !~ '^[0-9a-f]{64}$'
     OR p_storage_generation IS NULL
     OR p_id_manifest_path IS NULL
     OR p_id_manifest_checksum IS NULL
     OR p_id_manifest_checksum !~ '^[0-9a-f]{64}$'
     OR p_id_manifest_generation IS NULL
     OR p_storage_generation <= 0
     OR p_id_manifest_generation <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_UPLOAD_INVALID';
  END IF;
  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
    AND lease.lease_until > pg_catalog.clock_timestamp()
  FOR UPDATE OF lease;
  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;
  SELECT company.public_company_id
  INTO STRICT v_public_company_id
  FROM public.companies AS company
  WHERE company.id = v_lease.company_id;

  v_full_key := pg_catalog.format(
    '%s-%s-s%s',
    v_lease.archive_key,
    CASE WHEN v_lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
    pg_catalog.lpad(v_lease.segment::TEXT, 6, '0')
  );
  v_expected_storage_path := pg_catalog.format(
    'companies/%s/archives/%s.json', v_public_company_id, v_full_key
  );
  v_expected_id_path := pg_catalog.format(
    'companies/%s/archives/%s.ids.json', v_public_company_id, v_full_key
  );
  IF p_storage_path <> v_expected_storage_path OR p_id_manifest_path <> v_expected_id_path THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_OBJECT_PATH_INVALID';
  END IF;

  INSERT INTO public.archive_runs (
    company_id, archive_key, data_type, status, snapshot_at, segment,
    doc_count, deleted_count, delete_cursor, storage_path, checksum,
    storage_generation, id_manifest_path, id_manifest_checksum,
    id_manifest_generation, created_at, completed_at
  ) VALUES (
    v_lease.company_id, v_full_key, v_lease.data_type,
    'uploaded_not_deleted', v_lease.snapshot_at, v_lease.segment,
    p_doc_count, 0, 0, p_storage_path, p_checksum,
    p_storage_generation, p_id_manifest_path, p_id_manifest_checksum,
    p_id_manifest_generation, pg_catalog.clock_timestamp(), NULL
  )
  ON CONFLICT (company_id, archive_key, data_type) DO UPDATE
  SET status = 'uploaded_not_deleted'
  WHERE public.archive_runs.doc_count = EXCLUDED.doc_count
    AND public.archive_runs.storage_path = EXCLUDED.storage_path
    AND public.archive_runs.checksum = EXCLUDED.checksum
    AND public.archive_runs.storage_generation = EXCLUDED.storage_generation
    AND public.archive_runs.id_manifest_path = EXCLUDED.id_manifest_path
    AND public.archive_runs.id_manifest_checksum = EXCLUDED.id_manifest_checksum
    AND public.archive_runs.id_manifest_generation = EXCLUDED.id_manifest_generation
  RETURNING public.archive_runs.* INTO v_run;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'ARCHIVE_UPLOAD_CONFLICT';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'runId', v_run.id,
    'docCount', v_run.doc_count,
    'deleteCursor', v_run.delete_cursor,
    'status', v_run.status
  );
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.delete_archiver_records_chunk(
  p_lease_id UUID,
  p_lease_token UUID,
  p_expected_cursor INTEGER,
  p_source_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
  v_run public.archive_runs%ROWTYPE;
  v_count INTEGER;
  v_unique_count INTEGER;
  v_remaining INTEGER;
BEGIN
  v_count := COALESCE(pg_catalog.array_length(p_source_ids, 1), 0);
  SELECT COUNT(DISTINCT source_id)::INTEGER
  INTO v_unique_count
  FROM pg_catalog.unnest(COALESCE(p_source_ids, ARRAY[]::UUID[])) AS source(source_id);
  IF p_lease_id IS NULL
     OR p_lease_token IS NULL
     OR p_expected_cursor IS NULL
     OR p_expected_cursor < 0
     OR v_count NOT BETWEEN 1 AND 500
     OR v_unique_count <> v_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_DELETE_CHUNK_INVALID';
  END IF;

  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
    AND lease.lease_until > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;

  SELECT run.*
  INTO v_run
  FROM public.archive_runs AS run
  WHERE run.company_id = v_lease.company_id
    AND run.archive_key = pg_catalog.format(
      '%s-%s-s%s',
      v_lease.archive_key,
      CASE WHEN v_lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
      pg_catalog.lpad(v_lease.segment::TEXT, 6, '0')
    )
    AND run.data_type = v_lease.data_type
  FOR UPDATE;
  IF v_run.id IS NULL OR v_run.status NOT IN ('uploaded_not_deleted', 'failed') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_RUN_NOT_DELETABLE';
  END IF;
  IF v_run.delete_cursor > p_expected_cursor THEN
    RETURN pg_catalog.jsonb_build_object(
      'runId', v_run.id,
      'deleteCursor', v_run.delete_cursor,
      'processedCount', 0,
      'replayed', true
    );
  END IF;
  IF v_run.delete_cursor <> p_expected_cursor
     OR p_expected_cursor + v_count > v_run.doc_count THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ARCHIVE_DELETE_CURSOR_CONFLICT';
  END IF;

  IF v_lease.data_type = 'jobs' THEN
    DELETE FROM public.jobs AS job
    WHERE job.company_id = v_lease.company_id
      AND job.id = ANY(p_source_ids)
      AND job.status = 'finished'
      AND job.finished_at >= v_lease.period_start
      AND job.finished_at < v_lease.period_end
      AND job.updated_at <= v_lease.snapshot_at
      AND NOT EXISTS (
        SELECT 1 FROM public.document_job_links AS link WHERE link.job_id = job.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM private.file_upload_sessions AS upload WHERE upload.target_job_id = job.id
      );
    SELECT COUNT(*)::INTEGER INTO v_remaining
    FROM public.jobs AS job
    WHERE job.company_id = v_lease.company_id AND job.id = ANY(p_source_ids);
  ELSE
    DELETE FROM public.documents AS document
    WHERE document.company_id = v_lease.company_id
      AND document.id = ANY(p_source_ids)
      AND document.created_at >= v_lease.period_start
      AND document.created_at < v_lease.period_end
      AND document.generation_status = 'completed'
      AND (document.document_type <> 305 OR document.tax_authority_status = 'approved')
      AND document.updated_at <= v_lease.snapshot_at
      AND NOT EXISTS (
        SELECT 1 FROM public.document_tasks AS task
        WHERE task.document_id = document.id AND task.status <> 'completed'
      )
      AND NOT EXISTS (
        SELECT 1 FROM private.document_email_deliveries AS delivery
        WHERE delivery.document_id = document.id AND delivery.status <> 'sent'
      );
    SELECT COUNT(*)::INTEGER INTO v_remaining
    FROM public.documents AS document
    WHERE document.company_id = v_lease.company_id AND document.id = ANY(p_source_ids);
  END IF;
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ARCHIVE_SOURCE_CHANGED';
  END IF;

  UPDATE public.archive_runs AS run
  SET delete_cursor = run.delete_cursor + v_count,
      deleted_count = run.delete_cursor + v_count,
      status = 'uploaded_not_deleted'
  WHERE run.id = v_run.id
  RETURNING run.* INTO STRICT v_run;

  RETURN pg_catalog.jsonb_build_object(
    'runId', v_run.id,
    'deleteCursor', v_run.delete_cursor,
    'processedCount', v_count,
    'replayed', false
  );
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.complete_archiver_run(
  p_lease_id UUID,
  p_lease_token UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
  v_run public.archive_runs%ROWTYPE;
BEGIN
  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
    AND lease.lease_until > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;
  SELECT run.*
  INTO v_run
  FROM public.archive_runs AS run
  WHERE run.company_id = v_lease.company_id
    AND run.archive_key = pg_catalog.format(
      '%s-%s-s%s',
      v_lease.archive_key,
      CASE WHEN v_lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
      pg_catalog.lpad(v_lease.segment::TEXT, 6, '0')
    )
    AND run.data_type = v_lease.data_type
  FOR UPDATE;
  IF v_run.id IS NULL
     OR v_run.doc_count < 1
     OR v_run.delete_cursor <> v_run.doc_count
     OR v_run.deleted_count <> v_run.doc_count
     OR v_run.storage_path IS NULL
     OR v_run.storage_generation IS NULL
     OR v_run.id_manifest_path IS NULL
     OR v_run.id_manifest_generation IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_RUN_INCOMPLETE';
  END IF;

  UPDATE public.archive_runs AS run
  SET status = 'deleted', completed_at = pg_catalog.clock_timestamp()
  WHERE run.id = v_run.id;
  UPDATE private.archive_run_leases AS lease
  SET status = 'completed', lease_token = NULL, lease_until = NULL,
      last_error = NULL, updated_at = pg_catalog.clock_timestamp()
  WHERE lease.id = v_lease.id;
  RETURN true;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.release_empty_archive_run_lease(
  p_lease_id UUID,
  p_lease_token UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM private.archive_run_leases AS lease
    INNER JOIN public.archive_runs AS run
      ON run.company_id = lease.company_id
     AND run.archive_key = pg_catalog.format(
       '%s-%s-s%s',
       lease.archive_key,
       CASE WHEN lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
       pg_catalog.lpad(lease.segment::TEXT, 6, '0')
     )
     AND run.data_type = lease.data_type
    WHERE lease.id = p_lease_id
      AND lease.lease_token = p_lease_token
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_RUN_ALREADY_RECORDED';
  END IF;
  UPDATE private.archive_run_leases AS lease
  SET status = 'pending', lease_token = NULL, lease_until = NULL,
      last_error = NULL, updated_at = pg_catalog.clock_timestamp()
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.finish_archive_run_lease(
  p_lease_id UUID,
  p_lease_token UUID,
  p_succeeded BOOLEAN,
  p_error TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
BEGIN
  IF p_lease_id IS NULL OR p_lease_token IS NULL OR p_succeeded IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_LEASE_RESULT_INVALID';
  END IF;
  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
  FOR UPDATE;
  IF v_lease.id IS NULL THEN
    RETURN false;
  END IF;
  IF p_succeeded THEN
    RETURN private.complete_archiver_run(p_lease_id, p_lease_token);
  END IF;
  UPDATE public.archive_runs AS run
  SET status = 'failed'
  WHERE run.company_id = v_lease.company_id
    AND run.archive_key = pg_catalog.format(
      '%s-%s-s%s',
      v_lease.archive_key,
      CASE WHEN v_lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
      pg_catalog.lpad(v_lease.segment::TEXT, 6, '0')
    )
    AND run.data_type = v_lease.data_type
    AND run.status = 'uploaded_not_deleted';
  UPDATE private.archive_run_leases AS lease
  SET status = 'failed', lease_token = NULL, lease_until = NULL,
      last_error = pg_catalog.left(COALESCE(NULLIF(p_error, ''), 'Archive run failed'), 2000),
      updated_at = pg_catalog.clock_timestamp()
  WHERE lease.id = v_lease.id;
  RETURN true;
END;
$$;
--> statement-breakpoint

-- New private objects remain unreachable through PostgREST/client roles. The
-- runtime worker has no direct source-table or archive-table write grants.
REVOKE ALL ON FUNCTION private.list_archiver_companies()
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.list_archiver_candidates(TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.claim_archive_run_lease(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INTEGER
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.renew_archive_run_lease(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.read_archiver_jobs_page(
  UUID, UUID, TIMESTAMPTZ, UUID, INTEGER
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.read_archiver_documents_page(
  UUID, UUID, TIMESTAMPTZ, UUID, INTEGER
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.record_archiver_uploaded_run(
  UUID, UUID, INTEGER, TEXT, TEXT, BIGINT, TEXT, TEXT, BIGINT
) FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.delete_archiver_records_chunk(UUID, UUID, INTEGER, UUID[])
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.complete_archiver_run(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.release_empty_archive_run_lease(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
REVOKE ALL ON FUNCTION private.finish_archive_run_lease(UUID, UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
    smart_job_pdf, smart_job_email;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.list_archiver_companies()
  TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.list_archiver_candidates(TIMESTAMPTZ, INTEGER)
  TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.claim_archive_run_lease(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INTEGER
) TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.renew_archive_run_lease(UUID, UUID, INTEGER)
  TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.read_archiver_jobs_page(
  UUID, UUID, TIMESTAMPTZ, UUID, INTEGER
) TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.read_archiver_documents_page(
  UUID, UUID, TIMESTAMPTZ, UUID, INTEGER
) TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.record_archiver_uploaded_run(
  UUID, UUID, INTEGER, TEXT, TEXT, BIGINT, TEXT, TEXT, BIGINT
) TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.delete_archiver_records_chunk(UUID, UUID, INTEGER, UUID[])
  TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.complete_archiver_run(UUID, UUID)
  TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.release_empty_archive_run_lease(UUID, UUID)
  TO smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.finish_archive_run_lease(UUID, UUID, BOOLEAN, TEXT)
  TO smart_job_archiver;
--> statement-breakpoint

REVOKE ALL ON TABLE private.archive_run_leases, public.archive_runs,
  public.jobs, public.documents
FROM smart_job_archiver;

-- ============================================================================
-- Consolidated source: 0032_batch5_readiness_search.sql
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS extensions;--> statement-breakpoint

DO $$
DECLARE
  v_extension_schema NAME;
BEGIN
  SELECT namespace.nspname
    INTO v_extension_schema
  FROM pg_catalog.pg_extension extension
  INNER JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pg_trgm';

  IF v_extension_schema IS NULL THEN
    CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
  ELSIF v_extension_schema <> 'extensions' THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END;
$$;--> statement-breakpoint

ALTER TABLE public.documents ADD COLUMN search_text text GENERATED ALWAYS AS (
  pg_catalog.lower(
    document_code || ' ' ||
    COALESCE(client_name_snapshot, '') || ' ' ||
    COALESCE(client_phone_snapshot, '') || ' ' ||
    COALESCE(client_city_snapshot, '') || ' ' ||
    COALESCE(client_vat_snapshot, '')
  )
) STORED;--> statement-breakpoint

ALTER TABLE public.inventory_parts ADD COLUMN normalized_name text
  GENERATED ALWAYS AS (pg_catalog.lower(name)) STORED;--> statement-breakpoint

ALTER TABLE public.jobs ADD COLUMN search_text text GENERATED ALWAYS AS (
  pg_catalog.lower(
    COALESCE(title, '') || ' ' ||
    COALESCE(description, '') || ' ' ||
    COALESCE(location, '') || ' ' ||
    COALESCE(address, '') || ' ' ||
    COALESCE(client_name_snapshot, '') || ' ' ||
    COALESCE(client_phone_snapshot, '') || ' ' ||
    COALESCE(assigned_member_name_snapshot, '') || ' ' ||
    COALESCE(created_by_name_snapshot, '')
  )
) STORED;--> statement-breakpoint

CREATE INDEX documents_search_text_trgm_idx
  ON public.documents USING gin (search_text extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX inventory_parts_normalized_name_trgm_idx
  ON public.inventory_parts USING gin (normalized_name extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX jobs_search_text_trgm_idx
  ON public.jobs USING gin (search_text extensions.gin_trgm_ops);--> statement-breakpoint

CREATE TABLE private.api_schema_metadata (
  component TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT api_schema_metadata_component_nonempty_check
    CHECK (pg_catalog.btrim(component) <> ''),
  CONSTRAINT api_schema_metadata_version_nonempty_check
    CHECK (pg_catalog.btrim(schema_version) <> '')
);--> statement-breakpoint

INSERT INTO private.api_schema_metadata (component, schema_version)
VALUES ('cloudrun-api', 'batch5-2026-07-21')
ON CONFLICT (component) DO UPDATE
SET schema_version = EXCLUDED.schema_version,
    applied_at = pg_catalog.clock_timestamp();--> statement-breakpoint

REVOKE ALL ON TABLE private.api_schema_metadata
  FROM PUBLIC, anon, authenticated, service_role, smart_job_api,
       smart_job_pdf, smart_job_email, smart_job_archiver;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.check_api_readiness(
  p_expected_schema_version TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COALESCE((
      SELECT metadata.schema_version = p_expected_schema_version
      FROM private.api_schema_metadata metadata
      WHERE metadata.component = 'cloudrun-api'
    ), false)
    AND pg_catalog.to_regclass('public.jobs_search_text_trgm_idx') IS NOT NULL
    AND pg_catalog.to_regclass('public.documents_search_text_trgm_idx') IS NOT NULL
    AND pg_catalog.to_regclass('public.inventory_parts_normalized_name_trgm_idx') IS NOT NULL
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.set_api_request_context(uuid,integer,integer,integer)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.create_api_job_with_details(uuid,public.job_status,text,text,text,text,integer,jsonb,jsonb,uuid,timestamp with time zone)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.list_api_company_archives(uuid,character varying,integer,timestamp with time zone,uuid)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.create_api_tax_invoice(uuid,jsonb,timestamp with time zone)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.create_api_contact_request(text,text,text,text,text)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.jobs', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.jobs', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.jobs', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.documents', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.documents', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.documents', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.inventory_parts', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.inventory_parts', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.inventory_parts', 'DELETE');
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.check_api_readiness(TEXT)
  FROM PUBLIC, anon, authenticated, service_role,
       smart_job_pdf, smart_job_email, smart_job_archiver;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.check_api_readiness(TEXT) TO smart_job_api;

-- ============================================================================
-- Consolidated source: 0033_archive_period_authority.sql
-- ============================================================================
-- Authoritative archive periods and narrow API retrieval functions.
--
-- This is the expand side of the archive retrieval change. Existing API
-- revisions retain their RLS-protected SELECT grant until the new exact-run
-- RPC has completed its rollout; the grant is removed in the later contract
-- migration after deployment evidence confirms no old revision remains.

ALTER TABLE public.archive_runs
  ADD COLUMN period_start TIMESTAMPTZ,
  ADD COLUMN period_end TIMESTAMPTZ;
--> statement-breakpoint

DO $$
DECLARE
  v_unknown_count BIGINT;
  v_conflict_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO v_unknown_count
  FROM public.archive_runs AS run
  WHERE NOT CASE
    WHEN run.archive_key ~ '^[0-9]{4}-(0?[1-9]|1[0-2])-[jd]$' THEN
      (run.data_type = 'jobs' AND run.archive_key ~ '-j$')
      OR (run.data_type = 'documents' AND run.archive_key ~ '-d$')
    WHEN run.archive_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[jd]-s[0-9]{6}$' THEN
      (
        (run.data_type = 'jobs' AND run.archive_key ~ '-j-s[0-9]{6}$')
        OR (run.data_type = 'documents' AND run.archive_key ~ '-d-s[0-9]{6}$')
      )
      AND pg_catalog.split_part(run.archive_key, '-s', 2)::INTEGER > 0
    ELSE false
  END;
  IF v_unknown_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ARCHIVE_PERIOD_BACKFILL_UNKNOWN_KEY',
      DETAIL = pg_catalog.format('%s archive run(s) have an unmappable key', v_unknown_count);
  END IF;

  UPDATE public.archive_runs AS run
  SET period_start = pg_catalog.make_timestamptz(
        pg_catalog.split_part(run.archive_key, '-', 1)::INTEGER,
        pg_catalog.split_part(run.archive_key, '-', 2)::INTEGER,
        1, 0, 0, 0, 'UTC'
      ),
      period_end = pg_catalog.make_timestamptz(
        pg_catalog.split_part(run.archive_key, '-', 1)::INTEGER,
        pg_catalog.split_part(run.archive_key, '-', 2)::INTEGER,
        1, 0, 0, 0, 'UTC'
      ) + INTERVAL '1 month',
      segment = CASE
        WHEN run.archive_key ~ '-s[0-9]{6}$'
          THEN pg_catalog.split_part(run.archive_key, '-s', 2)::INTEGER
        ELSE 1
      END;

  SELECT COUNT(*)
  INTO v_conflict_count
  FROM (
    SELECT run.company_id, run.data_type, run.period_start, run.segment
    FROM public.archive_runs AS run
    GROUP BY run.company_id, run.data_type, run.period_start, run.segment
    HAVING COUNT(*) > 1
  ) AS conflict;
  IF v_conflict_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'ARCHIVE_PERIOD_SEGMENT_CONFLICT',
      DETAIL = pg_catalog.format('%s duplicate period segment(s) found', v_conflict_count);
  END IF;
END;
$$;
--> statement-breakpoint

ALTER TABLE public.archive_runs
  ALTER COLUMN period_start SET NOT NULL,
  ALTER COLUMN period_end SET NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX archive_runs_company_type_period_segment_unique
  ON public.archive_runs (company_id, data_type, period_start, segment);
--> statement-breakpoint

CREATE INDEX archive_runs_company_type_period_cursor_idx
  ON public.archive_runs (company_id, data_type, period_start, created_at, id);
--> statement-breakpoint

ALTER TABLE public.archive_runs
  ADD CONSTRAINT archive_runs_period_check CHECK (
    period_start = (
      pg_catalog.date_trunc('month', period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    )
    AND period_end = period_start + INTERVAL '1 month'
  ),
  ADD CONSTRAINT archive_runs_key_period_check CHECK (
    CASE
      WHEN archive_key ~ '^[0-9]{4}-(0?[1-9]|1[0-2])-[jd]$' THEN
        pg_catalog.split_part(archive_key, '-', 1)::INTEGER
          = EXTRACT(YEAR FROM period_start AT TIME ZONE 'UTC')::INTEGER
        AND pg_catalog.split_part(archive_key, '-', 2)::INTEGER
          = EXTRACT(MONTH FROM period_start AT TIME ZONE 'UTC')::INTEGER
        AND (
          (data_type = 'jobs' AND archive_key ~ '-j$')
          OR (data_type = 'documents' AND archive_key ~ '-d$')
        )
        AND segment = 1
      WHEN archive_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[jd]-s[0-9]{6}$' THEN
        pg_catalog.split_part(archive_key, '-', 1)::INTEGER
          = EXTRACT(YEAR FROM period_start AT TIME ZONE 'UTC')::INTEGER
        AND pg_catalog.split_part(archive_key, '-', 2)::INTEGER
          = EXTRACT(MONTH FROM period_start AT TIME ZONE 'UTC')::INTEGER
        AND (
          (data_type = 'jobs' AND archive_key ~ '-j-s[0-9]{6}$')
          OR (data_type = 'documents' AND archive_key ~ '-d-s[0-9]{6}$')
        )
        AND pg_catalog.split_part(archive_key, '-s', 2)::INTEGER = segment
      ELSE false
    END
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.record_archiver_uploaded_run(
  p_lease_id UUID,
  p_lease_token UUID,
  p_doc_count INTEGER,
  p_storage_path TEXT,
  p_checksum TEXT,
  p_storage_generation BIGINT,
  p_id_manifest_path TEXT,
  p_id_manifest_checksum TEXT,
  p_id_manifest_generation BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease private.archive_run_leases%ROWTYPE;
  v_run public.archive_runs%ROWTYPE;
  v_public_company_id BIGINT;
  v_full_key TEXT;
  v_expected_storage_path TEXT;
  v_expected_id_path TEXT;
BEGIN
  IF p_lease_id IS NULL
     OR p_lease_token IS NULL
     OR p_doc_count IS NULL
     OR p_doc_count NOT BETWEEN 1 AND 1000000
     OR p_storage_path IS NULL
     OR p_checksum IS NULL
     OR p_checksum !~ '^[0-9a-f]{64}$'
     OR p_storage_generation IS NULL
     OR p_id_manifest_path IS NULL
     OR p_id_manifest_checksum IS NULL
     OR p_id_manifest_checksum !~ '^[0-9a-f]{64}$'
     OR p_id_manifest_generation IS NULL
     OR p_storage_generation <= 0
     OR p_id_manifest_generation <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_UPLOAD_INVALID';
  END IF;
  SELECT lease.*
  INTO v_lease
  FROM private.archive_run_leases AS lease
  WHERE lease.id = p_lease_id
    AND lease.status = 'leased'
    AND lease.lease_token = p_lease_token
    AND lease.lease_until > pg_catalog.clock_timestamp()
  FOR UPDATE OF lease;
  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ARCHIVE_LEASE_LOST';
  END IF;
  SELECT company.public_company_id
  INTO STRICT v_public_company_id
  FROM public.companies AS company
  WHERE company.id = v_lease.company_id;

  v_full_key := pg_catalog.format(
    '%s-%s-s%s',
    v_lease.archive_key,
    CASE WHEN v_lease.data_type = 'jobs' THEN 'j' ELSE 'd' END,
    pg_catalog.lpad(v_lease.segment::TEXT, 6, '0')
  );
  v_expected_storage_path := pg_catalog.format(
    'companies/%s/archives/%s.json', v_public_company_id, v_full_key
  );
  v_expected_id_path := pg_catalog.format(
    'companies/%s/archives/%s.ids.json', v_public_company_id, v_full_key
  );
  IF p_storage_path <> v_expected_storage_path OR p_id_manifest_path <> v_expected_id_path THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_OBJECT_PATH_INVALID';
  END IF;

  INSERT INTO public.archive_runs (
    company_id, archive_key, data_type, status, period_start, period_end,
    snapshot_at, segment, doc_count, deleted_count, delete_cursor,
    storage_path, checksum, storage_generation, id_manifest_path,
    id_manifest_checksum, id_manifest_generation, created_at, completed_at
  ) VALUES (
    v_lease.company_id, v_full_key, v_lease.data_type,
    'uploaded_not_deleted', v_lease.period_start, v_lease.period_end,
    v_lease.snapshot_at, v_lease.segment, p_doc_count, 0, 0,
    p_storage_path, p_checksum, p_storage_generation, p_id_manifest_path,
    p_id_manifest_checksum, p_id_manifest_generation,
    pg_catalog.clock_timestamp(), NULL
  )
  ON CONFLICT (company_id, archive_key, data_type) DO UPDATE
  SET status = 'uploaded_not_deleted'
  WHERE public.archive_runs.period_start = EXCLUDED.period_start
    AND public.archive_runs.period_end = EXCLUDED.period_end
    AND public.archive_runs.segment = EXCLUDED.segment
    AND public.archive_runs.doc_count = EXCLUDED.doc_count
    AND public.archive_runs.storage_path = EXCLUDED.storage_path
    AND public.archive_runs.checksum = EXCLUDED.checksum
    AND public.archive_runs.storage_generation = EXCLUDED.storage_generation
    AND public.archive_runs.id_manifest_path = EXCLUDED.id_manifest_path
    AND public.archive_runs.id_manifest_checksum = EXCLUDED.id_manifest_checksum
    AND public.archive_runs.id_manifest_generation = EXCLUDED.id_manifest_generation
  RETURNING public.archive_runs.* INTO v_run;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'ARCHIVE_UPLOAD_CONFLICT';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'runId', v_run.id,
    'docCount', v_run.doc_count,
    'deleteCursor', v_run.delete_cursor,
    'status', v_run.status
  );
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.list_api_company_archives_v2(
  p_internal_company_id UUID,
  p_data_type VARCHAR(32) DEFAULT NULL,
  p_period_start TIMESTAMPTZ DEFAULT NULL,
  p_period_end TIMESTAMPTZ DEFAULT NULL,
  p_page_size INTEGER DEFAULT 50,
  p_after_created_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL
) RETURNS TABLE(
  id UUID,
  archive_key VARCHAR,
  data_type VARCHAR,
  status public.archive_run_status,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  segment INTEGER,
  doc_count INTEGER,
  deleted_count INTEGER,
  checksum VARCHAR,
  storage_generation BIGINT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid TEXT := private.app_auth_uid();
  v_page_size INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'COMPANY_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT private.app_has_archive_access(p_internal_company_id) THEN
    RAISE EXCEPTION 'COMPANY_ACCESS_DENIED';
  END IF;
  IF p_data_type IS NOT NULL AND p_data_type NOT IN ('jobs', 'documents') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_DATA_TYPE';
  END IF;
  IF (p_period_start IS NULL) <> (p_period_end IS NULL)
     OR (p_after_created_at IS NULL) <> (p_after_id IS NULL)
     OR (
       p_period_start IS NOT NULL
       AND (
         p_data_type IS NULL
         OR p_period_start <> (
           pg_catalog.date_trunc('month', p_period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
         )
         OR p_period_end <> p_period_start + INTERVAL '1 month'
       )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ARCHIVE_LIST_FILTER_INVALID';
  END IF;

  RETURN QUERY
  SELECT
    run.id,
    run.archive_key,
    run.data_type,
    run.status,
    run.period_start,
    run.period_end,
    run.segment,
    run.doc_count,
    run.deleted_count,
    run.checksum,
    run.storage_generation,
    run.created_at,
    run.completed_at
  FROM public.archive_runs AS run
  WHERE run.company_id = p_internal_company_id
    AND (p_data_type IS NULL OR run.data_type = p_data_type)
    AND (p_period_start IS NULL OR run.period_start = p_period_start)
    AND (p_period_end IS NULL OR run.period_end = p_period_end)
    AND (
      p_after_created_at IS NULL
      OR (run.created_at, run.id) < (p_after_created_at, p_after_id)
    )
  ORDER BY run.created_at DESC, run.id DESC
  LIMIT v_page_size + 1;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.get_api_company_archive_run(
  p_internal_company_id UUID,
  p_archive_run_id UUID
) RETURNS TABLE(
  id UUID,
  archive_key VARCHAR,
  data_type VARCHAR,
  status public.archive_run_status,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  segment INTEGER,
  storage_path VARCHAR,
  checksum VARCHAR,
  storage_generation BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF private.app_auth_uid() IS NULL THEN
    RAISE EXCEPTION 'COMPANY_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT private.app_has_archive_access(p_internal_company_id) THEN
    RAISE EXCEPTION 'COMPANY_ACCESS_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    run.id,
    run.archive_key,
    run.data_type,
    run.status,
    run.period_start,
    run.period_end,
    run.segment,
    run.storage_path,
    run.checksum,
    run.storage_generation
  FROM public.archive_runs AS run
  WHERE run.company_id = p_internal_company_id
    AND run.id = p_archive_run_id
  LIMIT 1;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION private.list_api_company_archives_v2(
  UUID, VARCHAR(32), TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated, service_role,
       smart_job_pdf, smart_job_email, smart_job_archiver;
REVOKE ALL ON FUNCTION private.get_api_company_archive_run(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role,
       smart_job_pdf, smart_job_email, smart_job_archiver;
GRANT EXECUTE ON FUNCTION private.list_api_company_archives_v2(
  UUID, VARCHAR(32), TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TIMESTAMPTZ, UUID
) TO smart_job_api;
GRANT EXECUTE ON FUNCTION private.get_api_company_archive_run(UUID, UUID)
  TO smart_job_api;
--> statement-breakpoint

INSERT INTO private.api_schema_metadata (component, schema_version)
VALUES ('cloudrun-api', 'batch6-2026-07-26')
ON CONFLICT (component) DO UPDATE
SET schema_version = EXCLUDED.schema_version,
    applied_at = pg_catalog.clock_timestamp();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.check_api_readiness(
  p_expected_schema_version TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COALESCE((
      SELECT metadata.schema_version = 'batch6-2026-07-26'
        AND p_expected_schema_version IN ('batch5-2026-07-21', 'batch6-2026-07-26')
      FROM private.api_schema_metadata AS metadata
      WHERE metadata.component = 'cloudrun-api'
    ), false)
    AND pg_catalog.to_regclass('public.jobs_search_text_trgm_idx') IS NOT NULL
    AND pg_catalog.to_regclass('public.documents_search_text_trgm_idx') IS NOT NULL
    AND pg_catalog.to_regclass('public.inventory_parts_normalized_name_trgm_idx') IS NOT NULL
    AND pg_catalog.to_regclass('public.archive_runs_company_type_period_segment_unique') IS NOT NULL
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.set_api_request_context(uuid,integer,integer,integer)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.create_api_job_with_details(uuid,public.job_status,text,text,text,text,integer,jsonb,jsonb,uuid,timestamp with time zone)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.list_api_company_archives_v2(uuid,character varying,timestamp with time zone,timestamp with time zone,integer,timestamp with time zone,uuid)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.get_api_company_archive_run(uuid,uuid)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.create_api_tax_invoice(uuid,jsonb,timestamp with time zone)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'smart_job_api',
      'private.create_api_contact_request(text,text,text,text,text)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.jobs', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.jobs', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.jobs', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.documents', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.documents', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.documents', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.inventory_parts', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.inventory_parts', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('smart_job_api', 'public.inventory_parts', 'DELETE');
$$;

-- ============================================================================
-- Consolidated source: 0034_receipt_payment_metadata.sql
-- ============================================================================
-- Enforce the canonical receipt payment structure independently of the API.
-- Existing payloads remain readable; the trigger applies only to new payload
-- writes and intentionally does not rewrite historical free-text values.

CREATE OR REPLACE FUNCTION private.contains_likely_payment_pan(
  p_value TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_match TEXT[];
  v_digits TEXT;
  v_sum INTEGER;
  v_digit INTEGER;
  v_double BOOLEAN;
  v_index INTEGER;
BEGIN
  IF p_value IS NULL OR p_value = '' THEN
    RETURN false;
  END IF;

  FOR v_match IN
    SELECT candidate
    FROM pg_catalog.regexp_matches(
      p_value,
      '([0-9][0-9 -]{11,35}[0-9])',
      'g'
    ) AS candidate
  LOOP
    v_digits := pg_catalog.regexp_replace(v_match[1], '[^0-9]', '', 'g');
    IF pg_catalog.char_length(v_digits) BETWEEN 13 AND 19 THEN
      v_sum := 0;
      v_double := false;
      FOR v_index IN REVERSE pg_catalog.char_length(v_digits)..1 LOOP
        v_digit := SUBSTRING(v_digits FROM v_index FOR 1)::INTEGER;
        IF v_double THEN
          v_digit := v_digit * 2;
          IF v_digit > 9 THEN v_digit := v_digit - 9; END IF;
        END IF;
        v_sum := v_sum + v_digit;
        v_double := NOT v_double;
      END LOOP;
      IF v_sum % 10 = 0 THEN RETURN true; END IF;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.enforce_document_payment_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_method TEXT := NEW.payload ->> 'paymentMethod';
  v_details JSONB := NEW.payload -> 'paymentDetails';
  v_reference TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.document_type IS NOT DISTINCT FROM NEW.document_type
     AND OLD.payload IS NOT DISTINCT FROM NEW.payload THEN
    RETURN NEW;
  END IF;

  IF NEW.document_type <> 400 THEN
    IF NEW.payload ? 'paymentMethod'
       OR NEW.payload ? 'paymentDetails'
       OR NEW.payload ? 'paymentInfo' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_DOCUMENT_TYPE_INVALID';
    END IF;
    RETURN NEW;
  END IF;

  IF v_method IS NULL
     OR v_method NOT IN ('cash', 'credit', 'transfer', 'check', 'bit', 'paybox')
     OR NEW.payload ? 'paymentInfo' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_INVALID';
  END IF;

  IF v_method = 'cash' THEN
    IF v_details IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_CASH_DETAILS_FORBIDDEN';
    END IF;
    RETURN NEW;
  END IF;

  IF v_details IS NULL OR pg_catalog.jsonb_typeof(v_details) <> 'object' THEN
    IF v_method = 'credit' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_CREDIT_DETAILS_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;

  IF v_method = 'credit' THEN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(v_details) AS key(name)
      WHERE key.name NOT IN ('last4', 'authorizationReference')
    )
       OR pg_catalog.jsonb_typeof(v_details -> 'last4') <> 'string'
       OR COALESCE(v_details ->> 'last4', '') !~ '^[0-9]{4}$'
       OR pg_catalog.jsonb_typeof(v_details -> 'authorizationReference') <> 'string'
       OR pg_catalog.char_length(pg_catalog.btrim(v_details ->> 'authorizationReference'))
            NOT BETWEEN 1 AND 128
       OR (v_details ->> 'authorizationReference') ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_CREDIT_DETAILS_INVALID';
    END IF;
    v_reference := v_details ->> 'authorizationReference';
  ELSE
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(v_details) AS key(name)
      WHERE key.name <> 'reference'
    )
       OR pg_catalog.jsonb_typeof(v_details -> 'reference') <> 'string'
       OR pg_catalog.char_length(pg_catalog.btrim(v_details ->> 'reference'))
            NOT BETWEEN 1 AND 128
       OR (v_details ->> 'reference') ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_REFERENCE_INVALID';
    END IF;
    v_reference := v_details ->> 'reference';
  END IF;

  IF private.contains_likely_payment_pan(v_reference) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_PAN_FORBIDDEN';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS documents_payment_metadata_guard ON public.documents;
CREATE TRIGGER documents_payment_metadata_guard
BEFORE INSERT OR UPDATE OF document_type, payload
ON public.documents
FOR EACH ROW
EXECUTE FUNCTION private.enforce_document_payment_metadata();
--> statement-breakpoint

REVOKE ALL ON FUNCTION private.contains_likely_payment_pan(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_document_payment_metadata() FROM PUBLIC;

-- ============================================================================
-- Consolidated source: 0035_backup_runtime_role.sql
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'smart_job_backup'
  ) THEN
    CREATE ROLE smart_job_backup
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOINHERIT;
  END IF;
END;
$$;
--> statement-breakpoint

GRANT pg_read_all_data TO smart_job_backup;
--> statement-breakpoint

DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO smart_job_backup',
    pg_catalog.current_database()
  );
END;
$$;
--> statement-breakpoint

ALTER ROLE smart_job_backup SET statement_timeout = '55min';
ALTER ROLE smart_job_backup SET lock_timeout = '5s';
ALTER ROLE smart_job_backup SET idle_in_transaction_session_timeout = '30s';
--> statement-breakpoint

COMMENT ON ROLE smart_job_backup IS
  'Dedicated logical-backup login; password/login is provisioned out of band';
