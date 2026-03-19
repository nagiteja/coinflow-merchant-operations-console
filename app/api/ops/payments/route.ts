import { store } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const payments = Object.values(store.payments);

  const response = payments.map((p) => {
    const eventsForPayment = Object.values(store.webhookEvents).filter(
      (e) => e.paymentId === p.paymentId
    );
    const lastEvent = eventsForPayment
      .slice()
      .sort((a, b) => Date.parse(b.created) - Date.parse(a.created))[0];

    return {
      ...p,
      lastEventType: lastEvent?.eventType ?? null
    };
  });

  return Response.json(response, { status: 200 });
}

