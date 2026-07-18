import { EmailDispatchMessageSchema } from "@smart-job/api-contracts";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import type { EmailWorkerConfig } from "./config.js";
import type { CanonicalEmailDelivery, EmailDeliveryStore } from "./database.js";
import { classifySesFailure, safeSesError, type SesDocumentSender } from "./ses.js";

const pushEnvelopeSchema = z.object({
  message: z.object({ data: z.string().min(1).max(8_192) }).passthrough(),
}).passthrough();

export type EmailWorkerDependencies = {
  readonly config: EmailWorkerConfig;
  readonly store: Pick<EmailDeliveryStore, "claim" | "complete" | "resolveFailure">;
  readonly authorize: (authorization: string | undefined, token: string | undefined) => Promise<boolean>;
  readonly signDownload: (objectPath: string) => Promise<string>;
  readonly sender: Pick<SesDocumentSender, "send">;
};

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
      redact: {
        paths: ["req.headers.authorization", "req.headers.x-pubsub-token", "req.body"],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 64 * 1024,
    requestTimeout: 15_000,
  });

  app.get("/health", async () => ({ status: "healthy", service: "email-worker" }));

  app.post("/deliver", async (request, reply) => {
    const authorized = await deps.authorize(
      request.headers.authorization,
      typeof request.headers["x-pubsub-token"] === "string"
        ? request.headers["x-pubsub-token"]
        : undefined,
    );
    if (!authorized) return reply.code(401).send({ error: "unauthorized" });

    let message;
    try {
      const envelope = pushEnvelopeSchema.parse(request.body);
      const decoded = Buffer.from(envelope.message.data, "base64");
      if (decoded.length === 0 || decoded.length > 4_096) throw new Error("invalid payload size");
      message = EmailDispatchMessageSchema.parse(JSON.parse(decoded.toString("utf8")));
    } catch {
      // Poison messages are acknowledged so they move to observability/DLQ handling,
      // rather than retrying forever.
      return reply.code(204).send();
    }

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
  });

  return app;
}
