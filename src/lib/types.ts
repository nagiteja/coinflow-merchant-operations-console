export type CurrencyCode = "USD";

export type Money = {
  cents: number;
  currency: CurrencyCode;
};

export type SettlementLocation = "COINFLOW_WALLET" | "BYO_WALLET";

export type SettlementType = "USDC" | "CREDITS" | "BANK";

export type PaymentStatus =
  | "CREATED"
  | "AUTHORIZED"
  | "DECLINED"
  | "SETTLED"
  | "REFUNDED";

export type SettlementStatus = "NOT_STARTED" | "PENDING" | "SETTLED" | "FAILED";

export type IdempotencyKey = string;

export type WebhookEventType =
  | "Card Payment Authorized"
  | "Card Payment Declined"
  | "Card Payment Suspected Fraud"
  | "Payment Pending Review"
  | "Settled"
  | "Refund";

export type WebhookCategory = "Purchase";

export type CheckoutSessionStatus = "OPEN" | "COMPLETED" | "EXPIRED";

export type CheckoutSession = {
  id: string;
  merchantId: string;
  customerId: string;
  subtotal: Money;
  settlementType: SettlementType;
  settlementLocation: SettlementLocation;
  webhookInfo: Record<string, unknown>; // echoed back in webhook payloads
  createdAt: string;
  status: CheckoutSessionStatus;
};

export type Payment = {
  paymentId: string;
  merchantId: string;
  checkoutSessionId: string;
  status: PaymentStatus;
  settlementStatus: SettlementStatus;

  subtotal: Money;
  fees: Money;
  total: Money;
  netToMerchant: Money;

  webhookInfo: Record<string, unknown>;
  createdAt: string;
  authorizedAt?: string;
  settledAt?: string;
  declinedAt?: string;

  onchainTxSignature?: string; // simulated Solana tx sig

  settlementLocation: SettlementLocation;
};

export type WebhookEvent = {
  eventId: string; // stable across retries/resends for the same logical event
  paymentId: string;
  eventType: WebhookEventType;
  category: WebhookCategory;
  created: string; // when the event was created (not when delivered)
  data: {
    id: string; // transaction id (can equal paymentId or separate uuid)
    signature?: string; // present on Settled (on-chain signature)
    webhookInfo: Record<string, unknown>;
    subtotal: Money;
    fees: Money;
    gasFees: Money; // always 0 in simulation
    chargebackProtectionFees: Money; // 0 unless fraud mode
    total: Money;
  };
};

export type WebhookDeliveryAttemptOutcome =
  | "DELIVERED_200"
  | "FAILED_500"
  | "TIMEOUT"
  | "REJECTED_401";

export type WebhookDeliveryAttempt = {
  attemptId: string;
  eventId: string;
  paymentId: string;

  targetUrl: string;
  sentAt: string;
  completedAt?: string;
  latencyMs?: number;

  outcome: WebhookDeliveryAttemptOutcome;
  responseCode?: number;
  responseBody?: string;
};

export type LedgerEntry = {
  id: string;
  paymentId: string;
  type: "GROSS" | "FEE" | "NET_SETTLED";
  amount: Money;
  createdAt: string;
  notes?: string;
};

export type SettlementWallet = {
  id: SettlementLocation; // only USDC logic implemented, but store supports both locations
  usdcBalanceCents: number;
  updatedAt: string;
};

export type JobType =
  | "CREATE_PAYMENT_FROM_SESSION"
  | "EMIT_EVENT"
  | "SETTLE_PAYMENT"
  | "DELIVER_WEBHOOK"
  | "PROCESS_WEBHOOK_EVENT";

export type Job<TPayload = unknown> = {
  jobId: string;
  type: JobType;
  runAtMs: number; // epoch millis
  payload: TPayload;
};

export type CreateCheckoutSessionInput = {
  merchantId: string;
  customerId: string;
  subtotalCents: number;
  settlementLocation: SettlementLocation;
  settlementType: SettlementType;
  webhookInfo: Record<string, unknown>;
  testControls?: Record<string, unknown>;
};

export type CompleteCheckoutSessionInput = {
  paymentMethod: "CARD";
  email: string;
  zipcode: string;
  fraudMode?: "NONE" | "SUSPECTED_FRAUD";
  idempotencyKey?: IdempotencyKey;
};

export type RefundPaymentInput = {
  reason: string;
};

