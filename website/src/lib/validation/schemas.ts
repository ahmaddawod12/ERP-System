import { z } from "zod";

const uidFallbackSchema = z
  .string()
  .trim()
  .min(6, "uid is too short")
  .max(128, "uid is too long")
  .optional();

const companyIdSchema = z
  .string()
  .trim()
  .min(3, "companyId is required")
  .max(80, "companyId is too long")
  .regex(/^[a-zA-Z0-9-]+$/, "companyId must only contain letters, numbers, and hyphen");

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
    uid: uidFallbackSchema,
    companyId: companyIdSchema,
    targetRole: z.enum(["Worker", "User", "Basic"]).optional().default("Worker"),
  })
  .strict();

export const joinCompanySchema = z
  .object({
    uid: uidFallbackSchema,
    email: z.string().trim().email("Valid email is required"),
    role: z.enum(["Worker", "User", "Basic"]).optional(),
    name: optionalText(120),
    phoneNumber: optionalText(40),
    companyId: companyIdSchema,
    inviteCode: requiredText(6, 32, "inviteCode").transform((value) =>
      value.toUpperCase(),
    ),
  })
  .strict();

export const createClientSchema = z
  .object({
    uid: uidFallbackSchema,
    companyId: companyIdSchema,
    requestId: requiredText(8, 120, "requestId"),
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

export const documentGenerateSchema = z
  .object({
    uid: uidFallbackSchema,
    companyId: companyIdSchema,
    type: requiredText(2, 100, "type"),
    jobId: optionalText(120),
  })
  .strict();

export const upgradeRequestSchema = z
  .object({
    uid: uidFallbackSchema,
    currentTier: z.enum(["Basic", "Solo", "Team", "Enterprise"]).optional(),
    requestedTier: z.enum(["Solo", "Team", "Enterprise"]),
    message: requiredText(10, 2000, "message"),
  })
  .strict();

export const contactRequestSchema = z
  .object({
    name: requiredText(2, 120, "name"),
    email: z.string().trim().email("Valid email is required"),
    company: requiredText(2, 140, "company"),
    message: requiredText(8, 2000, "message"),
  })
  .strict();
