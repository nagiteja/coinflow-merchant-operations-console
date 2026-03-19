import { scheduleWebhookDeliveryForEvent } from "@/lib/simulator";
import { store } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  context: { params: Promise<{ eventId: string }> }
) {
  const body = await req.json().catch(() => ({} as any));
  const kind = String(body?.kind ?? "RESEND").toUpperCase();
  const reason = kind === "DUPLICATE" ? "DUPLICATE" : "RESEND";

  const params = await context.params;
  const eventId = params.eventId;
  const currentAttemptCount = store.deliveryAttempts.filter(
    (a) => a.eventId === eventId
  ).length;

  if (!store.webhookEvents[eventId]) {
    return Response.json({ error: "event_not_found" }, { status: 404 });
  }

  scheduleWebhookDeliveryForEvent({ eventId, reason: reason as any });

  const scheduledAttemptNumber = currentAttemptCount + 1;

  return Response.json(
    { scheduled: true, eventId, attemptNumber: scheduledAttemptNumber },
    { status: 200 }
  );
}

