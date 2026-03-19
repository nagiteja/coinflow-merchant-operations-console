import { completeCheckoutSession } from "@/lib/simulator";
import type { CompleteCheckoutSessionInput } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const checkoutSessionId = params.id;
  const body = await req.json();

  const input: CompleteCheckoutSessionInput = {
    paymentMethod: "CARD",
    email: String(body.email ?? ""),
    zipcode: String(body.zipcode ?? ""),
    fraudMode: body.fraudMode === "SUSPECTED_FRAUD" ? "SUSPECTED_FRAUD" : "NONE",
    idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined
  };

  if (!input.email || !input.zipcode) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = completeCheckoutSession(checkoutSessionId, input);
  return Response.json(result, { status: 200 });
}

