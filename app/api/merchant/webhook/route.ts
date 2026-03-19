import { verifyWebhookSignature, type WebhookVerificationMode } from "@/lib/webhook-signature";
import { store } from "@/lib/store";
import { enqueueProcessWebhookEvent } from "@/lib/simulator";

export const runtime = "nodejs";

function isoNow() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveFailureMode(params: { webhookInfo: Record<string, unknown> }): string {
  const envMode = (process.env.MERCHANT_WEBHOOK_FAILURE_MODE ?? "NONE").toUpperCase();
  const testControlsMode = (params.webhookInfo as any)?.__testControls?.merchantWebhookFailureMode;
  const candidate = typeof testControlsMode === "string" ? testControlsMode : envMode;
  if (candidate !== "NONE" && candidate !== "TIMEOUT_ONCE" && candidate !== "FAIL_500_RATE") return "NONE";
  return candidate;
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  const modeEnv = (process.env.WEBHOOK_VERIFICATION_MODE ?? "HMAC").toUpperCase();
  const mode: WebhookVerificationMode = modeEnv === "AUTH_HEADER" ? "AUTH_HEADER" : "HMAC";
  const secret = process.env.COINFLOW_WEBHOOK_SECRET ?? "dev-secret";

  const verified = verifyWebhookSignature({
    mode,
    secret,
    headers: req.headers,
    rawBody
  });

  if (!verified.ok) {
    return Response.json(
      { error: "signature_verification_failed", reason: verified.reason },
      { status: 401 }
    );
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventId = event?.eventId;
  const paymentId = event?.paymentId;
  const eventType = event?.eventType;

  if (!eventId || !paymentId || !eventType) {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }

  // Dedupe on eventId (at-least-once provider semantics).
  if (store.processedWebhookEventIds.has(eventId)) {
    return Response.json({ deduped: true, receivedAt: isoNow() }, { status: 200 });
  }

  const webhookInfo = (event?.data?.webhookInfo ?? {}) as Record<string, unknown>;
  const failureMode = resolveFailureMode({ webhookInfo });

  // For FAIL_500_RATE, we intentionally do not mark dedupe/processing before returning 500.
  // That way, retries truly happen until an ACK (200) occurs.
  if (failureMode === "FAIL_500_RATE") {
    const shouldFail = Math.random() < 0.5;
    if (shouldFail) {
      return Response.json({ error: "simulated_500" }, { status: 500 });
    }
  }

  // Mark processed so duplicates (retries/resends) won't double-credit entitlements.
  store.processedWebhookEventIds.add(eventId);
  enqueueProcessWebhookEvent({ eventId, paymentId });

  if (
    failureMode === "TIMEOUT_ONCE" &&
    !store.merchantFailureTimeoutOnceConsumed &&
    eventType === "Settled"
  ) {
    store.merchantFailureTimeoutOnceConsumed = true;
    // Sleep long enough to exceed the provider-side 5s timeout, simulating receiver stalls.
    await sleep(6000);
  }

  return Response.json({ deduped: false, receivedAt: isoNow(), eventType }, { status: 200 });
}

