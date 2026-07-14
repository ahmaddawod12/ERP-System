import "server-only";

import type { z } from "zod";
import { loadBackendRuntimeConfig } from "./config";
import {
  createBackendTransport,
  type BackendResult,
  type BackendTransport,
} from "./transport-core";

let transport: BackendTransport | null = null;

function getBackendTransport(): BackendTransport {
  if (!transport) {
    const config = loadBackendRuntimeConfig();
    transport = createBackendTransport(config);
  }
  return transport;
}

export function backendRequest<T>(
  path: string,
  dataSchema: z.ZodType<T>,
  init?: RequestInit,
): Promise<BackendResult<T>> {
  return getBackendTransport().request(path, dataSchema, init);
}
