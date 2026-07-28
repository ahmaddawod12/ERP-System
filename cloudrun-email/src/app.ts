import { EmailDispatchMessageSchema } from "@smart-job/api-contracts";
import {
  cloudLoggingTraceFields,
  withExtractedTraceContext,
  withTaskSpan,
} from "@smart-job/observability";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import type { EmailWorkerConfig } from "./config.js";
import type { CanonicalEmailDelivery, EmailDeliveryStore } from "./database.js";
import { classifySesFailure, safeSesError, type SesDocumentSender } from "./ses.js";

const pushEnvelopeSchema = z.object({
  message: z.object({
    data: z.string().min(1).max(8_192),
    attributes: z.record(z.string(), z.string().max(512)).optional(),
  }).passthrough(),
}).passthrough();

export type EmailWorkerDependencies = {
  readonly config: EmailWorkerConfig;
  readonly store: Pick<EmailDeliveryStore, "claim" | "complete" | "resolveFailure">;
  readonly authorize: (authorization: string | undefined, token: string | undefined) => Promise<boolean>;
  readonly signDownload: (objectPath: string) => Promise<string>;
  readonly sender: Pick<SesDocumentSender, "send">;
  readonly checkReadiness?: () => Promise<void>;
};

function safeHeader(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[A-Za-z0-9._:/@-]{1,256}$/.test(candidate)
    ? candidate
    : undefined;
}

function poisonMetadata(body: unknown, headers: Record<string, string | string[] | undefined>) {
  const envelope = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const message = envelope.message && typeof envelope.message === "object"
    && !Array.isArray(envelope.message)
    ? envelope.message as Record<string, unknown>
    : {};
  const attributes = message.attributes && typeof message.attributes === "object"
    && !Array.isArray(message.attributes)
    ? message.attributes as Record<string, unknown>
    : {};
  const deliveryAttempt = Number(envelope.deliveryAttempt);
  return {
    poisonMessage: true,
    topic: safeHeader(headers["x-goog-pubsub-topic"]) ?? "unknown",
    deliveryAttempt: Number.isSafeInteger(deliveryAttempt) && deliveryAttempt > 0
      ? deliveryAttempt
      : undefined,
    schemaVersion: typeof attributes.schemaVersion === "string"
      && /^[A-Za-z0-9._-]{1,32}$/.test(attributes.schemaVersion)
      ? attributes.schemaVersion
      : "unknown",
  };
}

async function withReadinessTimeout(check: () => Promise<void>): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Email readiness timed out")), 5_000);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function resolvePreSendFailure(
  deps: EmailWorkerDependencies,
  delivery: CanonicalEmailDelivery,
  error: unknown,
): Promise<void> {
  const outcome = delivery.attempt >= 10 ? "failed" : "queued";
  await deps.store.resolveFailure(delivery, outcome, safeSesError(error), 30);
}

export function buildApp(deps: EmailWorkerDependencies): FastifyInstance {
  const app = Fastify({
    logger: {
      mixin: () => cloudLoggingTraceFields(),
      redact: {
        paths: ["req.headers.authorization", "req.headers.x-pubsub-token", "req.body"],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 64 * 1024,
    requestTimeout: 15_000,
  });

  const liveness = async () => ({ status: "ok", service: "email-worker" });
  app.get("/healthz", liveness);
  app.get("/health", liveness);
  app.get("/readyz", async (request, reply) => {
    if (!deps.checkReadiness) {
      return reply.code(503).send({ status: "unavailable", service: "email-worker" });
    }
    try {
      await withReadinessTimeout(deps.checkReadiness);
      return reply.code(200).send({ status: "ready", service: "email-worker" });
    } catch (error) {
      request.log.warn({
        readinessFailure: true,
        errorType: error instanceof Error ? error.name : "UnknownError",
      }, "email readiness failed");
      return reply.code(503).send({ status: "unavailable", service: "email-worker" });
    }
  });

  app.post("/deliver", async (request, reply) => {
    const authorized = await deps.authorize(
      request.headers.authorization,
      typeof request.headers["x-pubsub-token"] === "string"
        ? request.headers["x-pubsub-token"]
        : undefined,
    );
    if (!authorized) return reply.code(401).send({ error: "unauthorized" });

    let message;
    let traceAttributes: Record<string, string> = {};
    try {
      const envelope = pushEnvelopeSchema.parse(request.body);
      traceAttributes = envelope.message.attributes ?? {};
      const decoded = Buffer.from(envelope.message.data, "base64");
      if (decoded.length === 0 || decoded.length > 4_096) throw new Error("invalid payload size");
      message = EmailDispatchMessageSchema.parse(JSON.parse(decoded.toString("utf8")));
    } catch {
      request.log.warn(
        poisonMetadata(request.body, request.headers),
        "authenticated poison Pub/Sub message rejected",
      );
      return reply.code(400).send({ error: "invalid_pubsub_message" });
    }

    return withExtractedTraceContext(traceAttributes, () => withTaskSpan(
      "email.deliver",
      { "app.operation": "email.deliver" },
      async () => {
        const delivery = await deps.store.claim(message.deliveryId, deps.config.sendLeaseSeconds);
        if (!delivery) return reply.code(204).send();

        let downloadUrl: string;
        try {
          downloadUrl = await deps.signDownload(delivery.storagePath);
        } catch (error) {
          await resolvePreSendFailure(deps, delivery, error);
          return reply.code(204).send();
        }

        let providerMessageId: string;
        try {
          providerMessageId = await deps.sender.send(delivery, downloadUrl);
        } catch (error) {
          const classified = classifySesFailure(error);
          const outcome = classified === "queued" && delivery.attempt >= 10 ? "failed" : classified;
          await deps.store.resolveFailure(delivery, outcome, safeSesError(error), 30);
          return reply.code(204).send();
        }

        // If this write fails after SES accepted the message, leave the lease intact.
        // Its expiry is converted to delivery_unknown by the next canonical claim.
        await deps.store.complete(delivery, providerMessageId);
        request.log.info({ deliveryId: delivery.deliveryId, attempt: delivery.attempt }, "document email sent");
        return reply.code(204).send();
      },
    ));
  });

  return app;
}
