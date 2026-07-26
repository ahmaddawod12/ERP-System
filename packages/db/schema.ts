import {
  check,
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const bytea = customType({
  dataType() {
    return 'bytea';
  },
});

const privateSchema = pgSchema('private');

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
const taxAuthorityStatusEnum = pgEnum('tax_authority_status', ['none', 'reserved', 'submitted', 'approved', 'rejected', 'failed', 'burned']);
const attachmentKindEnum = pgEnum('job_attachment_kind', ['photo', 'signature']);
const inventoryLocationTypeEnum = pgEnum('inventory_location_type', ['company', 'member', 'consumed', 'adjustment']);
const inventoryMovementTypeEnum = pgEnum('inventory_movement_type', ['add', 'adjust', 'pick', 'return', 'job_consumption', 'manual_replace']);
const inviteStatusEnum = pgEnum('invite_status', ['active', 'used', 'expired', 'revoked']);
const reservationStatusEnum = pgEnum('tax_invoice_reservation_status', ['reserved', 'submitted', 'approved', 'generated', 'failed', 'burned', 'rejected', 'validation_failed', 'submission_failed', 'approval_received_needs_reconcile']);
const idempotencyStatusEnum = pgEnum('idempotency_status', ['in_progress', 'approved', 'failed']);
const taskTypeEnum = pgEnum('document_task_type', ['preview', 'generate']);
const conversationStatusEnum = pgEnum('support_conversation_status', ['open', 'closed']);
const senderTypeEnum = pgEnum('support_sender_type', ['user', 'dev']);
const deliveryStatusEnum = pgEnum('notification_delivery_status', ['claimed', 'sent', 'failed']);
const archiveStatusEnum = pgEnum('archive_run_status', ['pending', 'uploaded_not_deleted', 'deleted', 'failed']);
const emailDeliveryStatusEnum = pgEnum('email_delivery_status', [
  'queued',
  'sending',
  'sent',
  'failed',
  'delivery_unknown',
]);
const taxSubmissionStatusEnum = pgEnum('tax_submission_status', [
  'queued',
  'submitting',
  'submitted',
  'approved',
  'rejected',
  'failed',
  'submission_unknown',
]);
const archiveRunLeaseStatusEnum = pgEnum('archive_run_lease_status', [
  'pending',
  'leased',
  'completed',
  'failed',
]);

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
  entityVersion: bigint('entity_version', { mode: 'number' }).notNull().default(1),
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
  entityVersion: bigint('entity_version', { mode: 'number' }).notNull().default(1),
}, (table) => ({
  membershipPerCompanyUserUnique: uniqueIndex('company_memberships_company_user_active_unique')
    .on(table.companyId, table.userId)
    .where(sql`${table.status} = 'active'`),
  membershipNoPerCompanyUnique: uniqueIndex('company_memberships_company_member_no_unique').on(table.companyId, table.memberNo),
  companyRoleIdx: index('company_memberships_company_role_idx').on(table.companyId, table.role, table.status),
  userActiveJoinedIdx: index('company_memberships_user_active_joined_idx').on(table.userId, table.status, table.joinedAt, table.createdAt),
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
  entityVersion: bigint('entity_version', { mode: 'number' }).notNull().default(1),
  createdByMembershipId: uuid('created_by_membership_id').references(() => companyMemberships.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => ({
  clientNoPerCompanyUnique: uniqueIndex('clients_company_client_no_unique').on(table.companyId, table.clientNo),
  companyNameIdx: index('clients_company_name_idx').on(table.companyId, table.name),
  companyPhoneIdx: index('clients_company_phone_idx').on(table.companyId, table.phone),
  companyEmailIdx: index('clients_company_email_idx').on(table.companyId, table.email),
  companyClientNoCursorIdx: index('clients_company_client_no_cursor_idx').on(table.companyId, table.clientNo, table.id),
  companyStatusCreatedCursorIdx: index('clients_company_status_created_cursor_idx')
    .on(table.companyId, table.status, table.createdAt, table.id),
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
  entityVersion: bigint('entity_version', { mode: 'number' }).notNull().default(1),
  idempotencyKey: varchar('idempotency_key', { length: 128 }),
  clientNameSnapshot: varchar('client_name_snapshot', { length: 240 }),
  clientPhoneSnapshot: varchar('client_phone_snapshot', { length: 40 }),
  assignedMemberNameSnapshot: varchar('assigned_member_name_snapshot', { length: 200 }),
  createdByNameSnapshot: varchar('created_by_name_snapshot', { length: 200 }),
  searchText: text('search_text').generatedAlwaysAs(sql`
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
  `),
  meta: jsonb('meta').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  jobNoPerCompanyUnique: uniqueIndex('jobs_company_job_no_unique').on(table.companyId, table.jobNo),
  jobIdempotencyUnique: uniqueIndex('jobs_company_idempotency_unique')
    .on(table.companyId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
  companyCreatedIdx: index('jobs_company_created_idx').on(table.companyId, table.createdAt),
  companyAssigneeCreatedIdx: index('jobs_company_assignee_created_idx').on(table.companyId, table.assignedMembershipId, table.createdAt),
  companyStatusCreatedIdx: index('jobs_company_status_created_idx').on(table.companyId, table.status, table.createdAt),
  companyUpdatedCreatedIdx: index('jobs_company_updated_created_idx').on(table.companyId, table.updatedAt, table.createdAt),
  companyFinishedCreatedIdx: index('jobs_company_finished_created_idx').on(table.companyId, table.finishedAt, table.createdAt),
  companyDueCreatedIdx: index('jobs_company_due_created_idx').on(table.companyId, table.dueAt, table.createdAt),
  companyStatusUpdatedIdx: index('jobs_company_status_updated_idx').on(table.companyId, table.status, table.updatedAt),
  companyAssignedStatusUpdatedIdx: index('jobs_company_assignee_status_updated_idx').on(table.companyId, table.assignedMembershipId, table.status, table.updatedAt),
  companyCreatedCursorIdx: index('jobs_company_created_cursor_idx').on(table.companyId, table.createdAt, table.id),
  companyUpdatedCursorIdx: index('jobs_company_updated_cursor_idx').on(table.companyId, table.updatedAt, table.id),
  companyAssigneeCreatedCursorIdx: index('jobs_company_assignee_created_cursor_idx').on(table.companyId, table.assignedMembershipId, table.createdAt, table.id),
  companyAssigneeUpdatedCursorIdx: index('jobs_company_assignee_updated_cursor_idx').on(table.companyId, table.assignedMembershipId, table.updatedAt, table.id),
  companyFinishedCursorIdx: index('jobs_company_finished_cursor_idx').on(table.companyId, table.finishedAt, table.id),
  companyAssigneeFinishedCursorIdx: index('jobs_company_assignee_finished_cursor_idx').on(table.companyId, table.assignedMembershipId, table.finishedAt, table.id),
  companyAssigneeDueCursorIdx: index('jobs_company_assignee_due_cursor_idx').on(table.companyId, table.assignedMembershipId, table.dueAt, table.id),
  companyAssigneeStatusFinishedCursorIdx: index('jobs_company_assignee_status_finished_cursor_idx').on(table.companyId, table.assignedMembershipId, table.status, table.finishedAt, table.id),
  searchTextTrgmIdx: index('jobs_search_text_trgm_idx')
    .using('gin', table.searchText.asc().op('gin_trgm_ops')),
  companyStatusCreatedCursorIdx: index('jobs_company_status_created_cursor_idx').on(table.companyId, table.status, table.createdAt, table.id),
  companyStatusUpdatedCursorIdx: index('jobs_company_status_updated_cursor_idx').on(table.companyId, table.status, table.updatedAt, table.id),
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
  companyNullMembershipLocationIdx: uniqueIndex('inventory_locations_company_null_membership_unique')
    .on(table.companyId, table.locationType)
    .where(sql`${table.membershipId} IS NULL`),
  companyMembershipLocationIdx: uniqueIndex('inventory_locations_company_membership_unique')
    .on(table.companyId, table.locationType, table.membershipId)
    .where(sql`${table.membershipId} IS NOT NULL`),
}));

const inventoryParts = pgTable('inventory_parts', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  partNo: integer('part_no').notNull(),
  name: varchar('name', { length: 240 }).notNull(),
  normalizedName: text('normalized_name').generatedAlwaysAs(sql`pg_catalog.lower(name)`),
  active: boolean('active').notNull().default(true),
  lowThreshold: numeric('low_threshold', { precision: 14, scale: 3 }).notNull().default('0'),
  unit: varchar('unit', { length: 40 }),
  entityVersion: bigint('entity_version', { mode: 'bigint' }).notNull().default(sql`1`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => ({
  companyPartNoUnique: uniqueIndex('inventory_parts_company_part_no_unique').on(table.companyId, table.partNo),
  companyActiveIdx: index('inventory_parts_company_active_idx').on(table.companyId, table.active),
  companyArchivedPartNoIdx: index('inventory_parts_company_archived_part_no_idx').on(table.companyId, table.archivedAt, table.partNo),
  companyActiveArchivedPartNoIdx: index('inventory_parts_company_active_archived_part_no_idx').on(table.companyId, table.active, table.archivedAt, table.partNo),
  normalizedNameTrgmIdx: index('inventory_parts_normalized_name_trgm_idx')
    .using('gin', table.normalizedName.asc().op('gin_trgm_ops')),
  lowThresholdNonNegative: check('inventory_parts_low_threshold_non_negative_check', sql`${table.lowThreshold} >= 0`),
  entityVersionPositive: check('inventory_parts_entity_version_positive_check', sql`${table.entityVersion} > 0`),
}));

const inventoryBalances = pgTable('inventory_balances', {
  locationId: uuid('location_id').notNull().references(() => inventoryLocations.id, { onDelete: 'cascade' }),
  partId: uuid('part_id').notNull().references(() => inventoryParts.id, { onDelete: 'cascade' }),
  quantityOnHand: numeric('quantity_on_hand', { precision: 14, scale: 3 }).notNull().default('0'),
  entityVersion: bigint('entity_version', { mode: 'bigint' }).notNull().default(sql`1`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.locationId, table.partId], name: 'inventory_balances_pk' }),
  quantityOnHandNonNegative: check('inventory_balances_quantity_on_hand_non_negative_check', sql`${table.quantityOnHand} >= 0`),
  entityVersionPositive: check('inventory_balances_entity_version_positive_check', sql`${table.entityVersion} > 0`),
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
  companyIdempotencyUnique: uniqueIndex('inventory_movements_company_idempotency_unique')
    .on(table.companyId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
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
  searchText: text('search_text').generatedAlwaysAs(sql`
    pg_catalog.lower(
      document_code || ' ' ||
      COALESCE(client_name_snapshot, '') || ' ' ||
      COALESCE(client_phone_snapshot, '') || ' ' ||
      COALESCE(client_city_snapshot, '') || ' ' ||
      COALESCE(client_vat_snapshot, '')
    )
  `),
  payload: jsonb('payload').notNull().default({}),
  entityVersion: bigint('entity_version', { mode: 'bigint' }).notNull().default(sql`1`),
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
  companyCreatedCursorIdx: index('documents_company_created_cursor_idx').on(table.companyId, table.createdAt, table.id),
  companyUpdatedCursorIdx: index('documents_company_updated_cursor_idx').on(table.companyId, table.updatedAt, table.id),
  companyDocumentDateCursorIdx: index('documents_company_document_date_cursor_idx').on(table.companyId, table.documentDate, table.id),
  companyStatusCreatedCursorIdx: index('documents_company_status_created_cursor_idx').on(table.companyId, table.generationStatus, table.createdAt, table.id),
  companyTypeCreatedCursorIdx: index('documents_company_type_created_cursor_idx').on(table.companyId, table.documentType, table.createdAt, table.id),
  companyCreatorCreatedCursorIdx: index('documents_company_creator_created_cursor_idx').on(table.companyId, table.createdByMembershipId, table.createdAt, table.id),
  companyStatusDocumentDateCursorIdx: index('documents_company_status_document_date_cursor_idx').on(table.companyId, table.generationStatus, table.documentDate, table.id),
  companyTypeDocumentDateCursorIdx: index('documents_company_type_document_date_cursor_idx').on(table.companyId, table.documentType, table.documentDate, table.id),
  companyCreatorDocumentDateCursorIdx: index('documents_company_creator_document_date_cursor_idx').on(table.companyId, table.createdByMembershipId, table.documentDate, table.id),
  companyTypeStatusDocumentDateCursorIdx: index('documents_company_type_status_document_date_cursor_idx').on(table.companyId, table.documentType, table.generationStatus, table.documentDate, table.id),
  searchTextTrgmIdx: index('documents_search_text_trgm_idx')
    .using('gin', table.searchText.asc().op('gin_trgm_ops')),
  totalBeforeVatNonNegative: check('documents_total_before_vat_non_negative_check', sql`${table.totalBeforeVat} >= 0`),
  vatAmountNonNegative: check('documents_vat_amount_non_negative_check', sql`${table.vatAmount} >= 0`),
  totalWithVatNonNegative: check('documents_total_with_vat_non_negative_check', sql`${table.totalWithVat} >= 0`),
  totalConsistency: check('documents_total_consistency_check', sql`${table.totalBeforeVat} + ${table.vatAmount} = ${table.totalWithVat}`),
  entityVersionPositive: check('documents_entity_version_positive_check', sql`${table.entityVersion} > 0`),
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
  oauthSessionId: varchar('oauth_session_id', { length: 128 }),
  statusPayload: jsonb('status_payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  documentUnique: uniqueIndex('tax_invoice_reservations_document_unique').on(table.documentId),
  companyNumberUnique: uniqueIndex('tax_invoice_reservations_company_number_unique').on(table.companyId, table.documentNumber),
  companyStatusCreatedIdx: index('tax_invoice_reservations_company_status_created_idx').on(table.companyId, table.status, table.createdAt),
  oauthSessionUnique: uniqueIndex('tax_invoice_reservations_oauth_session_id_unique').on(table.oauthSessionId),
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
  dispatchAttempts: integer('dispatch_attempts').notNull().default(0),
  dispatchLeaseToken: uuid('dispatch_lease_token'),
  dispatchLeaseUntil: timestamp('dispatch_lease_until', { withTimezone: true }),
  nextDispatchAt: timestamp('next_dispatch_at', { withTimezone: true }).notNull().defaultNow(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  dispatchError: text('dispatch_error'),
  processingAttempts: integer('processing_attempts').notNull().default(0),
  processingLeaseToken: uuid('processing_lease_token'),
  processingLeaseUntil: timestamp('processing_lease_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  taskKeyUnique: uniqueIndex('document_tasks_task_key_unique').on(table.taskKey),
  activeCompanyLockUnique: uniqueIndex('document_tasks_active_company_lock_unique')
    .on(table.companyId, table.taskType, table.lockKey)
    .where(sql`${table.status} in ('pending', 'queued', 'processing')`),
  userStatusIdx: index('document_tasks_user_status_idx').on(table.userId, table.status, table.createdAt),
  dispatchOutboxIdx: index('document_tasks_dispatch_outbox_idx')
    .on(table.nextDispatchAt, table.createdAt, table.id)
    .where(sql`${table.status} = 'pending' AND ${table.dispatchedAt} IS NULL`),
  dispatchAttemptsNonNegative: check(
    'document_tasks_dispatch_attempts_non_negative_check',
    sql`${table.dispatchAttempts} >= 0`,
  ),
  dispatchLeaseConsistency: check(
    'document_tasks_dispatch_lease_consistency_check',
    sql`(
      (${table.dispatchLeaseToken} IS NULL AND ${table.dispatchLeaseUntil} IS NULL)
      OR (${table.dispatchLeaseToken} IS NOT NULL AND ${table.dispatchLeaseUntil} IS NOT NULL)
    )`,
  ),
  processingAttemptsNonNegative: check(
    'document_tasks_processing_attempts_non_negative_check',
    sql`${table.processingAttempts} >= 0`,
  ),
  processingLeaseConsistency: check(
    'document_tasks_processing_lease_consistency_check',
    sql`(
      (${table.processingLeaseToken} IS NULL AND ${table.processingLeaseUntil} IS NULL)
      OR (${table.processingLeaseToken} IS NOT NULL AND ${table.processingLeaseUntil} IS NOT NULL)
    )`,
  ),
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
}, (table) => ({
  sessionCreatedIdx: index('tax_oauth_callbacks_session_created_idx').on(table.oauthSessionId, table.createdAt),
}));

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
  lastMessageIdx: index('support_conversations_last_message_idx').on(table.lastMessageAt),
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
  entityVersion: bigint('entity_version', { mode: 'bigint' }).notNull().default(sql`1`),
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
  archiveKey: varchar('archive_key', { length: 64 }).notNull(),
  dataType: varchar('data_type', { length: 32 }).notNull(),
  status: archiveStatusEnum('status').notNull().default('pending'),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull(),
  segment: integer('segment').notNull().default(1),
  docCount: integer('doc_count').notNull().default(0),
  deletedCount: integer('deleted_count').notNull().default(0),
  deleteCursor: integer('delete_cursor').notNull().default(0),
  storagePath: varchar('storage_path', { length: 1024 }),
  checksum: varchar('checksum', { length: 64 }),
  storageGeneration: bigint('storage_generation', { mode: 'bigint' }),
  idManifestPath: varchar('id_manifest_path', { length: 1024 }),
  idManifestChecksum: varchar('id_manifest_checksum', { length: 64 }),
  idManifestGeneration: bigint('id_manifest_generation', { mode: 'bigint' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  companyArchiveTypeUnique: uniqueIndex('archive_runs_company_archive_type_unique').on(table.companyId, table.archiveKey, table.dataType),
  companyTypePeriodSegmentUnique: uniqueIndex('archive_runs_company_type_period_segment_unique')
    .on(table.companyId, table.dataType, table.periodStart, table.segment),
  companyTypePeriodCursorIdx: index('archive_runs_company_type_period_cursor_idx')
    .on(table.companyId, table.dataType, table.periodStart, table.createdAt, table.id),
  companyTypeSnapshotIdx: index('archive_runs_company_type_snapshot_idx')
    .on(table.companyId, table.dataType, table.snapshotAt, table.segment),
  segmentPositive: check('archive_runs_segment_positive_check', sql`${table.segment} > 0`),
  periodValid: check(
    'archive_runs_period_check',
    sql`${table.periodStart} = (
        pg_catalog.date_trunc('month', ${table.periodStart} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      )
      AND ${table.periodEnd} = ${table.periodStart} + INTERVAL '1 month'`,
  ),
  keyPeriodValid: check(
    'archive_runs_key_period_check',
    sql`CASE
      WHEN ${table.archiveKey} ~ '^[0-9]{4}-(0?[1-9]|1[0-2])-[jd]$' THEN
        pg_catalog.split_part(${table.archiveKey}, '-', 1)::INTEGER
          = pg_catalog.extract(YEAR FROM ${table.periodStart} AT TIME ZONE 'UTC')::INTEGER
        AND pg_catalog.split_part(${table.archiveKey}, '-', 2)::INTEGER
          = pg_catalog.extract(MONTH FROM ${table.periodStart} AT TIME ZONE 'UTC')::INTEGER
        AND (
          (${table.dataType} = 'jobs' AND ${table.archiveKey} ~ '-j$')
          OR (${table.dataType} = 'documents' AND ${table.archiveKey} ~ '-d$')
        )
        AND ${table.segment} = 1
      WHEN ${table.archiveKey} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[jd]-s[0-9]{6}$' THEN
        pg_catalog.split_part(${table.archiveKey}, '-', 1)::INTEGER
          = pg_catalog.extract(YEAR FROM ${table.periodStart} AT TIME ZONE 'UTC')::INTEGER
        AND pg_catalog.split_part(${table.archiveKey}, '-', 2)::INTEGER
          = pg_catalog.extract(MONTH FROM ${table.periodStart} AT TIME ZONE 'UTC')::INTEGER
        AND (
          (${table.dataType} = 'jobs' AND ${table.archiveKey} ~ '-j-s[0-9]{6}$')
          OR (${table.dataType} = 'documents' AND ${table.archiveKey} ~ '-d-s[0-9]{6}$')
        )
        AND pg_catalog.split_part(${table.archiveKey}, '-s', 2)::INTEGER = ${table.segment}
      ELSE false
    END`,
  ),
  countsValid: check(
    'archive_runs_counts_check',
    sql`${table.docCount} >= 0 AND ${table.deletedCount} >= 0 AND ${table.deleteCursor} >= 0
      AND ${table.deletedCount} <= ${table.docCount}
      AND ${table.deleteCursor} <= ${table.docCount}`,
  ),
}));

const webSessions = privateSchema.table('web_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionTokenHash: bytea('session_token_hash').notNull(),
  csrfTokenHash: bytea('csrf_token_hash').notNull(),
  userId: uuid('user_id').notNull(),
  supabaseSessionId: uuid('supabase_session_id').notNull(),
  credentialsCiphertext: bytea('credentials_ciphertext').notNull(),
  credentialsIv: bytea('credentials_iv').notNull(),
  credentialsAuthTag: bytea('credentials_auth_tag').notNull(),
  encryptionKeyVersion: text('encryption_key_version').notNull(),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  lastCompanyId: uuid('last_company_id').references(() => companies.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revocationReason: text('revocation_reason'),
}, (table) => ({
  tokenHashUnique: uniqueIndex('web_sessions_token_hash_unique').on(table.sessionTokenHash),
  activeUserExpiryIdx: index('web_sessions_active_user_expiry_idx')
    .on(table.userId, table.absoluteExpiresAt)
    .where(sql`${table.revokedAt} IS NULL`),
  expiryIdx: index('web_sessions_expiry_idx').on(table.absoluteExpiresAt),
  lastCompanyIdx: index('web_sessions_last_company_idx').on(table.lastCompanyId),
  tokenHashLength: check('web_sessions_token_hash_length_check', sql`octet_length(${table.sessionTokenHash}) = 32`),
  csrfHashLength: check('web_sessions_csrf_hash_length_check', sql`octet_length(${table.csrfTokenHash}) = 32`),
  credentialsIvLength: check('web_sessions_credentials_iv_length_check', sql`octet_length(${table.credentialsIv}) = 12`),
  credentialsAuthTagLength: check('web_sessions_credentials_auth_tag_length_check', sql`octet_length(${table.credentialsAuthTag}) = 16`),
  credentialsPresent: check('web_sessions_credentials_present_check', sql`octet_length(${table.credentialsCiphertext}) > 0`),
  keyVersionPresent: check('web_sessions_key_version_present_check', sql`btrim(${table.encryptionKeyVersion}) <> ''`),
  absoluteLifetime: check(
    'web_sessions_absolute_lifetime_check',
    sql`${table.absoluteExpiresAt} > ${table.createdAt} AND ${table.absoluteExpiresAt} <= ${table.createdAt} + interval '12 hours'`,
  ),
  validRevocation: check(
    'web_sessions_valid_revocation_check',
    sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`,
  ),
}));

const apiIdempotency = privateSchema.table('api_idempotency', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  operation: varchar('operation', { length: 128 }).notNull(),
  idempotencyKeyHash: bytea('idempotency_key_hash').notNull(),
  requestHash: bytea('request_hash').notNull(),
  responseStatus: smallint('response_status'),
  responseBody: jsonb('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => ({
  tenantKeyUnique: uniqueIndex('api_idempotency_tenant_key_unique')
    .on(table.userId, table.companyId, table.operation, table.idempotencyKeyHash)
    .where(sql`${table.companyId} IS NOT NULL`),
  globalKeyUnique: uniqueIndex('api_idempotency_global_key_unique')
    .on(table.userId, table.operation, table.idempotencyKeyHash)
    .where(sql`${table.companyId} IS NULL`),
  expiryIdx: index('api_idempotency_expiry_idx').on(table.expiresAt),
  keyHashLength: check('api_idempotency_key_hash_length_check', sql`octet_length(${table.idempotencyKeyHash}) = 32`),
  requestHashLength: check('api_idempotency_request_hash_length_check', sql`octet_length(${table.requestHash}) = 32`),
  operationPresent: check('api_idempotency_operation_present_check', sql`btrim(${table.operation}) <> ''`),
  validExpiry: check('api_idempotency_valid_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  completedResponse: check(
    'api_idempotency_completed_response_check',
    sql`(${table.completedAt} IS NULL AND ${table.responseStatus} IS NULL AND ${table.responseBody} IS NULL)
      OR (${table.completedAt} IS NOT NULL AND ${table.responseStatus} BETWEEN 100 AND 599 AND ${table.responseBody} IS NOT NULL)`,
  ),
}));

const documentEmailDeliveries = privateSchema.table('document_email_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  status: emailDeliveryStatusEnum('status').notNull().default('queued'),
  recipientEmail: varchar('recipient_email', { length: 320 }).notNull(),
  dispatchAttempts: integer('dispatch_attempts').notNull().default(0),
  dispatchLeaseToken: uuid('dispatch_lease_token'),
  dispatchLeaseUntil: timestamp('dispatch_lease_until', { withTimezone: true }),
  nextDispatchAt: timestamp('next_dispatch_at', { withTimezone: true }).notNull().defaultNow(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  sendAttempts: integer('send_attempts').notNull().default(0),
  sendLeaseToken: uuid('send_lease_token'),
  sendLeaseUntil: timestamp('send_lease_until', { withTimezone: true }),
  providerMessageId: varchar('provider_message_id', { length: 256 }),
  lastError: text('last_error'),
  manualRetryCount: integer('manual_retry_count').notNull().default(0),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  documentUnique: uniqueIndex('document_email_deliveries_document_unique').on(table.documentId),
  companyStatusCreatedIdx: index('document_email_deliveries_company_status_created_idx')
    .on(table.companyId, table.status, table.createdAt),
  dispatchQueueIdx: index('document_email_deliveries_dispatch_queue_idx')
    .on(table.nextDispatchAt, table.createdAt, table.id)
    .where(sql`${table.status} = 'queued' AND ${table.dispatchedAt} IS NULL`),
  dispatchAttemptsValid: check(
    'document_email_deliveries_dispatch_attempts_check',
    sql`${table.dispatchAttempts} BETWEEN 0 AND 100`,
  ),
  sendAttemptsValid: check(
    'document_email_deliveries_send_attempts_check',
    sql`${table.sendAttempts} BETWEEN 0 AND 100`,
  ),
  manualRetryCountValid: check(
    'document_email_deliveries_manual_retry_count_check',
    sql`${table.manualRetryCount} BETWEEN 0 AND 20`,
  ),
  dispatchLeaseConsistency: check(
    'document_email_deliveries_dispatch_lease_check',
    sql`(
      (${table.dispatchLeaseToken} IS NULL AND ${table.dispatchLeaseUntil} IS NULL)
      OR (${table.dispatchLeaseToken} IS NOT NULL AND ${table.dispatchLeaseUntil} IS NOT NULL)
    )`,
  ),
  sendLeaseConsistency: check(
    'document_email_deliveries_send_lease_check',
    sql`(
      (${table.status} = 'sending' AND ${table.sendLeaseToken} IS NOT NULL AND ${table.sendLeaseUntil} IS NOT NULL)
      OR (${table.status} <> 'sending' AND ${table.sendLeaseToken} IS NULL AND ${table.sendLeaseUntil} IS NULL)
    )`,
  ),
  sentStateConsistency: check(
    'document_email_deliveries_sent_state_check',
    sql`(
      (${table.status} = 'sent' AND ${table.sentAt} IS NOT NULL AND ${table.providerMessageId} IS NOT NULL)
      OR (${table.status} <> 'sent' AND ${table.sentAt} IS NULL)
    )`,
  ),
  recipientPresent: check(
    'document_email_deliveries_recipient_check',
    sql`char_length(btrim(${table.recipientEmail})) BETWEEN 3 AND 320
      AND ${table.recipientEmail} ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'`,
  ),
}));

const taxSubmissions = privateSchema.table('tax_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  reservationId: uuid('reservation_id').notNull().references(() => taxInvoiceReservations.id, { onDelete: 'cascade' }),
  correlationId: varchar('correlation_id', { length: 128 }).notNull(),
  requestedByUserId: text('requested_by_user_id').notNull().references(() => appUsers.id, { onDelete: 'restrict' }),
  status: taxSubmissionStatusEnum('status').notNull().default('queued'),
  requestPayload: jsonb('request_payload').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  leaseToken: uuid('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  authorityRequestId: varchar('authority_request_id', { length: 256 }),
  responsePayload: jsonb('response_payload'),
  lastError: text('last_error'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  documentUnique: uniqueIndex('tax_submissions_document_unique').on(table.documentId),
  reservationUnique: uniqueIndex('tax_submissions_reservation_unique').on(table.reservationId),
  correlationUnique: uniqueIndex('tax_submissions_correlation_unique').on(table.correlationId),
  queueIdx: index('tax_submissions_queue_idx')
    .on(table.nextAttemptAt, table.createdAt, table.id)
    .where(sql`${table.status} = 'queued'`),
  companyStatusCreatedIdx: index('tax_submissions_company_status_created_idx')
    .on(table.companyId, table.status, table.createdAt),
  attemptsValid: check(
    'tax_submissions_attempt_count_check',
    sql`${table.attemptCount} BETWEEN 0 AND 100`,
  ),
  leaseConsistency: check(
    'tax_submissions_lease_check',
    sql`(
      (${table.status} = 'submitting' AND ${table.leaseToken} IS NOT NULL AND ${table.leaseUntil} IS NOT NULL)
      OR (${table.status} <> 'submitting' AND ${table.leaseToken} IS NULL AND ${table.leaseUntil} IS NULL)
    )`,
  ),
  correlationPresent: check(
    'tax_submissions_correlation_check',
    sql`char_length(btrim(${table.correlationId})) BETWEEN 8 AND 128`,
  ),
  requestObject: check(
    'tax_submissions_request_payload_check',
    sql`jsonb_typeof(${table.requestPayload}) = 'object'`,
  ),
}));

const archiveRunLeases = privateSchema.table('archive_run_leases', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  archiveKey: varchar('archive_key', { length: 64 }).notNull(),
  dataType: varchar('data_type', { length: 32 }).notNull(),
  status: archiveRunLeaseStatusEnum('status').notNull().default('pending'),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull(),
  segment: integer('segment').notNull().default(1),
  leaseToken: uuid('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyArchiveTypeUnique: uniqueIndex('archive_run_leases_company_archive_type_unique')
    .on(table.companyId, table.archiveKey, table.dataType),
  queueIdx: index('archive_run_leases_queue_idx')
    .on(table.status, table.leaseUntil, table.createdAt),
  periodValid: check(
    'archive_run_leases_period_check',
    sql`${table.periodEnd} > ${table.periodStart} AND ${table.snapshotAt} >= ${table.periodEnd}`,
  ),
  segmentPositive: check('archive_run_leases_segment_positive_check', sql`${table.segment} > 0`),
  attemptsValid: check(
    'archive_run_leases_attempt_count_check',
    sql`${table.attemptCount} BETWEEN 0 AND 100`,
  ),
  dataTypeAllowed: check(
    'archive_run_leases_data_type_check',
    sql`${table.dataType} IN ('jobs', 'documents')`,
  ),
  leaseConsistency: check(
    'archive_run_leases_lease_check',
    sql`(
      (${table.status} = 'leased' AND ${table.leaseToken} IS NOT NULL AND ${table.leaseUntil} IS NOT NULL)
      OR (${table.status} <> 'leased' AND ${table.leaseToken} IS NULL AND ${table.leaseUntil} IS NULL)
    )`,
  ),
}));

const fileUploadSessions = privateSchema.table('file_upload_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  purpose: varchar('purpose', { length: 64 }).notNull(),
  targetJobId: uuid('target_job_id').references(() => jobs.id, { onDelete: 'restrict' }),
  bucketId: text('bucket_id').notNull(),
  objectPrefix: text('object_prefix').notNull(),
  expectedManifest: jsonb('expected_manifest').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  consumedByJobId: uuid('consumed_by_job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  cleanupLeaseExpiresAt: timestamp('cleanup_lease_expires_at', { withTimezone: true }),
  cleanupAttempts: integer('cleanup_attempts').notNull().default(0),
  lastCleanupError: text('last_cleanup_error'),
  signingFailures: integer('signing_failures').notNull().default(0),
  lastSigningError: text('last_signing_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pendingOwnerExpiryIdx: index('file_upload_sessions_pending_owner_expiry_idx')
    .on(table.userId, table.companyId, table.expiresAt)
    .where(sql`${table.status} = 'pending'`),
  cleanupQueueIdx: index('file_upload_sessions_cleanup_queue_idx')
    .on(table.status, table.cleanupLeaseExpiresAt, table.expiresAt),
  targetJobIdx: index('file_upload_sessions_target_job_idx')
    .on(table.companyId, table.targetJobId)
    .where(sql`${table.targetJobId} IS NOT NULL`),
  purposeAllowed: check(
    'file_upload_sessions_purpose_check',
    sql`${table.purpose} IN ('job.create_finished', 'job.complete_assigned')`,
  ),
  statusAllowed: check(
    'file_upload_sessions_status_check',
    sql`${table.status} IN ('pending', 'consumed', 'cleanup_pending', 'cleanup_claimed', 'cleanup_complete', 'cleanup_failed')`,
  ),
  manifestShape: check(
    'file_upload_sessions_manifest_shape_check',
    sql`jsonb_typeof(${table.expectedManifest}) = 'array'
      AND jsonb_array_length(${table.expectedManifest}) BETWEEN 1 AND 20`,
  ),
  validExpiry: check('file_upload_sessions_valid_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  completionTarget: check(
    'file_upload_sessions_completion_target_check',
    sql`${table.purpose} <> 'job.complete_assigned' OR ${table.targetJobId} IS NOT NULL`,
  ),
  consumptionState: check(
    'file_upload_sessions_consumption_state_check',
    sql`(${table.status} = 'consumed' AND ${table.consumedAt} IS NOT NULL AND ${table.consumedByJobId} IS NOT NULL)
      OR (${table.status} <> 'consumed' AND ${table.consumedAt} IS NULL AND ${table.consumedByJobId} IS NULL)`,
  ),
  cleanupAttemptsNonNegative: check(
    'file_upload_sessions_cleanup_attempts_non_negative_check',
    sql`${table.cleanupAttempts} BETWEEN 0 AND 5`,
  ),
  cleanupErrorLength: check(
    'file_upload_sessions_cleanup_error_length_check',
    sql`${table.lastCleanupError} IS NULL OR char_length(${table.lastCleanupError}) <= 500`,
  ),
  signingFailuresValid: check(
    'file_upload_sessions_signing_failures_check',
    sql`${table.signingFailures} BETWEEN 0 AND 3`,
  ),
  signingErrorLength: check(
    'file_upload_sessions_signing_error_length_check',
    sql`${table.lastSigningError} IS NULL OR char_length(${table.lastSigningError}) <= 500`,
  ),
  cleanupLeaseState: check(
    'file_upload_sessions_cleanup_lease_state_check',
    sql`(${table.status} = 'cleanup_claimed' AND ${table.cleanupLeaseExpiresAt} IS NOT NULL)
      OR (${table.status} <> 'cleanup_claimed' AND ${table.cleanupLeaseExpiresAt} IS NULL)`,
  ),
}));

const pushDevices = privateSchema.table('push_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  deviceIdHash: bytea('device_id_hash').notNull(),
  pushToken: varchar('push_token', { length: 500 }).notNull(),
  platform: varchar('platform', { length: 32 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userDeviceUnique: uniqueIndex('push_devices_user_device_unique')
    .on(table.userId, table.deviceIdHash),
  tokenUnique: uniqueIndex('push_devices_token_unique').on(table.pushToken),
  userUpdatedIdx: index('push_devices_user_updated_idx').on(table.userId, table.updatedAt),
  deviceHashLength: check(
    'push_devices_device_hash_length_check',
    sql`octet_length(${table.deviceIdHash}) = 32`,
  ),
  tokenPresent: check(
    'push_devices_token_present_check',
    sql`char_length(btrim(${table.pushToken})) BETWEEN 8 AND 500`,
  ),
  platformAllowed: check(
    'push_devices_platform_check',
    sql`${table.platform} IN ('ios', 'android')`,
  ),
}));

export { accountTypeEnum, apiIdempotency, appUsers, archiveRunLeases, archiveRuns, auditLogs, clients, companies, companyCounters, companyInvites, companyMemberships, companyProfiles, companySyncState, companySubscriptions, contactRequests, documentEmailDeliveries, documentItems, documentJobLinks, documentTasks, documents, fileUploadSessions, inventoryBalances, inventoryLocations, inventoryMovements, inventoryParts, jobAttachments, jobPartUsages, jobs, notificationDeliveries, orphanedUserCleanupMarkers, proposalUsage, pushDevices, rateLimitBuckets, supportConversations, supportMessages, systemCounters, taxAuthorityTokens, taxInvoiceIdempotency, taxInvoiceReservations, taxOauthCallbacks, taxOauthSessions, taxSubmissions, upgradeRequests, webSessions };
