import {
  DocumentDispatchMessageSchema,
  EmailDispatchMessageSchema,
} from "@smart-job/api-contracts";
import { z } from "zod";

import type { DocumentTaskPublisher } from "./dispatch.js";
import type { EmailDeliveryPublisher } from "./email-dispatch.js";

const metadataTokenSchema = z.object({
  access_token: z.string().trim().min(20),
  expires_in: z.number().int().positive(),
  token_type: z.string().trim().min(1),
}).passthrough();

const publishResponseSchema = z.object({
  messageIds: z.array(z.string().trim().min(1)).min(1),
}).passthrough();

export interface PubSubDocumentPublisherConfig {
  readonly projectId: string;
  readonly previewTopic: string;
  readonly generateTopic: string;
}

export interface PubSubEmailPublisherConfig {
  readonly projectId: string;
  readonly topic: string;
}

export interface PubSubDocumentPublisherOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly metadataTokenUrl?: string;
  readonly now?: () => number;
}

interface CachedAccessToken {
  readonly value: string;
  readonly refreshAt: number;
}

const DEFAULT_METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

class MetadataAccessTokenProvider {
  readonly #fetch: typeof fetch;
  readonly #url: string;
  readonly #now: () => number;
  #cached: CachedAccessToken | undefined;
  #inflight: Promise<string> | undefined;

  constructor(options: PubSubDocumentPublisherOptions) {
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#url = options.metadataTokenUrl ?? DEFAULT_METADATA_TOKEN_URL;
    this.#now = options.now ?? Date.now;
  }

  async get(): Promise<string> {
    if (this.#cached !== undefined && this.#cached.refreshAt > this.#now()) {
      return this.#cached.value;
    }
    if (this.#inflight !== undefined) return this.#inflight;
    this.#inflight = this.#load().finally(() => {
      this.#inflight = undefined;
    });
    return this.#inflight;
  }

  async #load(): Promise<string> {
    const response = await this.#fetch(this.#url, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      throw new Error(`Cloud metadata token request failed with status ${response.status}`);
    }
    const token = metadataTokenSchema.parse(await response.json());
    const usableLifetimeMs = Math.max(1_000, (token.expires_in - 60) * 1_000);
    this.#cached = {
      value: token.access_token,
      refreshAt: this.#now() + usableLifetimeMs,
    };
    return token.access_token;
  }
}

export function createPubSubDocumentTaskPublisher(
  config: PubSubDocumentPublisherConfig,
  options: PubSubDocumentPublisherOptions = {},
): DocumentTaskPublisher {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const tokenProvider = new MetadataAccessTokenProvider(options);
  const topicByTaskType = {
    preview: config.previewTopic,
    generate: config.generateTopic,
  } as const;

  return {
    async publish(taskType, message): Promise<void> {
      const payload = DocumentDispatchMessageSchema.parse(message);
      const accessToken = await tokenProvider.get();
      const topic = topicByTaskType[taskType];
      const url = `https://pubsub.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/topics/${encodeURIComponent(topic)}:publish`;
      const response = await fetchImplementation(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{
            data: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
            attributes: { taskType },
          }],
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(`Pub/Sub publish failed with status ${response.status}`);
      }
      publishResponseSchema.parse(await response.json());
    },
  };
}

export function createPubSubEmailDeliveryPublisher(
  config: PubSubEmailPublisherConfig,
  options: PubSubDocumentPublisherOptions = {},
): EmailDeliveryPublisher {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const tokenProvider = new MetadataAccessTokenProvider(options);

  return {
    async publish(message): Promise<void> {
      const payload = EmailDispatchMessageSchema.parse(message);
      const accessToken = await tokenProvider.get();
      const url = `https://pubsub.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/topics/${encodeURIComponent(config.topic)}:publish`;
      const response = await fetchImplementation(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{
            data: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
          }],
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(`Pub/Sub publish failed with status ${response.status}`);
      }
      publishResponseSchema.parse(await response.json());
    },
  };
}
