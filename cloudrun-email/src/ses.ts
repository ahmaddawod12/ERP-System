import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";

import type { EmailWorkerConfig } from "./config.js";
import type { CanonicalEmailDelivery } from "./database.js";

export type SesFailureOutcome = "queued" | "failed" | "delivery_unknown";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function classifySesFailure(error: unknown): SesFailureOutcome {
  if (!error || typeof error !== "object") return "delivery_unknown";
  const value = error as {
    name?: unknown;
    $fault?: unknown;
    $retryable?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const name = String(value.name ?? "");
  const status = Number(value.$metadata?.httpStatusCode ?? 0);
  if (status === 429 || /throttl|too.?many/i.test(name)) return "queued";
  if (status >= 500 || value.$fault === "server" || value.$retryable) return "queued";
  if (status >= 400 && status < 500) return "failed";
  return "delivery_unknown";
}

export function safeSesError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 2_000);
  return "SES submission failed without a definitive response";
}

export class SesDocumentSender {
  readonly #client: SESClient;
  readonly #config: EmailWorkerConfig["ses"];

  constructor(config: EmailWorkerConfig["ses"], client = new SESClient({ region: config.region })) {
    this.#config = config;
    this.#client = client;
  }

  async send(delivery: CanonicalEmailDelivery, downloadUrl: string): Promise<string> {
    const displayName = delivery.recipientName || "customer";
    const subject = `${delivery.businessName} — ${delivery.documentCode}`;
    const text = [
      `Hello ${displayName},`,
      "",
      `Your document ${delivery.documentCode} is ready:`,
      downloadUrl,
      "",
      "This private link expires automatically.",
    ].join("\n");
    const html = `<p>Hello ${escapeHtml(displayName)},</p>`
      + `<p>Your document <strong>${escapeHtml(delivery.documentCode)}</strong> is ready.</p>`
      + `<p><a href="${escapeHtml(downloadUrl)}">Download document</a></p>`
      + "<p>This private link expires automatically.</p>";
    const result = await this.#client.send(new SendEmailCommand({
      Source: `${this.#config.fromName} <${this.#config.fromEmail}>`,
      Destination: { ToAddresses: [delivery.recipientEmail] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: text, Charset: "UTF-8" },
          Html: { Data: html, Charset: "UTF-8" },
        },
      },
      Tags: [
        { Name: "workflow", Value: "document-delivery" },
      ],
    }));
    const messageId = String(result.MessageId ?? "").trim();
    if (!messageId) throw new Error("SES accepted the request without returning a message id");
    return messageId;
  }
}
