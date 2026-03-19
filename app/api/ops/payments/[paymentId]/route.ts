import { getReconciliationSummary } from "@/lib/reconciliation";
import { store } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ paymentId: string }> }
) {
  const params = await context.params;
  const payment = store.payments[params.paymentId];
  if (!payment) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const events = Object.values(store.webhookEvents)
    .filter((e) => e.paymentId === payment.paymentId)
    .sort((a, b) => Date.parse(a.created) - Date.parse(b.created));

  const attempts = store.deliveryAttempts
    .filter((a) => a.paymentId === payment.paymentId)
    .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));

  const ledgerEntries = store.ledgerEntries
    .filter((l) => l.paymentId === payment.paymentId)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const reconciliation = getReconciliationSummary({
    store,
    paymentId: payment.paymentId
  });

  return Response.json(
    {
      payment,
      events,
      attempts,
      ledgerEntries,
      settlementWallets: store.settlementWallets,
      reconciliation
    },
    { status: 200 }
  );
}

