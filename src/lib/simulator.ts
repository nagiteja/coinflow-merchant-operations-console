import crypto from "node:crypto";

import { store } from "./store";
import type {
  CompleteCheckoutSessionInput,
  CreateCheckoutSessionInput,
  Job,
  JobType,
  Money,
  Payment,
  RefundPaymentInput,
  SettlementLocation,
  WebhookDeliveryAttempt,
  WebhookEvent,
  WebhookEventType
} from "./types";
import type { CoinflowStore } from "./store";
import {
  buildCoinflowSignatureHeader,
  type WebhookVerificationMode
} from "./webhook-signature";
import { getReconciliationSummary } from "./reconciliation";

const WEBHOOK_TIMEOUT_MS = 5000;
const MAX_DELIVERY_ATTEMPTS = 12;
const MAX_RETRY_WINDOW_MS = 36 * 60 * 60 * 1000; // 36h (spec copy)

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function randomId(prefix = "") {
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  return prefix ? `${prefix}_${id}` : id;
}

function computeFees(subtotalCents: number): number {
  // Simple but realistic-ish: percent + fixed fee.
  const percent = Math.round(subtotalCents * 0.029);
  const fixed = 30;
  return Math.max(0, percent + fixed);
}

function centsToMoney(cents: number): Money {
  return { cents, currency: "USD" };
}

function getMerchantWebhookFailureModeFromWebhookInfo(webhookInfo: Record<string, unknown>): string | undefined {
  const testControls = (webhookInfo as any)?.__testControls;
  const mode = (testControls as any)?.merchantWebhookFailureMode;
  return typeof mode === "string" ? mode : undefined;
}

function getSettlementDelayMsFromCheckoutWebhookInfo(webhookInfo: Record<string, unknown>): number | undefined {
  const testControls = (webhookInfo as any)?.__testControls;
  const v = (testControls as any)?.settlementDelayMs;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return undefined;
}

function getCoinflowVerificationMode(): WebhookVerificationMode {
  const mode = (process.env.WEBHOOK_VERIFICATION_MODE ?? "HMAC").toUpperCase();
  return (mode === "AUTH_HEADER" ? "AUTH_HEADER" : "HMAC") as WebhookVerificationMode;
}

function getCoinflowWebhookSecret(): string {
  return process.env.COINFLOW_WEBHOOK_SECRET ?? "dev-secret";
}

function getBaseUrlForSelfWebhook(): string {
  // For Railway/production, you typically want an env var with full https://... base URL.
  const env = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.BASE_URL;
  if (env) return env.replace(/\/+$/, "");
  const port = process.env.PORT ? String(process.env.PORT) : "3000";
  return `http://localhost:${port}`;
}

function getMerchantWebhookTargetUrl(): string {
  return `${getBaseUrlForSelfWebhook()}/api/merchant/webhook`;
}

function paymentKey(merchantId: string, idempotencyKey: string) {
  return `${merchantId}:${idempotencyKey}`;
}

type CreatePaymentFromSessionPayload = {
  checkoutSessionId: string;
  paymentId: string;
  idempotencyKey?: string;
  paymentMethod: "CARD";
  email: string;
  zipcode: string;
  fraudMode?: "NONE" | "SUSPECTED_FRAUD";
  // For deterministic scenarios based on checkout creation controls.
  settlementDelayMs?: number;
};

type EmitEventPayload = {
  eventId: string;
  paymentId: string;
  eventType: WebhookEventType;
  created: string;
  dataId: string;
  signature?: string;
};

type SettlePaymentPayload = {
  paymentId: string;
};

type DeliverWebhookPayload = {
  eventId: string;
  paymentId: string;
  attemptNumber: number; // 1-based
  firstAttemptSentAtMs: number; // for 36h cap
  targetUrl: string;
};

type ProcessWebhookEventPayload = {
  eventId: string;
  paymentId: string;
};

function removeJobByIndex(index: number) {
  store.jobQueue.splice(index, 1);
}

function scheduleJob<TPayload>(type: JobType, payload: TPayload, runAtMs: number): Job {
  const job: Job<TPayload> = {
    jobId: randomId("job"),
    type,
    runAtMs,
    payload
  };
  store.jobQueue.push(job);
  return job;
}

export function createCheckoutSession(input: CreateCheckoutSessionInput) {
  const checkoutSessionId = randomId("cs");
  const createdAt = nowIso();

  // Persist scenario controls in webhookInfo so downstream jobs and the merchant receiver can read them.
  const mergedWebhookInfo = input.testControls
    ? {
        ...input.webhookInfo,
        __testControls: input.testControls
      }
    : input.webhookInfo;

  const session = {
    id: checkoutSessionId,
    merchantId: input.merchantId,
    customerId: input.customerId,
    subtotal: centsToMoney(input.subtotalCents),
    settlementType: input.settlementType,
    settlementLocation: input.settlementLocation,
    webhookInfo: mergedWebhookInfo,
    createdAt,
    status: "OPEN" as const
  };

  store.checkoutSessions[checkoutSessionId] = session;

  const checkoutUrl = `/fake-checkout/${checkoutSessionId}`;
  return { checkoutSessionId, checkoutUrl, createdAt };
}

export function completeCheckoutSession(checkoutSessionId: string, input: CompleteCheckoutSessionInput) {
  const session = store.checkoutSessions[checkoutSessionId];
  if (!session) throw new Error(`Unknown checkoutSessionId: ${checkoutSessionId}`);

  // Mark session complete (provider-side).
  session.status = "COMPLETED";

  // Idempotency: if idempotencyKey repeats, return the same paymentId and do not enqueue again.
  const idempotencyKey = input.idempotencyKey;
  if (idempotencyKey) {
    const key = paymentKey(session.merchantId, idempotencyKey);
    const existingPaymentId = store.paymentIdByIdempotencyKey[key];
    if (existingPaymentId) {
      return { paymentId: existingPaymentId };
    }
    const newPaymentId = randomId("pay");
    store.paymentIdByIdempotencyKey[key] = newPaymentId;

    const settlementDelayMs = getSettlementDelayMsFromCheckoutWebhookInfo(session.webhookInfo);
    scheduleJob<CreatePaymentFromSessionPayload>(
      "CREATE_PAYMENT_FROM_SESSION",
      {
        checkoutSessionId,
        paymentId: newPaymentId,
        idempotencyKey,
        paymentMethod: input.paymentMethod,
        email: input.email,
        zipcode: input.zipcode,
        fraudMode: input.fraudMode ?? "NONE",
        settlementDelayMs
      },
      nowMs()
    );
    return { paymentId: newPaymentId };
  }

  // Non-idempotent call: still schedule a deterministic paymentId for this request.
  const paymentId = randomId("pay");
  const settlementDelayMs = getSettlementDelayMsFromCheckoutWebhookInfo(session.webhookInfo);
  scheduleJob<CreatePaymentFromSessionPayload>(
    "CREATE_PAYMENT_FROM_SESSION",
    {
      checkoutSessionId,
      paymentId,
      paymentMethod: input.paymentMethod,
      email: input.email,
      zipcode: input.zipcode,
      fraudMode: input.fraudMode ?? "NONE",
      settlementDelayMs
    },
    nowMs()
  );
  return { paymentId };
}

function scheduleEmitEventFromJob(params: {
  paymentId: string;
  eventType: WebhookEventType;
  signature?: string;
  dataId: string;
  created?: string;
}) {
  const eventId = randomId("evt");
  scheduleJob<EmitEventPayload>(
    "EMIT_EVENT",
    {
      eventId,
      paymentId: params.paymentId,
      eventType: params.eventType,
      created: params.created ?? nowIso(),
      dataId: params.dataId,
      signature: params.signature
    },
    nowMs()
  );
  return eventId;
}

function getZipcodeOutcome(zipcode: string) {
  if (zipcode === "99999") return { status: "DECLINED" as const, eventType: "Card Payment Declined" as const };
  if (zipcode === "00000") return { status: "DECLINED" as const, eventType: "Card Payment Suspected Fraud" as const };
  return { status: "AUTHORIZED" as const, eventType: "Card Payment Authorized" as const };
}

export function refundPayment(paymentId: string, input: RefundPaymentInput) {
  const payment = store.payments[paymentId];
  if (!payment) throw new Error(`Unknown paymentId: ${paymentId}`);

  // Simplified refund: adjust wallet + record a ledger correction for NET only.
  const wallet = store.settlementWallets[payment.settlementLocation];
  wallet.usdcBalanceCents -= payment.netToMerchant.cents;
  wallet.updatedAt = nowIso();

  // Record a negative net entry for visibility.
  store.ledgerEntries.push({
    id: randomId("led"),
    paymentId,
    type: "NET_SETTLED",
    amount: centsToMoney(-payment.netToMerchant.cents),
    createdAt: nowIso(),
    notes: `Refund: ${input.reason}`
  });

  payment.status = "REFUNDED";

  // Emit refund webhook (at-least-once).
  const eventId = randomId("evt");
  scheduleJob<EmitEventPayload>(
    "EMIT_EVENT",
    {
      eventId,
      paymentId,
      eventType: "Refund",
      created: nowIso(),
      dataId: paymentId
    },
    nowMs()
  );

  return { paymentId, refundEventId: eventId };
}

async function deliverWebhookAttempt(params: {
  store: CoinflowStore;
  event: WebhookEvent;
  targetUrl: string;
  attemptNumber: number;
  firstAttemptSentAtMs: number;
}): Promise<{
  attempt: WebhookDeliveryAttempt;
  shouldRetry: boolean;
}> {
  const { event, targetUrl, attemptNumber, firstAttemptSentAtMs } = params;

  const attemptId = randomId("att");
  const sentAt = nowIso();
  const startedAtMs = nowMs();

  const verificationMode = getCoinflowVerificationMode();
  const secret = getCoinflowWebhookSecret();

  const rawBody = JSON.stringify(event);

  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (verificationMode === "HMAC") {
    const signatureHeader = buildCoinflowSignatureHeader(secret, rawBody);
    headers["Coinflow-Signature"] = signatureHeader;
  } else {
    headers["authorization"] = `Bearer ${secret}`;
  }

  let outcome: WebhookDeliveryAttempt["outcome"];
  let responseCode: number | undefined;
  let responseBody: string | undefined;
  let completedAt: string | undefined;
  let latencyMs: number | undefined;

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: rawBody,
      signal: abortController.signal
    });

    responseCode = res.status;
    const text = await res.text().catch(() => "");
    responseBody = text ? text.slice(0, 280) : undefined;
    completedAt = nowIso();
    latencyMs = nowMs() - startedAtMs;

    if (res.status === 200) outcome = "DELIVERED_200";
    else if (res.status === 401) outcome = "REJECTED_401";
    else outcome = "FAILED_500";
  } catch (err: unknown) {
    const aborted = (err as any)?.name === "AbortError";
    completedAt = nowIso();
    latencyMs = nowMs() - startedAtMs;

    if (aborted) outcome = "TIMEOUT";
    else outcome = "FAILED_500";
  } finally {
    clearTimeout(timeout);
  }

  const attempt: WebhookDeliveryAttempt = {
    attemptId,
    eventId: event.eventId,
    paymentId: event.paymentId,
    targetUrl,
    sentAt,
    completedAt,
    latencyMs,
    outcome,
    responseCode,
    responseBody
  };

  store.deliveryAttempts.push(attempt);

  // Retry on non-200 or timeout.
  const shouldRetry =
    outcome !== "DELIVERED_200" &&
    attemptNumber < MAX_DELIVERY_ATTEMPTS &&
    nowMs() - firstAttemptSentAtMs < MAX_RETRY_WINDOW_MS;

  if (!shouldRetry) return { attempt, shouldRetry };

  const retryBackoffMs = Math.min(
    30 * 60 * 1000,
    2 ** (attemptNumber - 1) * 1000 + Math.floor(Math.random() * 250)
  );
  const nextRunAtMs = nowMs() + retryBackoffMs;

  // Schedule the retry attempt.
  scheduleJob<DeliverWebhookPayload>(
    "DELIVER_WEBHOOK",
    {
      eventId: event.eventId,
      paymentId: event.paymentId,
      attemptNumber: attemptNumber + 1,
      firstAttemptSentAtMs,
      targetUrl
    },
    nextRunAtMs
  );

  return { attempt, shouldRetry };
}

async function processJob(job: Job): Promise<void> {
  switch (job.type) {
    case "CREATE_PAYMENT_FROM_SESSION": {
      const payload = job.payload as CreatePaymentFromSessionPayload;
      const session = store.checkoutSessions[payload.checkoutSessionId];
      if (!session) return;

      // Create payment record in initial state. Real state transitions happen when webhook delivery + receiver processing occurs.
      const subtotalCents = session.subtotal.cents;
      const feesCents = computeFees(subtotalCents);
      const totalCents = subtotalCents + feesCents;
      const netCents = subtotalCents - feesCents;

      const payment: Payment = {
        paymentId: payload.paymentId,
        merchantId: session.merchantId,
        checkoutSessionId: session.id,
        status: "CREATED",
        settlementStatus: "NOT_STARTED",
        subtotal: centsToMoney(subtotalCents),
        fees: centsToMoney(feesCents),
        total: centsToMoney(totalCents),
        netToMerchant: centsToMoney(netCents),
        webhookInfo: session.webhookInfo,
        createdAt: nowIso(),
        settlementLocation: session.settlementLocation
      };

      store.payments[payment.paymentId] = payment;

      const outcome = getZipcodeOutcome(payload.zipcode);
      const eventType = outcome.eventType;

      // Emit card outcome quickly.
      scheduleJob<EmitEventPayload>(
        "EMIT_EVENT",
        {
          eventId: randomId("evt"),
          paymentId: payment.paymentId,
          eventType,
          created: nowIso(),
          dataId: payment.paymentId
        },
        nowMs()
      );

      // Schedule settlement only if authorized (not declined/fraud).
      if (eventType === "Card Payment Authorized") {
        const settlementDelayMs =
          typeof payload.settlementDelayMs === "number" ? payload.settlementDelayMs : 2000;

        scheduleJob<SettlePaymentPayload>(
          "SETTLE_PAYMENT",
          { paymentId: payment.paymentId },
          nowMs() + settlementDelayMs
        );
      }
      return;
    }

    case "EMIT_EVENT": {
      const payload = job.payload as EmitEventPayload;

      // Create event once. eventId is stable; retries are tracked via deliveryAttempts.
      const event: WebhookEvent = {
        eventId: payload.eventId,
        paymentId: payload.paymentId,
        eventType: payload.eventType,
        category: "Purchase",
        created: payload.created,
        data: {
          id: payload.dataId,
          signature: payload.signature,
          webhookInfo: store.payments[payload.paymentId]?.webhookInfo ?? {},
          subtotal: store.payments[payload.paymentId]?.subtotal ?? { cents: 0, currency: "USD" },
          fees: store.payments[payload.paymentId]?.fees ?? { cents: 0, currency: "USD" },
          gasFees: { cents: 0, currency: "USD" },
          chargebackProtectionFees: { cents: 0, currency: "USD" },
          total: store.payments[payload.paymentId]?.total ?? { cents: 0, currency: "USD" }
        }
      };

      store.webhookEvents[event.eventId] = event;

      // Deliver at-least-once.
      const firstAttemptSentAtMs = nowMs();
      scheduleJob<DeliverWebhookPayload>(
        "DELIVER_WEBHOOK",
        {
          eventId: event.eventId,
          paymentId: event.paymentId,
          attemptNumber: 1,
          firstAttemptSentAtMs,
          targetUrl: getMerchantWebhookTargetUrl()
        },
        nowMs()
      );
      return;
    }

    case "SETTLE_PAYMENT": {
      const payload = job.payload as SettlePaymentPayload;
      const payment = store.payments[payload.paymentId];
      if (!payment) return;
      if (payment.settlementStatus === "SETTLED") return;

      // Provider-side: indicate settlement is now pending on-chain.
      payment.settlementStatus = "PENDING";

      const signature = randomId("txsig");
      const eventId = randomId("evt");
      // Emit settled webhook event (merchant receiver will finalize wallet/ledger on processing).
      scheduleJob<EmitEventPayload>(
        "EMIT_EVENT",
        {
          eventId,
          paymentId: payment.paymentId,
          eventType: "Settled",
          created: nowIso(),
          dataId: payment.paymentId,
          signature
        },
        nowMs()
      );

      // No immediate wallet credit here; processing happens in merchant receiver job.
      return;
    }

    case "DELIVER_WEBHOOK": {
      const payload = job.payload as DeliverWebhookPayload;
      const event = store.webhookEvents[payload.eventId];
      if (!event) return;
      await deliverWebhookAttempt({
        store,
        event,
        targetUrl: payload.targetUrl,
        attemptNumber: payload.attemptNumber,
        firstAttemptSentAtMs: payload.firstAttemptSentAtMs
      });
      return;
    }

    case "PROCESS_WEBHOOK_EVENT": {
      const payload = job.payload as ProcessWebhookEventPayload;
      const event = store.webhookEvents[payload.eventId];
      if (!event) return;
      const payment = store.payments[event.paymentId];
      if (!payment) return;

      switch (event.eventType) {
        case "Card Payment Authorized":
          payment.status = "AUTHORIZED";
          payment.authorizedAt = nowIso();
          return;
        case "Card Payment Declined":
        case "Card Payment Suspected Fraud":
          payment.status = "DECLINED";
          payment.declinedAt = nowIso();
          payment.settlementStatus = "NOT_STARTED";
          return;
        case "Settled":
          payment.status = "SETTLED";
          payment.settlementStatus = "SETTLED";
          payment.settledAt = nowIso();
          payment.onchainTxSignature = event.data.signature;

          // Credit settlement wallet by net-to-merchant.
          const wallet = store.settlementWallets[payment.settlementLocation];
          wallet.usdcBalanceCents += payment.netToMerchant.cents;
          wallet.updatedAt = nowIso();

          // Reconciliation/ledger entries.
          const createdAt = nowIso();
          store.ledgerEntries.push(
            {
              id: randomId("led"),
              paymentId: payment.paymentId,
              type: "GROSS",
              amount: payment.subtotal,
              createdAt
            },
            {
              id: randomId("led"),
              paymentId: payment.paymentId,
              type: "FEE",
              amount: payment.fees,
              createdAt
            },
            {
              id: randomId("led"),
              paymentId: payment.paymentId,
              type: "NET_SETTLED",
              amount: payment.netToMerchant,
              createdAt,
              notes: `Credited to ${payment.settlementLocation}`
            }
          );

          return;
        case "Refund":
          payment.status = "REFUNDED";
          return;
        default:
          return;
      }
    }

    default:
      return;
  }
}

export async function tickWorker(params?: { maxJobsPerTick?: number }) {
  const maxJobsPerTick = params?.maxJobsPerTick ?? 8;

  // Prevent overlapping tick calls from the client when a webhook times out.
  const s = store as CoinflowStore & { workerTickInFlight?: boolean };
  if (s.workerTickInFlight) {
    return { skipped: true, processedJobs: 0 };
  }
  s.workerTickInFlight = true;
  try {
    let processedJobs = 0;
    const now = nowMs();

    // Process jobs due now/earlier.
    while (processedJobs < maxJobsPerTick) {
      const idx = store.jobQueue.findIndex((j) => j.runAtMs <= now);
      if (idx === -1) break;

      const job = store.jobQueue[idx];
      removeJobByIndex(idx);
      processedJobs++;

      // NOTE: deliver/settle jobs may schedule more jobs; we'll process newly-due ones in subsequent ticks.
      // Keeping the loop tight helps deterministic behavior and avoids very long /api/worker/tick requests.
      // However, since we removed the job up-front, new jobs won't double-run.
      await processJob(job);
    }

    return { skipped: false, processedJobs };
  } finally {
    s.workerTickInFlight = false;
  }
}

export function getSelfWebhookConfigCopy() {
  return {
    retryWindowHours: 36,
    timeoutSeconds: Math.floor(WEBHOOK_TIMEOUT_MS / 1000),
    maxDeliveryAttempts: MAX_DELIVERY_ATTEMPTS
  };
}

export function scheduleWebhookDeliveryForEvent(params: {
  eventId: string;
  // When true, the delivery will be treated as "duplicate delivery" (same eventId) for dedupe proof.
  // In our job queue, this is identical to resend: new attempt record with same eventId.
  reason?: "RESEND" | "DUPLICATE";
}): void {
  const event = store.webhookEvents[params.eventId];
  if (!event) throw new Error(`Unknown eventId: ${params.eventId}`);

  const attemptsForEvent = store.deliveryAttempts.filter((a) => a.eventId === params.eventId);
  const attemptNumber = attemptsForEvent.length + 1;
  const firstAttemptSentAtMs = attemptsForEvent.length
    ? Date.parse(attemptsForEvent[0].sentAt)
    : nowMs();

  scheduleJob<DeliverWebhookPayload>(
    "DELIVER_WEBHOOK",
    {
      eventId: event.eventId,
      paymentId: event.paymentId,
      attemptNumber,
      firstAttemptSentAtMs,
      targetUrl: getMerchantWebhookTargetUrl()
    },
    nowMs()
  );
}

export function enqueueProcessWebhookEvent(params: {
  eventId: string;
  paymentId: string;
}): void {
  scheduleJob<ProcessWebhookEventPayload>(
    "PROCESS_WEBHOOK_EVENT",
    {
      eventId: params.eventId,
      paymentId: params.paymentId
    },
    nowMs()
  );
}

