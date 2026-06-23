import { NextResponse } from "next/server.js";
import { serverSendPasswordReset } from "@/lib/auth/server-supabase";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { email?: string; redirectTo?: string };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const redirectTo = typeof body.redirectTo === "string" ? body.redirectTo.trim() : undefined;

    if (!email) {
      return NextResponse.json({ ok: false, error: "Email is required" }, { status: 400 });
    }

    await serverSendPasswordReset(email, redirectTo);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to send reset email" },
      { status: 400 },
    );
  }
}
