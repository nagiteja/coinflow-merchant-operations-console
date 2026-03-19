import { store } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const events = Object.values(store.webhookEvents);

  const response = events.map((event) => {
    const attempts = store.deliveryAttempts
      .filter((a) => a.eventId === event.eventId)
      .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));

    const attemptCount = attempts.length;
    const lastAttempt = attempts[0];
    const firstAttempt = attempts.slice().sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt))[0];

    return {
      eventId: event.eventId,
      eventType: event.eventType,
      category: event.category,
      paymentId: event.paymentId,
      sentAt: firstAttempt?.sentAt ?? null,
      url: lastAttempt?.targetUrl ?? null,
      attemptCount,
      lastResponseCode: lastAttempt?.responseCode ?? null,
      lastResponseBody: lastAttempt?.responseBody ?? null
    };
  });

  // Oldest to newest for readability.
  response.sort((a, b) => (a.sentAt ? Date.parse(a.sentAt) : 0) - (b.sentAt ? Date.parse(b.sentAt) : 0));
  return Response.json(response, { status: 200 });
}

