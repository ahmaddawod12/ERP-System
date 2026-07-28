import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function createRequestId(request: IncomingMessage): string {
  const candidate = request.headers["x-request-id"];
  return typeof candidate === "string" && REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : randomUUID();
}
