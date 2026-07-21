import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

export const LOCAL_PLATFORM_MARKER = "smart-job-erp-local-platform-v1";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_MESSAGES_PER_PUBLISH = 100;
const MAX_DELIVERY_ATTEMPTS = 5;
const TOPIC_PATTERN = /^[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/;

function requiredText(env, name) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boundedInteger(env, name, fallback, minimum, maximum) {
  const raw = String(env[name] ?? fallback).trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function exactInternalHttpUrl(raw, name, hosts, expectedPath = "/") {
  const url = new URL(raw);
  if (
    url.protocol !== "http:"
    || !hosts.has(url.hostname)
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== expectedPath
  ) {
    throw new Error(`${name} must be an exact local-platform HTTP URL`);
  }
  return url;
}

function verifyMarker(environment, readMarker) {
  if (
    environment.SMART_JOB_DEPLOYMENT_ENV !== "local"
    || environment.SMART_JOB_LOCAL_PLATFORM !== "true"
  ) {
    throw new Error("The adapter may run only in the verified local platform");
  }
  const markerPath = requiredText(environment, "LOCAL_PLATFORM_MARKER_PATH");
  if (markerPath !== "/run/secrets/smart_job_local_platform") {
    throw new Error("LOCAL_PLATFORM_MARKER_PATH must use the Compose secret mount");
  }
  let marker;
  try {
    marker = String(readMarker(markerPath, "utf8")).trim();
  } catch (error) {
    throw new Error("The local-platform marker is unavailable", { cause: error });
  }
  if (marker !== LOCAL_PLATFORM_MARKER) {
    throw new Error("The local-platform marker is invalid");
  }
}

export function loadAdapterConfig(
  environment = process.env,
  readMarker = readFileSync,
) {
  verifyMarker(environment, readMarker);
  const adapterAccessToken = requiredText(environment, "LOCAL_ADAPTER_ACCESS_TOKEN");
  const identityToken = requiredText(environment, "LOCAL_IDENTITY_TOKEN");
  const pubsubToken = requiredText(environment, "PUBSUB_VERIFICATION_TOKEN");
  for (const [name, value] of [
    ["LOCAL_ADAPTER_ACCESS_TOKEN", adapterAccessToken],
    ["LOCAL_IDENTITY_TOKEN", identityToken],
    ["PUBSUB_VERIFICATION_TOKEN", pubsubToken],
  ]) {
    if (!TOKEN_PATTERN.test(value)) throw new Error(`${name} is invalid`);
  }

  const projectId = requiredText(environment, "LOCAL_PUBSUB_PROJECT_ID");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error("LOCAL_PUBSUB_PROJECT_ID is invalid");
  }
  const previewTopic = requiredText(environment, "LOCAL_PREVIEW_TOPIC");
  const generateTopic = requiredText(environment, "LOCAL_GENERATE_TOPIC");
  const emailTopic = requiredText(environment, "LOCAL_EMAIL_TOPIC");
  for (const topic of [previewTopic, generateTopic, emailTopic]) {
    if (!TOPIC_PATTERN.test(topic)) throw new Error("A local Pub/Sub topic is invalid");
  }
  if (new Set([previewTopic, generateTopic, emailTopic]).size !== 3) {
    throw new Error("Local Pub/Sub topics must be distinct");
  }

  const workerHosts = new Set(["cloudrun-pdf", "cloudrun-email"]);
  const apiHosts = new Set(["cloudrun-api"]);
  const infrastructureHosts = new Set(["gcs-emulator", "mailpit"]);
  return {
    host: requiredText(environment, "HOST"),
    port: boundedInteger(environment, "PORT", 8090, 1, 65_535),
    dataDirectory: requiredText(environment, "LOCAL_ADAPTER_DATA_DIR"),
    adapterAccessToken,
    identityToken,
    pubsubToken,
    projectId,
    topicTargets: new Map([
      [previewTopic, exactInternalHttpUrl(
        requiredText(environment, "LOCAL_PREVIEW_PUSH_URL"),
        "LOCAL_PREVIEW_PUSH_URL",
        workerHosts,
        "/preview",
      )],
      [generateTopic, exactInternalHttpUrl(
        requiredText(environment, "LOCAL_GENERATE_PUSH_URL"),
        "LOCAL_GENERATE_PUSH_URL",
        workerHosts,
        "/generate",
      )],
      [emailTopic, exactInternalHttpUrl(
        requiredText(environment, "LOCAL_EMAIL_PUSH_URL"),
        "LOCAL_EMAIL_PUSH_URL",
        workerHosts,
        "/deliver",
      )],
    ]),
    documentDrainUrl: exactInternalHttpUrl(
      requiredText(environment, "LOCAL_DOCUMENT_DRAIN_URL"),
      "LOCAL_DOCUMENT_DRAIN_URL",
      apiHosts,
      "/internal/v1/document-dispatch/drain",
    ),
    emailDrainUrl: exactInternalHttpUrl(
      requiredText(environment, "LOCAL_EMAIL_DRAIN_URL"),
      "LOCAL_EMAIL_DRAIN_URL",
      apiHosts,
      "/internal/v1/email-dispatch/drain",
    ),
    drainIntervalMs: boundedInteger(
      environment,
      "LOCAL_DRAIN_INTERVAL_MS",
      2_000,
      500,
      60_000,
    ),
    gcsBaseUrl: exactInternalHttpUrl(
      requiredText(environment, "LOCAL_GCS_URL"),
      "LOCAL_GCS_URL",
      infrastructureHosts,
    ),
    gcsBucket: requiredText(environment, "LOCAL_GCS_BUCKET"),
    mailpitBaseUrl: exactInternalHttpUrl(
      requiredText(environment, "LOCAL_MAILPIT_URL"),
      "LOCAL_MAILPIT_URL",
      infrastructureHosts,
    ),
  };
}

function tokenEquals(actual, expected) {
  const left = Buffer.from(String(actual ?? ""));
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function safeJson(value) {
  return JSON.stringify(value).replace(/[\u2028\u2029]/g, "");
}

async function readBody(request, maximum = MAX_REQUEST_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw Object.assign(new Error("request body too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response, statusCode, value) {
  const body = safeJson(value);
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function messageRecord(raw, topic, projectId, now) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("message is invalid");
  const data = String(raw.data ?? "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new Error("message data is not canonical base64");
  }
  const decoded = Buffer.from(data, "base64");
  if (decoded.length < 1 || decoded.length > 64 * 1024) throw new Error("message data size is invalid");
  const attributes = raw.attributes === undefined ? {} : raw.attributes;
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    throw new Error("message attributes are invalid");
  }
  const normalizedAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || typeof value !== "string" || value.length > 256) {
      throw new Error("message attributes are invalid");
    }
    normalizedAttributes[key] = value;
  }
  const messageId = randomUUID();
  return {
    id: messageId,
    projectId,
    topic,
    data,
    attributes: normalizedAttributes,
    attempts: 0,
    publishedAt: new Date(now).toISOString(),
    nextAttemptAt: now,
  };
}

function validStoredRecord(value) {
  return value
    && typeof value === "object"
    && typeof value.id === "string"
    && typeof value.topic === "string"
    && typeof value.projectId === "string"
    && typeof value.data === "string"
    && value.attributes
    && typeof value.attributes === "object"
    && Number.isInteger(value.attempts)
    && Number.isFinite(value.nextAttemptAt);
}

class PersistentDeliveryQueue {
  #processing = false;

  constructor(config, dependencies) {
    this.config = config;
    this.fetch = dependencies.fetchImplementation;
    this.now = dependencies.now;
    this.queueDirectory = join(config.dataDirectory, "queue");
    this.deadLetterDirectory = join(config.dataDirectory, "dead-letter");
  }

  async initialize() {
    await mkdir(this.queueDirectory, { recursive: true });
    await mkdir(this.deadLetterDirectory, { recursive: true });
  }

  async enqueue(record) {
    const destination = join(this.queueDirectory, `${record.id}.json`);
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, safeJson(record), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
  }

  async counts() {
    const [queued, deadLettered] = await Promise.all([
      readdir(this.queueDirectory),
      readdir(this.deadLetterDirectory),
    ]);
    return {
      queued: queued.filter((name) => name.endsWith(".json")).length,
      deadLettered: deadLettered.filter((name) => name.endsWith(".json")).length,
    };
  }

  async process() {
    if (this.#processing) return;
    this.#processing = true;
    try {
      const names = (await readdir(this.queueDirectory))
        .filter((name) => name.endsWith(".json"))
        .sort()
        .slice(0, 50);
      for (const name of names) {
        await this.#deliver(name);
      }
    } finally {
      this.#processing = false;
    }
  }

  async #deliver(name) {
    const path = join(this.queueDirectory, name);
    let record;
    try {
      record = JSON.parse(await readFile(path, "utf8"));
    } catch {
      await rename(path, join(this.deadLetterDirectory, name));
      return;
    }
    if (!validStoredRecord(record) || !this.config.topicTargets.has(record.topic)) {
      await rename(path, join(this.deadLetterDirectory, name));
      return;
    }
    if (record.nextAttemptAt > this.now()) return;
    const target = this.config.topicTargets.get(record.topic);
    let delivered = false;
    try {
      const response = await this.fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pubsub-token": this.config.pubsubToken,
        },
        body: safeJson({
          message: {
            data: record.data,
            messageId: record.id,
            attributes: record.attributes,
            publishTime: record.publishedAt,
          },
          subscription: `projects/${record.projectId}/subscriptions/local-${record.topic}`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      delivered = response.ok;
    } catch {
      delivered = false;
    }
    if (delivered) {
      await rm(path, { force: true });
      return;
    }
    record.attempts += 1;
    if (record.attempts >= MAX_DELIVERY_ATTEMPTS) {
      record.deadLetteredAt = new Date(this.now()).toISOString();
      await writeFile(path, safeJson(record), { encoding: "utf8", mode: 0o600 });
      await rename(path, join(this.deadLetterDirectory, name));
      return;
    }
    record.nextAttemptAt = this.now() + Math.min(30_000, 500 * (2 ** record.attempts));
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, safeJson(record), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  }
}

async function waitForService(url, fetchImplementation, attempts = 60) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImplementation(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Local dependency ${url} did not become ready`, { cause: lastError });
}

async function ensureGcsBucket(config, fetchImplementation) {
  const listUrl = new URL("storage/v1/b", config.gcsBaseUrl);
  await waitForService(listUrl, fetchImplementation);
  const bucketUrl = new URL("storage/v1/b", config.gcsBaseUrl);
  bucketUrl.searchParams.set("project", config.projectId);
  const response = await fetchImplementation(bucketUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: safeJson({ name: config.gcsBucket }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`Unable to initialize the local GCS bucket (HTTP ${response.status})`);
  }
}

function parseMailbox(value) {
  const raw = String(value ?? "").trim();
  const matched = /^(?:(.*?)\s*)?<([^<>\r\n]+)>$/.exec(raw);
  const email = (matched?.[2] ?? raw).trim();
  const name = String(matched?.[1] ?? "").replace(/^"|"$/g, "").trim();
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(email)) throw new Error("email address is invalid");
  return { Email: email, ...(name ? { Name: name } : {}) };
}

export function sesFormToMailpit(form) {
  if (form.get("Action") !== "SendEmail") throw new Error("Only SES SendEmail is supported locally");
  const source = parseMailbox(form.get("Source"));
  const recipientValues = [...form.entries()]
    .filter(([key]) => /^Destination\.ToAddresses\.member\.\d+$/.test(key))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([, value]) => parseMailbox(value));
  if (recipientValues.length < 1 || recipientValues.length > 10) {
    throw new Error("SES local delivery requires between one and ten recipients");
  }
  const subject = String(form.get("Message.Subject.Data") ?? "");
  const text = String(form.get("Message.Body.Text.Data") ?? "");
  const html = String(form.get("Message.Body.Html.Data") ?? "");
  if (!subject || subject.length > 998 || (!text && !html)) throw new Error("SES message content is invalid");
  return {
    From: source,
    To: recipientValues,
    Subject: subject,
    Text: text,
    HTML: html,
    Tags: ["document-delivery", "local-platform"],
    Headers: { "X-Smart-Job-Transport": "local-ses-adapter" },
  };
}

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character]);
}

function sesSuccessXml(messageId, requestId) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<SendEmailResponse xmlns="http://ses.amazonaws.com/doc/2010-12-01/">`
    + `<SendEmailResult><MessageId>${xmlEscape(messageId)}</MessageId></SendEmailResult>`
    + `<ResponseMetadata><RequestId>${xmlEscape(requestId)}</RequestId></ResponseMetadata>`
    + `</SendEmailResponse>`;
}

async function drain(url, config, fetchImplementation) {
  try {
    const response = await fetchImplementation(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.identityToken}`,
        "content-type": "application/json",
      },
      body: "{\"limit\":20}",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok && response.status !== 503) {
      console.warn(JSON.stringify({ severity: "WARNING", message: "local outbox drain failed", status: response.status }));
    }
  } catch (error) {
    console.warn(JSON.stringify({
      severity: "WARNING",
      message: "local outbox drain unavailable",
      error: error instanceof Error ? error.message : "unknown",
    }));
  }
}

export async function createLocalPlatformAdapter(
  config,
  dependencies = {},
) {
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const now = dependencies.now ?? Date.now;
  const queue = new PersistentDeliveryQueue(config, { fetchImplementation, now });
  let ready = false;
  let deliveryTimer;
  let drainTimer;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method === "GET" && url.pathname === "/healthz") {
        return sendJson(response, 200, { status: "ok", service: "local-platform-adapter" });
      }
      if (request.method === "GET" && url.pathname === "/readyz") {
        const counts = await queue.counts();
        return sendJson(response, ready ? 200 : 503, {
          status: ready ? "ready" : "starting",
          ...counts,
        });
      }
      if (
        request.method === "GET"
        && url.pathname === "/computeMetadata/v1/instance/service-accounts/default/token"
      ) {
        if (String(request.headers["metadata-flavor"] ?? "").toLowerCase() !== "google") {
          return sendJson(response, 403, { error: "metadata header required" });
        }
        response.setHeader("metadata-flavor", "Google");
        return sendJson(response, 200, {
          access_token: config.adapterAccessToken,
          expires_in: 3_600,
          token_type: "Bearer",
        });
      }
      if (
        request.method === "GET"
        && url.pathname === "/computeMetadata/v1/instance/service-accounts/default/identity"
      ) {
        if (String(request.headers["metadata-flavor"] ?? "").toLowerCase() !== "google") {
          return sendJson(response, 403, { error: "metadata header required" });
        }
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          "metadata-flavor": "Google",
        });
        response.end(config.identityToken);
        return;
      }
      const publishMatch = /^\/v1\/projects\/([^/]+)\/topics\/([^/:]+):publish$/.exec(url.pathname);
      if (request.method === "POST" && publishMatch) {
        const authorization = String(request.headers.authorization ?? "");
        if (!authorization.startsWith("Bearer ") || !tokenEquals(
          authorization.slice("Bearer ".length),
          config.adapterAccessToken,
        )) {
          return sendJson(response, 401, { error: "unauthorized" });
        }
        const projectId = decodeURIComponent(publishMatch[1]);
        const topic = decodeURIComponent(publishMatch[2]);
        if (projectId !== config.projectId || !config.topicTargets.has(topic)) {
          return sendJson(response, 404, { error: "unknown topic" });
        }
        const payload = JSON.parse(await readBody(request));
        if (!Array.isArray(payload?.messages) || payload.messages.length < 1 || payload.messages.length > MAX_MESSAGES_PER_PUBLISH) {
          throw new Error("messages must contain between one and 100 entries");
        }
        const records = payload.messages.map((message) => messageRecord(message, topic, projectId, now()));
        await Promise.all(records.map((record) => queue.enqueue(record)));
        sendJson(response, 200, { messageIds: records.map((record) => record.id) });
        void queue.process();
        return;
      }
      if (request.method === "POST" && (url.pathname === "/ses" || url.pathname === "/ses/")) {
        const form = new URLSearchParams(await readBody(request, 256 * 1024));
        const message = sesFormToMailpit(form);
        const mailpitUrl = new URL("api/v1/send", config.mailpitBaseUrl);
        const mailpitResponse = await fetchImplementation(mailpitUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: safeJson(message),
          signal: AbortSignal.timeout(10_000),
        });
        if (!mailpitResponse.ok) {
          throw Object.assign(new Error(`Mailpit returned HTTP ${mailpitResponse.status}`), { statusCode: 503 });
        }
        const requestId = randomUUID();
        const messageId = `${createHash("sha256").update(requestId).digest("hex").slice(0, 32)}@local.smart-job.invalid`;
        const body = sesSuccessXml(messageId, requestId);
        response.writeHead(200, {
          "content-type": "text/xml; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        });
        response.end(body);
        return;
      }
      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 400;
      sendJson(response, statusCode, { error: statusCode >= 500 ? "local dependency unavailable" : "invalid request" });
    }
  });

  return {
    server,
    async initialize() {
      await queue.initialize();
      await Promise.all([
        ensureGcsBucket(config, fetchImplementation),
        waitForService(new URL("readyz", config.mailpitBaseUrl), fetchImplementation),
      ]);
      ready = true;
      deliveryTimer = setInterval(() => void queue.process(), 500);
      deliveryTimer.unref();
      drainTimer = setInterval(() => {
        void drain(config.documentDrainUrl, config, fetchImplementation);
        void drain(config.emailDrainUrl, config, fetchImplementation);
      }, config.drainIntervalMs);
      drainTimer.unref();
      void queue.process();
    },
    async close() {
      ready = false;
      if (deliveryTimer) clearInterval(deliveryTimer);
      if (drainTimer) clearInterval(drainTimer);
      await new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
