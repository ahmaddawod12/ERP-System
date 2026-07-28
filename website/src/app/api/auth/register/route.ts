import { NextResponse } from "next/server.js";
import { serverSignUp } from "@/lib/auth/server-firebase";
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
    const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || email.length > 320 || password.length < 8 || password.length > 1_024) {
      return NextResponse.json({
        ok: false,
        error: "A valid email and password of at least 8 characters are required",
      }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
    }

    await serverSignUp(email, password, `${websiteOrigin}/auth/confirm`);
    return NextResponse.json({ ok: true, verificationRequired: true }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Registration failed" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
