import { store } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ eventId: string }> }
) {
  const params = await context.params;
  const attempts = store.deliveryAttempts
    .filter((a) => a.eventId === params.eventId)
    .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));

  return Response.json({ eventId: params.eventId, attempts }, { status: 200 });
}

