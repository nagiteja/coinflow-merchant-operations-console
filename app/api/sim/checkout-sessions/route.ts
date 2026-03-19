import { createCheckoutSession } from "@/lib/simulator";
import type { SettlementLocation, SettlementType } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();

  const merchantId = String(body.merchantId ?? "");
  const customerId = String(body.customerId ?? "");
  const subtotalCents = Number(body.subtotalCents ?? 0);
  const settlementLocation = body.settlementLocation as SettlementLocation;
  const settlementType = (body.settlementType as SettlementType) ?? "USDC";
  const webhookInfo = (body.webhookInfo ?? {}) as Record<string, unknown>;
  const testControls = (body.testControls ?? undefined) as Record<string, unknown> | undefined;

  if (!merchantId || !customerId || !Number.isFinite(subtotalCents)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = createCheckoutSession({
    merchantId,
    customerId,
    subtotalCents,
    settlementLocation,
    settlementType,
    webhookInfo,
    testControls
  });

  return Response.json(result, { status: 201 });
}

