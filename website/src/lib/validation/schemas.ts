import { TIER_VALUES, UPGRADEABLE_TIERS } from "@smart-job/contracts";
import { z } from "zod";

const companyIdSchema = z
  .string()
  .trim()
  .min(1, "companyId is required")
  .max(18, "companyId is too long")
  .regex(/^\d+$/, "companyId must be a numeric public company ID");

const optionalText = (max = 400) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value ?? "");

const requiredText = (min: number, max: number, fieldLabel: string) =>
  z
    .string()
    .trim()
    .min(min, `${fieldLabel} is required`)
    .max(max, `${fieldLabel} is too long`);

export const createInviteSchema = z
  .object({
    companyId: companyIdSchema,
    targetRole: z.enum(["worker", "user", "basic"]).optional().default("worker"),
  })
  .strict();

export const joinCompanySchema = z
  .object({
    email: z.string().trim().email("Valid email is required"),
    role: z.enum(["worker", "user", "basic"]).optional(),
    name: optionalText(120),
    phoneNumber: optionalText(40),
    companyId: companyIdSchema,
    inviteCode: requiredText(6, 32, "inviteCode").transform((value) =>
      value.toUpperCase(),
    ),
  })
  .strict();

export const readModelSchema = z
  .object({
    kind: z.enum([
      'bootstrap',
      'workers',
      'clients',
      'jobs',
      'documents',
      'inventory',
      'companySyncState',
      'recordById',
      'documentTask',
      'userSyncState',
    ]),
    companyId: companyIdSchema.optional(),
    includeCollections: z.boolean().optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
    afterCursor: optionalText(200),
    limit: z.number().int().min(1).max(10000).optional(),
    status: z.union([z.string(), z.array(z.string())]).optional(),
    dateField: z.enum(['createdAt', 'updatedAt', 'finishedAt', 'dueAt', 'documentDate']).optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    documentType: z.number().int().optional(),
    createdByUid: optionalText(200),
    scope: z.enum(['company', 'user']).optional(),
    targetUid: optionalText(200),
    search: optionalText(80),
    taskId: optionalText(200),
    recordId: optionalText(200),
    countOnly: z.boolean().optional(),
  })
  .strict();

export const createClientSchema = z
  .object({
    companyId: companyIdSchema,
    name: requiredText(2, 140, "name"),
    email: z
      .union([z.literal(""), z.string().trim().email("Valid email is required")])
      .optional()
      .transform((value) => value ?? ""),
    phone: optionalText(40),
    address: optionalText(240),
    notes: optionalText(2000),
    city: optionalText(120),
    vatNumber: optionalText(64),
  })
  .strict();

export const upgradeRequestSchema = z
  .object({
    currentTier: z.enum(TIER_VALUES).optional(),
    requestedTier: z.enum(UPGRADEABLE_TIERS),
    message: requiredText(10, 2000, "message"),
  })
  .strict();

export const upgradeListSchema = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

export const upgradeModerationSchema = z
  .object({
    requestId: requiredText(3, 128, "requestId"),
    status: z.enum(["approved", "rejected", "pending"]),
    moderationNote: optionalText(1000),
  })
  .strict();

export const contactRequestSchema = z
  .object({
    name: requiredText(2, 120, "name"),
    email: z.string().trim().email("Valid email is required"),
    company: requiredText(2, 140, "company"),
    message: requiredText(8, 2000, "message"),
    challenge: requiredText(1, 8, "challenge"),
    challengeToken: requiredText(1, 2048, "challengeToken"),
    website: z.string().max(0).optional(),
  })
  .strict();

export const callableProxySchema = z
  .object({
    operation: z.enum([
      "manageWorker",
      "registerBusinessV1",
      "createInviteV1",
      "joinCompanyV1",
      "createJobV1",
      "updateJobV1",
      "deleteJobV1",
      "acceptJobV1",
      "updateInventoryV1",
      "addClientV1",
      "deleteClientV1",
      "updateClientV1",
      "requestUpgradeV1",
      "listUpgradeRequestsV1",
      "moderateUpgradeRequestV1",
      "publishPreviewTask",
      "publishGenerateTask",
      "getInvoiceApproval",
      "createDocumentDownloadUrlV1",
      "updateProfileV1",
    ]),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
