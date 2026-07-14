import { TaxGatewayError } from "./errors.js";

export type FetchImplementation = typeof fetch;

export async function fetchWithTimeout(
  fetchImplementation: FetchImplementation,
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutCode: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();

  try {
    return await fetchImplementation(input, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new TaxGatewayError(
        504,
        timeoutCode,
        "The upstream tax operation timed out.",
        true,
      );
    }
    if (error instanceof TaxGatewayError) throw error;
    throw new TaxGatewayError(
      502,
      "UPSTREAM_UNAVAILABLE",
      "The upstream service could not be reached.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new TaxGatewayError(
      502,
      "UPSTREAM_RESPONSE_TOO_LARGE",
      "The upstream service returned an invalid response.",
      true,
    );
  }

  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new TaxGatewayError(
          502,
          "UPSTREAM_RESPONSE_TOO_LARGE",
          "The upstream service returned an invalid response.",
          true,
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

export async function readBoundedJson(response: Response, maximumBytes = 262_144): Promise<unknown> {
  let text: string;
  try {
    text = await readBoundedText(response, maximumBytes);
  } catch (error) {
    if (error instanceof TaxGatewayError) throw error;
    throw new TaxGatewayError(
      502,
      "INVALID_UPSTREAM_RESPONSE",
      "The upstream service returned an invalid response.",
      true,
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TaxGatewayError(
      502,
      "INVALID_UPSTREAM_RESPONSE",
      "The upstream service returned an invalid response.",
      true,
    );
  }
}
