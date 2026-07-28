import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LOCAL_PLATFORM_MARKER,
  createLocalPlatformAdapter,
  loadAdapterConfig,
  sesFormToMailpit,
} from "../app.mjs";

const TOKEN = "local_token_012345678901234567890123456789";

function environment(dataDirectory = "/data") {
  return {
    SMART_JOB_DEPLOYMENT_ENV: "local",
    SMART_JOB_LOCAL_PLATFORM: "true",
    LOCAL_PLATFORM_MARKER_PATH: "/run/secrets/smart_job_local_platform",
    HOST: "0.0.0.0",
    PORT: "8090",
    LOCAL_ADAPTER_DATA_DIR: dataDirectory,
    LOCAL_ADAPTER_ACCESS_TOKEN: TOKEN,
    LOCAL_IDENTITY_TOKEN: `${TOKEN}_identity`,
    PUBSUB_VERIFICATION_TOKEN: `${TOKEN}_pubsub`,
    LOCAL_PUBSUB_PROJECT_ID: "smart-job-local",
    LOCAL_PREVIEW_TOPIC: "document-preview",
    LOCAL_GENERATE_TOPIC: "document-generate",
    LOCAL_EMAIL_TOPIC: "document-email",
    LOCAL_PREVIEW_PUSH_URL: "http://cloudrun-pdf:8080/preview",
    LOCAL_GENERATE_PUSH_URL: "http://cloudrun-pdf:8080/generate",
    LOCAL_EMAIL_PUSH_URL: "http://cloudrun-email:8080/deliver",
    LOCAL_DOCUMENT_DRAIN_URL: "http://cloudrun-api:8080/internal/v1/document-dispatch/drain",
    LOCAL_EMAIL_DRAIN_URL: "http://cloudrun-api:8080/internal/v1/email-dispatch/drain",
    LOCAL_DRAIN_INTERVAL_MS: "60000",
    LOCAL_GCS_URL: "http://gcs-emulator:4443",
    LOCAL_GCS_BUCKET: "smart-job-local-archives",
    LOCAL_MAILPIT_URL: "http://mailpit:8025",
  };
}

test("adapter configuration requires both flags and the mounted marker", () => {
  assert.throws(() => loadAdapterConfig(environment(), () => "wrong"), /marker is invalid/);
  assert.throws(
    () => loadAdapterConfig({ ...environment(), SMART_JOB_DEPLOYMENT_ENV: "production" }, () => LOCAL_PLATFORM_MARKER),
    /only in the verified local platform/,
  );
  assert.equal(
    loadAdapterConfig(environment(), () => LOCAL_PLATFORM_MARKER).projectId,
    "smart-job-local",
  );
});

test("SES query requests map to bounded Mailpit messages", () => {
  const form = new URLSearchParams({
    Action: "SendEmail",
    Source: "Smart-Job <local@smart-job.invalid>",
    "Destination.ToAddresses.member.1": "customer@example.com",
    "Message.Subject.Data": "Document 305-7",
    "Message.Body.Text.Data": "Download locally",
    "Message.Body.Html.Data": "<p>Download locally</p>",
  });
  assert.deepEqual(sesFormToMailpit(form), {
    From: { Email: "local@smart-job.invalid", Name: "Smart-Job" },
    To: [{ Email: "customer@example.com" }],
    Subject: "Document 305-7",
    Text: "Download locally",
    HTML: "<p>Download locally</p>",
    Tags: ["document-delivery", "local-platform"],
    Headers: { "X-Smart-Job-Transport": "local-ses-adapter" },
  });
});

test("published messages are persisted and delivered with the shared worker token", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "smart-job-local-adapter-"));
  const requests = [];
  const fetchImplementation = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("storage/v1/b") && init.method === "POST") {
      return new Response("{}", { status: 201 });
    }
    if (url.includes("storage/v1/b") || url.endsWith("/readyz")) {
      return new Response("{}", { status: 200 });
    }
    if (url.includes("/internal/v1/")) {
      return new Response("{}", { status: 503 });
    }
    requests.push({ url, init });
    return new Response(null, { status: 204 });
  };
  const config = loadAdapterConfig(environment(dataDirectory), () => LOCAL_PLATFORM_MARKER);
  const adapter = await createLocalPlatformAdapter(config, { fetchImplementation });
  try {
    await adapter.initialize();
    await new Promise((resolve) => adapter.server.listen(0, "127.0.0.1", resolve));
    const address = adapter.server.address();
    assert.ok(address && typeof address === "object");
    const sesReadiness = await fetch(`http://127.0.0.1:${address.port}/ses`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        Action: "GetAccountSendingEnabled",
        Version: "2010-12-01",
      }),
    });
    const sesReadinessBody = await sesReadiness.text();
    assert.equal(sesReadiness.status, 200, sesReadinessBody);
    assert.match(
      sesReadinessBody,
      /<GetAccountSendingEnabledResult><Enabled>true<\/Enabled><\/GetAccountSendingEnabledResult>/,
    );
    assert.equal(requests.length, 0, "SES readiness must not create a Mailpit message");
    const metadata = await fetch(`http://127.0.0.1:${address.port}/computeMetadata/v1/instance/service-accounts/default/token`, {
      headers: { "metadata-flavor": "Google" },
    });
    assert.equal(metadata.status, 200);
    assert.equal((await metadata.json()).access_token, TOKEN);
    const topic = await fetch(`http://127.0.0.1:${address.port}/v1/projects/smart-job-local/topics/document-preview`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(topic.status, 200, await topic.text());
    const payload = Buffer.from(JSON.stringify({ taskId: "00000000-0000-4000-8000-000000000001" })).toString("base64");
    const published = await fetch(`http://127.0.0.1:${address.port}/v1/projects/smart-job-local/topics/document-preview:publish`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messages: [{ data: payload, attributes: { taskType: "preview" } }] }),
    });
    assert.equal(published.status, 200, await published.text());
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "http://cloudrun-pdf:8080/preview");
    assert.equal(requests[0].init.headers["x-pubsub-token"], `${TOKEN}_pubsub`);
  } finally {
    await adapter.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
