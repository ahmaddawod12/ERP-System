import { NextResponse } from "next/server.js";
import { serverResetPassword } from "@/lib/auth/server-supabase";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { accessToken?: string; password?: string };
    const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!accessToken || !password) {
      return NextResponse.json(
        { ok: false, error: "Reset token and password are required" },
        { status: 400 },
      );
    }

    const result = await serverResetPassword(accessToken, password);
    return NextResponse.json({ ok: true, user: result.user || null });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to reset password" },
      { status: 400 },
    );
  }
}
