export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(
    { status: "ok", service: "website" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
