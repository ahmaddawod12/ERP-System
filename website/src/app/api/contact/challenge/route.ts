import { handleRouteError } from "@/lib/api/response";
import { createContactChallenge } from "@/lib/contact/challenge";

export const runtime = "nodejs";

export async function GET() {
  try {
    const challenge = await createContactChallenge();
    return new Response(JSON.stringify(challenge), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
