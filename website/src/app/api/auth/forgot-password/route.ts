import { NextResponse } from "next/server.js";
import { serverSendPasswordReset } from "@/lib/auth/server-supabase";
import { parseWebsiteOrigin } from "@/lib/auth/opaque-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const websiteOrigin = parseWebsiteOrigin(
      String(process.env.WEBSITE_ORIGIN || ""),
      process.env.NODE_ENV,
    );
    if (request.headers.get("origin") !== websiteOrigin) {
      return NextResponse.json({ ok: false, error: "Request origin is not allowed" }, {
        status: 403,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const body = (await request.json().catch(() => ({}))) as { email?: string };
    const email = typeof body.email === "string" ? body.email.trim() : "";

    if (!email || email.length > 320) {
      return NextResponse.json({ ok: false, error: "Email is required" }, { status: 400 });
    }

    await serverSendPasswordReset(email, `${websiteOrigin}/auth/confirm`);
    return NextResponse.json({ ok: true }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to send reset email" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
