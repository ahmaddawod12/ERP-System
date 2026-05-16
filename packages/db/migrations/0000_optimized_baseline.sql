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
  SELECT status, result_payload, expire_at
  INTO v_existing
  FROM tax_invoice_idempotency
  WHERE company_id = p_company_id
    AND idempotency_hash = p_idempotency_hash
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

  UPDATE tax_invoice_idempotency
  SET user_id = p_user_id,
      status = 'in_progress',
      request_hash = p_request_hash,
      result_payload = NULL,
      locked_at = NOW(),
      expire_at = p_expire_at,
      updated_at = NOW()
  WHERE company_id = p_company_id
    AND idempotency_hash = p_idempotency_hash;

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
  ) RETURNING id, company_id, member_no, role, display_name, joined_at
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
  USING (app_has_company_access(company_id) OR user_id = app_auth_uid());

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
  USING (app_has_company_access(company_id));

CREATE POLICY job_attachments_company_read_policy
  ON job_attachments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM jobs j
      WHERE j.id = job_attachments.job_id
        AND app_has_company_access(j.company_id)
    )
  );

CREATE POLICY job_part_usages_company_read_policy
  ON job_part_usages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM jobs j
      WHERE j.id = job_part_usages.job_id
        AND app_has_company_access(j.company_id)
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
  USING (app_has_company_access(company_id));

CREATE POLICY document_items_company_read_policy
  ON document_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM documents d
      WHERE d.id = document_items.document_id
        AND app_has_company_access(d.company_id)
    )
  );

CREATE POLICY document_job_links_company_read_policy
  ON document_job_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM documents d
      WHERE d.id = document_job_links.document_id
        AND app_has_company_access(d.company_id)
    )
  );

CREATE POLICY proposal_usage_company_read_policy
  ON proposal_usage
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM documents d
      WHERE d.id = proposal_usage.proposal_document_id
        AND app_has_company_access(d.company_id)
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
