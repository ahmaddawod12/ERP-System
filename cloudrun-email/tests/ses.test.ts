import assert from "node:assert/strict";
import test from "node:test";

import { GetAccountSendingEnabledCommand, SendEmailCommand, type SESClient } from "@aws-sdk/client-ses";

import type { CanonicalEmailDelivery } from "../src/database.js";
import { classifySesFailure, SesDocumentSender } from "../src/ses.js";

test("SES throttling and explicit provider 5xx failures are safe to retry", () => {
  assert.equal(classifySesFailure({ name: "Throttling", $metadata: { httpStatusCode: 429 } }), "queued");
  assert.equal(classifySesFailure({ $fault: "server", $metadata: { httpStatusCode: 503 } }), "queued");
});

test("SES provider 4xx failures are terminal", () => {
  assert.equal(
    classifySesFailure({ name: "MessageRejected", $fault: "client", $metadata: { httpStatusCode: 400 } }),
    "failed",
  );
});

test("ambiguous network failures require manual reconciliation", () => {
  assert.equal(classifySesFailure(new Error("socket closed")), "delivery_unknown");
});

test("SES sender caches readiness and escapes customer-controlled HTML", async () => {
  const commands: unknown[] = [];
  const client = {
    send: async (command: unknown) => {
      commands.push(command);
      if (command instanceof GetAccountSendingEnabledCommand) return { Enabled: true };
      return { MessageId: "ses-message-id" };
    },
  } as unknown as SESClient;
  const sender = new SesDocumentSender({
    region: "eu-central-1",
    fromEmail: "documents@example.test",
    fromName: "Smart-Job",
    credentialMode: "static",
  }, client);
  await sender.checkReadiness();
  await sender.checkReadiness();
  const delivery = {
    recipientName: "<script>customer</script>",
    recipientEmail: "customer@example.test",
    businessName: "Workflow Company",
    documentCode: "RCPT-1",
  } as CanonicalEmailDelivery;
  assert.equal(await sender.send(delivery, "https://download.example.test/file?x=1&y=2"), "ses-message-id");
  assert.equal(commands.filter((command) => command instanceof GetAccountSendingEnabledCommand).length, 1);
  const send = commands.find((command) => command instanceof SendEmailCommand) as SendEmailCommand;
  const html = send.input.Message?.Body?.Html?.Data ?? "";
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /x=1&amp;y=2/);
});

test("SES readiness and missing provider message IDs fail closed", async () => {
  const disabled = new SesDocumentSender({
    region: "eu-central-1",
    fromEmail: "documents@example.test",
    fromName: "Smart-Job",
    credentialMode: "static",
  }, {
    send: async () => ({ Enabled: false }),
  } as unknown as SESClient);
  await assert.rejects(disabled.checkReadiness(), /sending is not enabled/);

  const noMessageId = new SesDocumentSender({
    region: "eu-central-1",
    fromEmail: "documents@example.test",
    fromName: "Smart-Job",
    credentialMode: "static",
  }, {
    send: async () => ({}),
  } as unknown as SESClient);
  await assert.rejects(
    noMessageId.send({
      recipientName: null,
      recipientEmail: "customer@example.test",
      businessName: "Workflow Company",
      documentCode: "RCPT-1",
    } as CanonicalEmailDelivery, "https://download.example.test/file"),
    /without returning a message id/,
  );
});
