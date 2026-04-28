const {
  check,
  bigint,
  boolean,
  index,
  integer,
  sql,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} = require('drizzle-orm/pg-core');

const accountTypeEnum = pgEnum('account_type', ['solo', 'business']);
const workspaceStatusEnum = pgEnum('workspace_status', ['active', 'disabled', 'archived']);
const tierEnum = pgEnum('subscription_tier', ['Basic', 'Solo', 'Team', 'Enterprise']);
const subscriptionStatusEnum = pgEnum('subscription_status', ['active', 'trial', 'expired']);
const membershipRoleEnum = pgEnum('membership_role', ['manager', 'worker', 'user', 'basic']);
const membershipStatusEnum = pgEnum('membership_status', ['active', 'disabled', 'pending']);
const systemRoleEnum = pgEnum('system_role', ['dev']);
const counterKeyEnum = pgEnum('counter_key', [
  'member_no',
  'client_no',
  'job_no',
  'part_no',
  'doc_10',
  'doc_200',
  'doc_210',
  'doc_305',
  'doc_330',
  'doc_400',
]);
const clientStatusEnum = pgEnum('client_status', ['active', 'archived']);
const jobStatusEnum = pgEnum('job_status', ['pending', 'waiting', 'finished', 'denied']);
const documentGenerationStatusEnum = pgEnum('document_generation_status', ['pending', 'queued', 'processing', 'completed', 'failed']);
const taxAuthorityStatusEnum = pgEnum('tax_authority_status', ['none', 'reserved', 'approved', 'rejected', 'failed', 'burned']);
const attachmentKindEnum = pgEnum('job_attachment_kind', ['photo', 'signature']);
const inventoryLocationTypeEnum = pgEnum('inventory_location_type', ['company', 'member', 'consumed', 'adjustment']);
const inventoryMovementTypeEnum = pgEnum('inventory_movement_type', ['add', 'adjust', 'pick', 'return', 'job_consumption', 'manual_replace']);
const inviteStatusEnum = pgEnum('invite_status', ['active', 'used', 'expired', 'revoked']);
const reservationStatusEnum = pgEnum('tax_invoice_reservation_status', ['reserved', 'approved', 'generated', 'failed', 'burned', 'rejected', 'validation_failed', 'submission_failed', 'approval_received_needs_reconcile']);
const idempotencyStatusEnum = pgEnum('idempotency_status', ['in_progress', 'approved', 'failed']);
const taskTypeEnum = pgEnum('document_task_type', ['preview', 'generate']);
const conversationStatusEnum = pgEnum('support_conversation_status', ['open', 'closed']);
const senderTypeEnum = pgEnum('support_sender_type', ['user', 'dev']);
const deliveryStatusEnum = pgEnum('notification_delivery_status', ['claimed', 'sent', 'failed']);
const archiveStatusEnum = pgEnum('archive_run_status', ['pending', 'uploaded_not_deleted', 'deleted', 'failed']);

const systemCounters = pgTable('system_counters', {
  counterKey: varchar('counter_key', { length: 64 }).primaryKey(),
  nextValue: integer('next_value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const appUsers = pgTable('app_users', {
  id: text('id').primaryKey(),
  email: varchar('email', { length: 320 }).notNull(),
  displayName: varchar('display_name', { length: 200 }),
  phoneNumber: varchar('phone_number', { length: 40 }),
  systemRole: systemRoleEnum('system_role'),
  pushToken: varchar('push_token', { length: 500 }),
  pushTokenPlatform: varchar('push_token_platform', { length: 32 }),
  pushTokenUpdatedAt: timestamp('push_token_updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailUnique: uniqueIndex('app_users_email_unique').on(table.email),
}));

const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  publicCompanyId: bigint('public_company_id', { mode: 'number' }).notNull(),
  accountType: accountTypeEnum('account_type').notNull(),
  status: workspaceStatusEnum('status').notNull().default('active'),
  createdByUserId: text('created_by_user_id').references(() => appUsers.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  publicCompanyIdUnique: uniqueIndex('companies_public_company_id_unique').on(table.publicCompanyId),
}));

const companyProfiles = pgTable('company_profiles', {
  companyId: uuid('company_id').primaryKey().references(() => companies.id, { onDelete: 'cascade' }),
  heName: varchar('he_name', { length: 200 }),
  enName: varchar('en_name', { length: 200 }),
  vatNumber: varchar('vat_number', { length: 32 }),
  businessType: varchar('business_type', { length: 120 }),
  city: varchar('city', { length: 120 }),
  address: varchar('address', { length: 500 }),
  businessEmail: varchar('business_email', { length: 320 }),
  businessPhone: varchar('business_phone', { length: 40 }),
  businessFax: varchar('business_fax', { length: 40 }),
  accountantName: varchar('accountant_name', { length: 200 }),
  accountantEmail: varchar('accountant_email', { length: 320 }),
  accountantPhone: varchar('accountant_phone', { length: 40 }),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  registeredByUserId: text('registered_by_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  vatNumberUnique: uniqueIndex('company_profiles_vat_number_unique').on(table.vatNumber),
}));

const companySubscriptions = pgTable('company_subscriptions', {
  companyId: uuid('company_id').primaryKey().references(() => companies.id, { onDelete: 'cascade' }),
  tier: tierEnum('tier').notNull(),
  status: subscriptionStatusEnum('status').notNull().default('active'),
  enabledModules: jsonb('enabled_modules').notNull().default({}),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const companySyncState = pgTable('company_sync_state', {
  companyId: uuid('company_id').primaryKey().references(() => companies.id, { onDelete: 'cascade' }),
  jobsVersion: integer('jobs_version').notNull().default(0),
  documentsVersion: integer('documents_version').notNull().default(0),
  clientsVersion: integer('clients_version').notNull().default(0),
  workersVersion: integer('workers_version').notNull().default(0),
  companyInventoryVersion: integer('company_inventory_version').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const companyMemberships = pgTable('company_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  memberNo: integer('member_no').notNull(),
  role: membershipRoleEnum('role').notNull(),
  status: membershipStatusEnum('status').notNull().default('active'),
  displayName: varchar('display_name', { length: 200 }),
  phoneNumber: varchar('phone_number', { length: 40 }),
  invitedByUserId: text('invited_by_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  membershipPerCompanyUserUnique: uniqueIndex('company_memberships_company_user_unique').on(table.companyId, table.userId),
  membershipNoPerCompanyUnique: uniqueIndex('company_memberships_company_member_no_unique').on(table.companyId, table.memberNo),
  companyRoleIdx: index('company_memberships_company_role_idx').on(table.companyId, table.role, table.status),
}));

const companyCounters = pgTable('company_counters', {
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  counterKey: counterKeyEnum('counter_key').notNull(),
  nextValue: integer('next_value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.companyId, table.counterKey], name: 'company_counters_pk' }),
}));

const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  clientNo: integer('client_no').notNull(),
  status: clientStatusEnum('status').notNull().default('active'),
  name: varchar('name', { length: 240 }).notNull(),
  phone: varchar('phone', { length: 40 }),
  email: varchar('email', { length: 320 }),
  address: varchar('address', { length: 500 }),
  city: varchar('city', { length: 120 }),
  vatNumber: varchar('vat_number', { length: 32 }),
  notes: text('notes'),
  createdByMembershipId: uuid('created_by_membership_id').references(() => companyMemberships.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => ({
  clientNoPerCompanyUnique: uniqueIndex('clients_company_client_no_unique').on(table.companyId, table.clientNo),
  companyNameIdx: index('clients_company_name_idx').on(table.companyId, table.name),
  companyPhoneIdx: index('clients_company_phone_idx').on(table.companyId, table.phone),
}));

const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  jobNo: integer('job_no').notNull(),
  status: jobStatusEnum('status').notNull(),
  title: varchar('title', { length: 240 }),
  description: text('description'),
  notes: text('notes'),
  location: varchar('location', { length: 240 }),
  address: varchar('address', { length: 500 }),
  category: varchar('category', { length: 120 }),
  priority: varchar('priority', { length: 40 }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  assignedMembershipId: uuid('assigned_membership_id').references(() => companyMemberships.id, { onDelete: 'set null' }),
  createdByMembershipId: uuid('created_by_membership_id').references(() => companyMemberships.id, { onDelete: 'set null' }),
  acceptedByUserId: text('accepted_by_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  deniedAt: timestamp('denied_at', { withTimezone: true }),
  deniedByUserId: text('denied_by_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
  isCert: boolean('is_cert').notNull().default(false),
  idempotencyKey: varchar('idempotency_key', { length: 128 }),
  clientNameSnapshot: varchar('client_name_snapshot', { length: 240 }),
  clientPhoneSnapshot: varchar('client_phone_snapshot', { length: 40 }),
  assignedMemberNameSnapshot: varchar('assigned_member_name_snapshot', { length: 200 }),
  createdByNameSnapshot: varchar('created_by_name_snapshot', { length: 200 }),
  meta: jsonb('meta').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  jobNoPerCompanyUnique: uniqueIndex('jobs_company_job_no_unique').on(table.companyId, table.jobNo),
  jobIdempotencyUnique: uniqueIndex('jobs_company_idempotency_unique').on(table.companyId, table.idempotencyKey),
  companyCreatedIdx: index('jobs_company_created_idx').on(table.companyId, table.createdAt),
  companyAssigneeCreatedIdx: index('jobs_company_assignee_created_idx').on(table.companyId, table.assignedMembershipId, table.createdAt),
  companyStatusCreatedIdx: index('jobs_company_status_created_idx').on(table.companyId, table.status, table.createdAt),
  companyUpdatedCreatedIdx: index('jobs_company_updated_created_idx').on(table.companyId, table.updatedAt, table.createdAt),
  companyFinishedCreatedIdx: index('jobs_company_finished_created_idx').on(table.companyId, table.finishedAt, table.createdAt),
  companyDueCreatedIdx: index('jobs_company_due_created_idx').on(table.companyId, table.dueAt, table.createdAt),
  companyStatusUpdatedIdx: index('jobs_company_status_updated_idx').on(table.companyId, table.status, table.updatedAt),
  companyAssignedStatusUpdatedIdx: index('jobs_company_assignee_status_updated_idx').on(table.companyId, table.assignedMembershipId, table.status, table.updatedAt),
}));

const jobAttachments = pgTable('job_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  storagePath: varchar('storage_path', { length: 1024 }).notNull(),
  kind: attachmentKindEnum('kind').notNull(),
  uploadedByUserId: text('uploaded_by_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  storagePathUnique: uniqueIndex('job_attachments_storage_path_unique').on(table.storagePath),
  jobKindIdx: index('job_attachments_job_kind_idx').on(table.jobId, table.kind),
}));

const jobPartUsages = pgTable('job_part_usages', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  inventoryPartId: uuid('inventory_part_id'),
  partNameSnapshot: varchar('part_name_snapshot', { length: 240 }),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  jobIdx: index('job_part_usages_job_idx').on(table.jobId),
  quantityNonNegative: check('job_part_usages_quantity_non_negative_check', sql`${table.quantity} >= 0`),
}));

const inventoryLocations = pgTable('inventory_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  locationType: inventoryLocationTypeEnum('location_type').notNull(),
  membershipId: uuid('membership_id').references(() => companyMemberships.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyLocationIdx: uniqueIndex('inventory_locations_company_location_unique').on(table.companyId, table.locationType, table.membershipId),
}));

const inventoryParts = pgTable('inventory_parts', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  partNo: integer('part_no').notNull(),
  name: varchar('name', { length: 240 }).notNull(),
  active: boolean('active').notNull().default(true),
  lowThreshold: numeric('low_threshold', { precision: 14, scale: 3 }).notNull().default('0'),
  unit: varchar('unit', { length: 40 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => ({
  companyPartNoUnique: uniqueIndex('inventory_parts_company_part_no_unique').on(table.companyId, table.partNo),
  companyActiveIdx: index('inventory_parts_company_active_idx').on(table.companyId, table.active),
  lowThresholdNonNegative: check('inventory_parts_low_threshold_non_negative_check', sql`${table.lowThreshold} >= 0`),
}));

const inventoryBalances = pgTable('inventory_balances', {
  locationId: uuid('location_id').notNull().references(() => inventoryLocations.id, { onDelete: 'cascade' }),
  partId: uuid('part_id').notNull().references(() => inventoryParts.id, { onDelete: 'cascade' }),
  quantityOnHand: numeric('quantity_on_hand', { precision: 14, scale: 3 }).notNull().default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.locationId, table.partId], name: 'inventory_balances_pk' }),
  quantityOnHandNonNegative: check('inventory_balances_quantity_on_hand_non_negative_check', sql`${table.quantityOnHand} >= 0`),
}));

const inventoryMovements = pgTable('inventory_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  partId: uuid('part_id').notNull().references(() => inventoryParts.id, { onDelete: 'restrict' }),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
  fromLocationId: uuid('from_location_id').references(() => inventoryLocations.id, { onDelete: 'set null' }),
  toLocationId: uuid('to_location_id').references(() => inventoryLocations.id, { onDelete: 'set null' }),
  movementType: inventoryMovementTypeEnum('movement_type').notNull(),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  documentId: uuid('document_id'),
  createdByMembershipId: uuid('created_by_membership_id').references(() => companyMemberships.id, { onDelete: 'set null' }),
  idempotencyKey: varchar('idempotency_key', { length: 128 }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyIdempotencyUnique: uniqueIndex('inventory_movements_company_idempotency_unique').on(table.companyId, table.idempotencyKey),
  companyPartCreatedIdx: index('inventory_movements_company_part_created_idx').on(table.companyId, table.partId, table.createdAt),
  quantityPositive: check('inventory_movements_quantity_positive_check', sql`${table.quantity} > 0`),
}));

const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  documentType: smallint('document_type').notNull(),
  documentNumber: integer('document_number').notNull(),
  documentCode: varchar('document_code', { length: 64 }).notNull(),
  generationStatus: documentGenerationStatusEnum('generation_status').notNull().default('pending'),
  taxAuthorityStatus: taxAuthorityStatusEnum('tax_authority_status').notNull().default('none'),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  createdByMembershipId: uuid('created_by_membership_id').references(() => companyMemberships.id, { onDelete: 'set null' }),
  sourcePriceProposalId: uuid('source_price_proposal_id'),
  storagePath: varchar('storage_path', { length: 1024 }),
  language: varchar('language', { length: 8 }),
  documentDate: timestamp('document_date', { withTimezone: true }),
  notes: text('notes'),
  totalBeforeVat: numeric('total_before_vat', { precision: 14, scale: 2 }).notNull().default('0'),
  vatAmount: numeric('vat_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  totalWithVat: numeric('total_with_vat', { precision: 14, scale: 2 }).notNull().default('0'),
  confirmationNumber: varchar('confirmation_number', { length: 128 }),
  taxAuthorityResponse: jsonb('tax_authority_response'),
  emailSent: boolean('email_sent').notNull().default(false),
  companyNameSnapshot: varchar('company_name_snapshot', { length: 240 }),
  companyVatSnapshot: varchar('company_vat_snapshot', { length: 32 }),
  companyAddressSnapshot: varchar('company_address_snapshot', { length: 500 }),
  clientNameSnapshot: varchar('client_name_snapshot', { length: 240 }),
  clientPhoneSnapshot: varchar('client_phone_snapshot', { length: 40 }),
  clientCitySnapshot: varchar('client_city_snapshot', { length: 120 }),
  clientVatSnapshot: varchar('client_vat_snapshot', { length: 32 }),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyTypeNumberUnique: uniqueIndex('documents_company_type_number_unique').on(table.companyId, table.documentType, table.documentNumber),
  companyCodeUnique: uniqueIndex('documents_company_code_unique').on(table.companyId, table.documentCode),
  companyCreatedIdx: index('documents_company_created_idx').on(table.companyId, table.createdAt),
  companyStatusCreatedIdx: index('documents_company_status_created_idx').on(table.companyId, table.generationStatus, table.createdAt),
  companyTypeCreatedIdx: index('documents_company_type_created_idx').on(table.companyId, table.documentType, table.createdAt),
  companyCreatorCreatedIdx: index('documents_company_creator_created_idx').on(table.companyId, table.createdByMembershipId, table.createdAt),
  companyUpdatedCreatedIdx: index('documents_company_updated_created_idx').on(table.companyId, table.updatedAt, table.createdAt),
  companyDocumentDateCreatedIdx: index('documents_company_document_date_created_idx').on(table.companyId, table.documentDate, table.createdAt),
  totalBeforeVatNonNegative: check('documents_total_before_vat_non_negative_check', sql`${table.totalBeforeVat} >= 0`),
  vatAmountNonNegative: check('documents_vat_amount_non_negative_check', sql`${table.vatAmount} >= 0`),
  totalWithVatNonNegative: check('documents_total_with_vat_non_negative_check', sql`${table.totalWithVat} >= 0`),
  totalConsistency: check('documents_total_consistency_check', sql`${table.totalBeforeVat} + ${table.vatAmount} = ${table.totalWithVat}`),
}));

const documentItems = pgTable('document_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  description: varchar('description', { length: 240 }).notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
  lineTotal: numeric('line_total', { precision: 14, scale: 2 }).notNull(),
  sourceInventoryPartId: uuid('source_inventory_part_id').references(() => inventoryParts.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').notNull().default({}),
}, (table) => ({
  lineNoPerDocumentUnique: uniqueIndex('document_items_document_line_no_unique').on(table.documentId, table.lineNo),
  quantityPositive: check('document_items_quantity_positive_check', sql`${table.quantity} > 0`),
  unitPriceNonNegative: check('document_items_unit_price_non_negative_check', sql`${table.unitPrice} >= 0`),
  lineTotalNonNegative: check('document_items_line_total_non_negative_check', sql`${table.lineTotal} >= 0`),
}));

const documentJobLinks = pgTable('document_job_links', {
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.documentId, table.jobId], name: 'document_job_links_pk' }),
}));

const proposalUsage = pgTable('proposal_usage', {
  proposalDocumentId: uuid('proposal_document_id').primaryKey().references(() => documents.id, { onDelete: 'cascade' }),
  consumerDocumentId: uuid('consumer_document_id').references(() => documents.id, { onDelete: 'set null' }),
  usedByUserId: text('used_by_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
  usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
});

const companyInvites = pgTable('company_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 80 }).notNull(),
  targetRole: membershipRoleEnum('target_role').notNull(),
  status: inviteStatusEnum('status').notNull().default('active'),
  invitedEmail: varchar('invited_email', { length: 320 }),
  createdByMembershipId: uuid('created_by_membership_id').references(() => companyMemberships.id, { onDelete: 'set null' }),
  usedByUserId: text('used_by_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  codeUnique: uniqueIndex('company_invites_code_unique').on(table.code),
  companyStatusExpiresIdx: index('company_invites_company_status_expires_idx').on(table.companyId, table.status, table.expiresAt),
}));

const taxInvoiceReservations = pgTable('tax_invoice_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  documentNumber: integer('document_number').notNull(),
  status: reservationStatusEnum('status').notNull().default('reserved'),
  reservedByUserId: text('reserved_by_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
  clientNameSnapshot: varchar('client_name_snapshot', { length: 240 }),
  externalConfirmationNumber: varchar('external_confirmation_number', { length: 128 }),
  statusPayload: jsonb('status_payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  documentUnique: uniqueIndex('tax_invoice_reservations_document_unique').on(table.documentId),
  companyNumberUnique: uniqueIndex('tax_invoice_reservations_company_number_unique').on(table.companyId, table.documentNumber),
}));

const taxInvoiceIdempotency = pgTable('tax_invoice_idempotency', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  idempotencyHash: varchar('idempotency_hash', { length: 128 }).notNull(),
  userId: text('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  status: idempotencyStatusEnum('status').notNull(),
  reservationId: uuid('reservation_id').references(() => taxInvoiceReservations.id, { onDelete: 'set null' }),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  requestHash: varchar('request_hash', { length: 128 }),
  resultPayload: jsonb('result_payload'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  expireAt: timestamp('expire_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyKeyUnique: uniqueIndex('tax_invoice_idempotency_company_key_unique').on(table.companyId, table.idempotencyHash),
}));

const documentTasks = pgTable('document_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskKey: varchar('task_key', { length: 160 }).notNull(),
  lockKey: varchar('lock_key', { length: 220 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  taskType: taskTypeEnum('task_type').notNull(),
  documentType: smallint('document_type').notNull(),
  status: documentGenerationStatusEnum('status').notNull().default('pending'),
  requestPayload: jsonb('request_payload').notNull().default({}),
  previewUrl: varchar('preview_url', { length: 2048 }),
  generateUrl: varchar('generate_url', { length: 2048 }),
  storagePath: varchar('storage_path', { length: 1024 }),
  pdfSize: integer('pdf_size'),
  error: text('error'),
  processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expireAt: timestamp('expire_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  taskKeyUnique: uniqueIndex('document_tasks_task_key_unique').on(table.taskKey),
  activeCompanyLockUnique: uniqueIndex('document_tasks_active_company_lock_unique')
    .on(table.companyId, table.taskType, table.lockKey)
    .where(sql`${table.status} in ('pending', 'queued', 'processing')`),
  userStatusIdx: index('document_tasks_user_status_idx').on(table.userId, table.status, table.createdAt),
}));

const taxAuthorityTokens = pgTable('tax_authority_tokens', {
  companyId: uuid('company_id').primaryKey().references(() => companies.id, { onDelete: 'cascade' }),
  accessTokenEncrypted: text('access_token_encrypted'),
  refreshTokenEncrypted: text('refresh_token_encrypted'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  authorizedAt: timestamp('authorized_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const taxOauthSessions = pgTable('tax_oauth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  state: varchar('state', { length: 512 }).notNull(),
  stateNonce: varchar('state_nonce', { length: 128 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  stateUnique: uniqueIndex('tax_oauth_sessions_state_unique').on(table.state),
}));

const taxOauthCallbacks = pgTable('tax_oauth_callbacks', {
  id: uuid('id').primaryKey().defaultRandom(),
  oauthSessionId: uuid('oauth_session_id').notNull().references(() => taxOauthSessions.id, { onDelete: 'cascade' }),
  codeHash: varchar('code_hash', { length: 128 }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  used: boolean('used').notNull().default(false),
  tokenExchangeSuccess: boolean('token_exchange_success'),
  tokenExchangeError: text('token_exchange_error'),
  tokenExchangeAttemptedAt: timestamp('token_exchange_attempted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

const supportConversations = pgTable('support_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  category: varchar('category', { length: 64 }).notNull().default('general'),
  status: conversationStatusEnum('status').notNull().default('open'),
  lastMessageText: text('last_message_text'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  unreadForUserCount: integer('unread_for_user_count').notNull().default(0),
  unreadForDevCount: integer('unread_for_dev_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userStatusIdx: index('support_conversations_user_status_idx').on(table.userId, table.status, table.lastMessageAt),
  statusQueueIdx: index('support_conversations_status_queue_idx').on(table.status, table.lastMessageAt),
}));

const supportMessages = pgTable('support_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => supportConversations.id, { onDelete: 'cascade' }),
  senderUserId: text('sender_user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  senderType: senderTypeEnum('sender_type').notNull(),
  senderNameSnapshot: varchar('sender_name_snapshot', { length: 200 }),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  conversationCreatedIdx: index('support_messages_conversation_created_idx').on(table.conversationId, table.createdAt),
}));

const notificationDeliveries = pgTable('notification_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  relatedEntityType: varchar('related_entity_type', { length: 40 }).notNull(),
  relatedEntityId: varchar('related_entity_id', { length: 128 }).notNull(),
  deliveryType: varchar('delivery_type', { length: 40 }).notNull(),
  recipientUserId: text('recipient_user_id').references(() => appUsers.id, { onDelete: 'cascade' }),
  dedupKey: varchar('dedup_key', { length: 160 }).notNull(),
  status: deliveryStatusEnum('status').notNull().default('claimed'),
  providerMessageId: varchar('provider_message_id', { length: 160 }),
  claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  expireAt: timestamp('expire_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dedupKeyUnique: uniqueIndex('notification_deliveries_dedup_key_unique').on(table.dedupKey),
}));

const rateLimitBuckets = pgTable('rate_limit_buckets', {
  bucketKey: varchar('bucket_key', { length: 160 }).primaryKey(),
  hashedKey: varchar('hashed_key', { length: 160 }).notNull(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
  hitCount: integer('hit_count').notNull().default(0),
  expireAt: timestamp('expire_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  expireAtIdx: index('rate_limit_buckets_expire_at_idx').on(table.expireAt),
}));

const upgradeRequests = pgTable('upgrade_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  uid: text('uid'),
  email: varchar('email', { length: 320 }),
  companyId: uuid('company_id'),
  role: varchar('role', { length: 32 }),
  currentTier: varchar('current_tier', { length: 32 }).notNull(),
  requestedTier: varchar('requested_tier', { length: 32 }).notNull(),
  message: text('message').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  moderatedAt: timestamp('moderated_at', { withTimezone: true }),
  moderatedByUid: text('moderated_by_uid'),
  moderatedByName: varchar('moderated_by_name', { length: 200 }),
  moderationNote: text('moderation_note'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  appliedByUid: text('applied_by_uid'),
}, (table) => ({
  createdAtIdx: index('upgrade_requests_created_at_idx').on(table.createdAt),
  statusIdx: index('upgrade_requests_status_idx').on(table.status, table.createdAt),
}));

const contactRequests = pgTable('contact_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 320 }).notNull(),
  company: varchar('company', { length: 140 }).notNull(),
  subject: varchar('subject', { length: 500 }),
  message: text('message').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('new'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expireAt: timestamp('expire_at', { withTimezone: true }),
}, (table) => ({
  createdAtIdx: index('contact_requests_created_at_idx').on(table.createdAt),
  expireAtIdx: index('contact_requests_expire_at_idx').on(table.expireAt),
}));

const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 80 }).notNull(),
  performedBy: text('performed_by'),
  documentId: varchar('document_id', { length: 128 }),
  documentType: varchar('document_type', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyCreatedAtIdx: index('audit_logs_company_created_at_idx').on(table.companyId, table.createdAt),
}));

const orphanedUserCleanupMarkers = pgTable('orphaned_user_cleanup_markers', {
  id: uuid('id').primaryKey().defaultRandom(),
  uid: text('uid').notNull(),
  email: varchar('email', { length: 320 }),
  companyId: varchar('company_id', { length: 32 }),
  reason: varchar('reason', { length: 64 }).notNull(),
  cleanupError: text('cleanup_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index('orphaned_user_cleanup_markers_created_at_idx').on(table.createdAt),
}));

const archiveRuns = pgTable('archive_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  archiveKey: varchar('archive_key', { length: 32 }).notNull(),
  dataType: varchar('data_type', { length: 32 }).notNull(),
  status: archiveStatusEnum('status').notNull().default('pending'),
  docCount: integer('doc_count').notNull().default(0),
  deletedCount: integer('deleted_count').notNull().default(0),
  storagePath: varchar('storage_path', { length: 1024 }),
  checksum: varchar('checksum', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  companyArchiveTypeUnique: uniqueIndex('archive_runs_company_archive_type_unique').on(table.companyId, table.archiveKey, table.dataType),
}));

export { accountTypeEnum, appUsers, archiveRuns, auditLogs, clients, companies, companyCounters, companyInvites, companyMemberships, companyProfiles, companySyncState, companySubscriptions, contactRequests, documentItems, documentJobLinks, documentTasks, documents, inventoryBalances, inventoryLocations, inventoryMovements, inventoryParts, jobAttachments, jobPartUsages, jobs, notificationDeliveries, orphanedUserCleanupMarkers, proposalUsage, rateLimitBuckets, supportConversations, supportMessages, systemCounters, taxAuthorityTokens, taxInvoiceIdempotency, taxInvoiceReservations, taxOauthCallbacks, taxOauthSessions, upgradeRequests };
