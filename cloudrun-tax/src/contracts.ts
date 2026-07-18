import { z } from "zod";

const sensitiveValueSchema = z.string().min(1).max(16_384);
const optionalBoundedText = z.string().trim().min(1).max(2_000).optional();

export const OAuthTokenExchangeRequestSchema = z.discriminatedUnion("grantType", [
  z.object({
    grantType: z.literal("authorization_code"),
    code: sensitiveValueSchema,
    redirectUri: z.url(),
    codeVerifier: sensitiveValueSchema.optional(),
  }).strict(),
  z.object({
    grantType: z.literal("refresh_token"),
    refreshToken: sensitiveValueSchema,
  }).strict(),
  z.object({
    grantType: z.literal("client_credentials"),
  }).strict(),
]);

export type OAuthTokenExchangeRequest = z.infer<typeof OAuthTokenExchangeRequestSchema>;

export const OAuthTokenResultSchema = z.object({
  accessToken: sensitiveValueSchema,
  tokenType: z.string().trim().min(1).max(64),
  expiresInSeconds: z.number().int().positive().max(31_536_000),
  refreshToken: sensitiveValueSchema.optional(),
  scope: z.string().trim().min(1).max(2_000).optional(),
}).strict();

export type OAuthTokenResult = z.infer<typeof OAuthTokenResultSchema>;

export const TaxApprovalRequestSchema = z.object({
  accessToken: sensitiveValueSchema,
  oauthSessionId: z.string().trim().min(1).max(128),
  invoice: z.record(z.string().trim().min(1).max(128), z.json()).refine(
    (value) => Object.keys(value).length > 0,
    "invoice must contain at least one field",
  ),
}).strict();

export type TaxApprovalRequest = z.infer<typeof TaxApprovalRequestSchema>;

export const TaxApprovalResultSchema = z.object({
  status: z.enum(["approved", "pending"]),
  confirmationNumber: z.string().trim().min(1).max(128).optional(),
  authorityRequestId: z.string().trim().min(1).max(256).optional(),
}).strict().superRefine((result, context) => {
  if (result.status === "approved" && result.confirmationNumber === undefined) {
    context.addIssue({
      code: "custom",
      message: "approved responses require confirmationNumber",
      path: ["confirmationNumber"],
    });
  }
});

export type TaxApprovalResult = z.infer<typeof TaxApprovalResultSchema>;

export const TaxApprovalRouteRequestSchema = z.object({
  oauthSessionId: z.string().trim().min(1).max(128),
  documentId: z.uuid(),
  invoice: z.record(z.string().trim().min(1).max(128), z.json()).refine(
    (value) => Object.keys(value).length > 0,
    "invoice must contain at least one field",
  ),
}).strict();

export type TaxApprovalRouteRequest = z.infer<typeof TaxApprovalRouteRequestSchema>;

export interface BindTaxApprovalSessionRequest {
  readonly documentId: string;
  readonly oauthSessionId: string;
  readonly requestId: string;
}

export const BindTaxApprovalSessionResultSchema = z.object({
  bound: z.literal(true),
  idempotentReplay: z.boolean(),
}).strict();

export type BindTaxApprovalSessionResult = z.infer<typeof BindTaxApprovalSessionResultSchema>;

export const TaxCallbackEnvelopeSchema = z.object({
  message: z.object({
    data: z.string().min(4).max(350_000),
    messageId: z.string().trim().min(8).max(128).optional(),
  }).strict(),
}).strict();

export type TaxCallbackEnvelope = z.infer<typeof TaxCallbackEnvelopeSchema>;

export const NormalizedTaxCallbackSchema = z.object({
  oauthSessionId: z.string().trim().min(1).max(128),
  status: z.enum(["approved", "rejected", "error"]),
  confirmationNumber: z.string().trim().min(1).max(128).optional(),
  errorCode: z.string().trim().min(1).max(128).optional(),
  errorMessage: optionalBoundedText,
  occurredAt: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((callback, context) => {
  if (callback.status === "approved" && callback.confirmationNumber === undefined) {
    context.addIssue({
      code: "custom",
      message: "approved callbacks require confirmationNumber",
      path: ["confirmationNumber"],
    });
  }
});

export type NormalizedTaxCallback = z.infer<typeof NormalizedTaxCallbackSchema>;

export interface ForwardTaxCallbackRequest {
  readonly eventId: string;
  readonly payloadHash: string;
  readonly requestId: string;
  readonly callback: NormalizedTaxCallback;
}

export const ForwardTaxCallbackResultSchema = z.object({
  processed: z.literal(true),
  idempotentReplay: z.boolean().optional(),
}).strict();

export type ForwardTaxCallbackResult = z.infer<typeof ForwardTaxCallbackResultSchema>;
