import type {
  CheckoutSession,
  Job,
  LedgerEntry,
  Payment,
  SettlementLocation,
  SettlementWallet,
  WebhookDeliveryAttempt,
  WebhookEvent
} from "./types";

export type CoinflowStore = {
  checkoutSessions: Record<string, CheckoutSession>;
  payments: Record<string, Payment>;
  webhookEvents: Record<string, WebhookEvent>;

  deliveryAttempts: WebhookDeliveryAttempt[];
  ledgerEntries: LedgerEntry[];

  settlementWallets: Record<SettlementLocation, SettlementWallet>;

  // Dedupe for at-least-once provider webhooks: only process each eventId once.
  processedWebhookEventIds: Set<string>;

  // Used for payment-creation idempotency.
  paymentIdByIdempotencyKey: Record<string, string>;

  // Deterministic in-memory queue driven by POST /api/worker/tick.
  jobQueue: Job[];

  // Webhook failure simulation state (used by /api/merchant/webhook TIMEOUT_ONCE).
  merchantFailureTimeoutOnceConsumed: boolean;
};

function createInitialWallet(nowIso: string): SettlementWallet {
  return {
    id: "COINFLOW_WALLET",
    usdcBalanceCents: 0,
    updatedAt: nowIso
  };
}

function createEmptyStore(nowIso: string): CoinflowStore {
  const walletNow = nowIso;
  return {
    checkoutSessions: {},
    payments: {},
    webhookEvents: {},
    deliveryAttempts: [],
    ledgerEntries: [],
    settlementWallets: {
      COINFLOW_WALLET: { id: "COINFLOW_WALLET", usdcBalanceCents: 0, updatedAt: walletNow },
      BYO_WALLET: { id: "BYO_WALLET", usdcBalanceCents: 0, updatedAt: walletNow }
    },
    processedWebhookEventIds: new Set<string>(),
    paymentIdByIdempotencyKey: {},
    jobQueue: [],
    merchantFailureTimeoutOnceConsumed: false
  };
}

const STORE_KEY = "__coinflowMerchantOpsStore_v1";

export function getStore(): CoinflowStore {
  const nowIso = new Date().toISOString();
  const g = globalThis as unknown as { [key: string]: CoinflowStore | undefined };
  if (!g[STORE_KEY]) g[STORE_KEY] = createEmptyStore(nowIso);
  return g[STORE_KEY]!;
}

export const store = getStore();

export function resetStoreForDev(): void {
  // Explicit reset to make scenarios repeatable during development.
  const g = globalThis as unknown as { [key: string]: CoinflowStore | undefined };
  g[STORE_KEY] = createEmptyStore(new Date().toISOString());
}

