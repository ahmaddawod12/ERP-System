import { NextResponse } from "next/server.js";
import { serverSignUp } from "@/lib/auth/server-supabase";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Email and password are required" }, { status: 400 });
    }

    const result = await serverSignUp(email, password);
    return NextResponse.json({ ok: true, user: result.user || null });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Registration failed" },
      { status: 400 },
    );
  }
}
