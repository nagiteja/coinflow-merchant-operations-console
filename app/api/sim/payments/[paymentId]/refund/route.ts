import { refundPayment } from "@/lib/simulator";
import type { RefundPaymentInput } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  context: { params: Promise<{ paymentId: string }> }
) {
  const body = await req.json();
  const input: RefundPaymentInput = { reason: String(body.reason ?? "Refund requested") };

  try {
    const params = await context.params;
    const result = refundPayment(params.paymentId, input);
    return Response.json(result, { status: 200 });
  } catch (err: any) {
    return Response.json({ error: err?.message ?? "refund_failed" }, { status: 400 });
  }
}

