import { loadBackendRuntimeConfig } from "@/lib/backend/config";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const config = loadBackendRuntimeConfig();
    const response = await fetch(`${config.baseUrl}/readyz`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, 5_000)),
    });
    if (!response.ok) throw new Error("backend not ready");
    return Response.json(
      { status: "ready", service: "website" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "not_ready", service: "website" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
