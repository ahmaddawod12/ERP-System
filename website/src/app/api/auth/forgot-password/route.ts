import { NextResponse } from "next/server.js";
import { serverSendPasswordReset } from "@/lib/auth/server-firebase";
import { parseWebsiteOrigin } from "@/lib/auth/opaque-session";
import { z } from "zod";

export const runtime = "nodejs";

const RecoveryEmailSchema = z.string().trim().email().max(320);

function genericResponse() {
  return NextResponse.json({ ok: true }, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}

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
    const parsedEmail = RecoveryEmailSchema.safeParse(body.email);
    if (parsedEmail.success) {
      await serverSendPasswordReset(parsedEmail.data, `${websiteOrigin}/auth/confirm`)
        .catch(() => undefined);
    }
    return genericResponse();
  } catch {
    // Configuration and upstream failures are deliberately indistinguishable
    // from an unknown address to prevent account enumeration.
    return genericResponse();
  }
}
