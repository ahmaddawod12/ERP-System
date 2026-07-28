import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  NormalizedTaxCallbackSchema,
  type NormalizedTaxCallback,
  type TaxCallbackEnvelope,
} from "./contracts.js";
import { TaxGatewayError, invalidRequest } from "./errors.js";

const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/;
const TIMESTAMP_PATTERN = /^[0-9]{10}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface CallbackAuthenticationInput {
  readonly eventId: string;
  readonly timestamp: string;
  readonly signature: string;
  readonly encodedData: string;
}

export interface TaxCallbackAuthenticator {
  verify(input: CallbackAuthenticationInput): void;
}

function signaturePayload(input: Omit<CallbackAuthenticationInput, "signature">): string {
  return `${input.timestamp}\n${input.eventId}\n${input.encodedData}`;
}

export function createCallbackSignature(
  secret: string,
  input: Omit<CallbackAuthenticationInput, "signature">,
): string {
  return `sha256=${createHmac("sha256", secret).update(signaturePayload(input)).digest("hex")}`;
}

function authenticationFailure(): TaxGatewayError {
  return new TaxGatewayError(
    401,
    "INVALID_CALLBACK_AUTHENTICATION",
    "The tax callback could not be authenticated.",
    false,
  );
}

export class HmacTaxCallbackAuthenticator implements TaxCallbackAuthenticator {
  constructor(
    private readonly secret: string,
    private readonly maxSkewSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  verify(input: CallbackAuthenticationInput): void {
    if (!EVENT_ID_PATTERN.test(input.eventId) || !TIMESTAMP_PATTERN.test(input.timestamp)) {
      throw authenticationFailure();
    }
    const timestampSeconds = Number(input.timestamp);
    const nowSeconds = Math.floor(this.now() / 1_000);
    if (
      !Number.isSafeInteger(timestampSeconds)
      || Math.abs(nowSeconds - timestampSeconds) > this.maxSkewSeconds
    ) {
      throw authenticationFailure();
    }

    const match = SIGNATURE_PATTERN.exec(input.signature);
    if (match === null || match[1] === undefined) throw authenticationFailure();
    const supplied = Buffer.from(match[1], "hex");
    const expected = Buffer.from(
      createCallbackSignature(this.secret, {
        eventId: input.eventId,
        timestamp: input.timestamp,
        encodedData: input.encodedData,
      }).slice("sha256=".length),
      "hex",
    );
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
      throw authenticationFailure();
    }
  }
}

function decodeCallbackData(encodedData: string): Buffer {
  if (
    encodedData.length % 4 !== 0
    || !BASE64_PATTERN.test(encodedData)
  ) {
    throw invalidRequest("message.data must be canonical base64-encoded JSON.");
  }
  const decoded = Buffer.from(encodedData, "base64");
  if (decoded.toString("base64") !== encodedData) {
    throw invalidRequest("message.data must be canonical base64-encoded JSON.");
  }
  return decoded;
}

export interface ParsedTaxCallback {
  readonly callback: NormalizedTaxCallback;
  readonly payloadHash: string;
}

export function parseTaxCallback(
  envelope: TaxCallbackEnvelope,
  eventId: string,
): ParsedTaxCallback {
  if (envelope.message.messageId !== undefined && envelope.message.messageId !== eventId) {
    throw invalidRequest("message.messageId must match x-sj-tax-event-id.");
  }

  const decoded = decodeCallbackData(envelope.message.data);
  let raw: unknown;
  try {
    raw = JSON.parse(decoded.toString("utf8")) as unknown;
  } catch {
    throw invalidRequest("message.data must contain valid JSON.");
  }
  const parsed = NormalizedTaxCallbackSchema.safeParse(raw);
  if (!parsed.success) {
    throw invalidRequest("message.data does not match the tax callback contract.");
  }

  return {
    callback: parsed.data,
    payloadHash: createHash("sha256").update(decoded).digest("hex"),
  };
}

export function callbackEventFingerprint(eventId: string): string {
  return createHash("sha256").update(eventId).digest("hex").slice(0, 16);
}
