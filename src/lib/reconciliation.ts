import type { Money, Payment, SettlementLocation } from "./types";
import type { CoinflowStore } from "./store";

export type GapDetectorWarning = {
  message: string;
  secondsWaiting: number;
};

export type ReconciliationSummary = {
  paymentId: string;
  gross: Money;
  fees: Money;
  net: Money;
  settlementDestination: SettlementLocation;
  entitlementsGranted: boolean;
  gapWarning?: GapDetectorWarning;
};

function isoToMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

export function getReconciliationSummary(params: {
  store: CoinflowStore;
  paymentId: string;
  nowMs?: number;
  // Keep it simple/visible in UI. The spec says "after X seconds" and we simulate chain queues.
  settlementGapThresholdSeconds?: number;
}): ReconciliationSummary | null {
  const {
    store,
    paymentId,
    nowMs = Date.now(),
    settlementGapThresholdSeconds = 8
  } = params;

  const payment = store.payments[paymentId];
  if (!payment) return null;

  // Ledger entries exist only after Settled processing, but reconciliation panel should still show computed amounts.
  const gross = payment.subtotal;
  const fees = payment.fees;
  const net = payment.netToMerchant;

  const netSettledEntryExists = store.ledgerEntries.some(
    (e) => e.paymentId === paymentId && e.type === "NET_SETTLED"
  );

  const entitlementsGranted =
    payment.settlementStatus === "SETTLED" && payment.settledAt != null && netSettledEntryExists;

  const settlementDestination = payment.settlementLocation;

  const authorizedAtMs = payment.authorizedAt ? isoToMs(payment.authorizedAt) : null;
  const isAuthorizedButNotSettled =
    payment.status === "AUTHORIZED" &&
    payment.settlementStatus !== "SETTLED" &&
    payment.settlementStatus !== "FAILED" &&
    authorizedAtMs != null;

  const gapWarning =
    isAuthorizedButNotSettled && authorizedAtMs != null
      ? (() => {
          const secondsWaiting = (nowMs - authorizedAtMs) / 1000;
          if (secondsWaiting < settlementGapThresholdSeconds) return undefined;
          return {
            message: "Settlement delayed (simulated chain queue)",
            secondsWaiting: Math.floor(secondsWaiting)
          };
        })()
      : undefined;

  return {
    paymentId,
    gross,
    fees,
    net,
    settlementDestination,
    entitlementsGranted,
    gapWarning
  };
}

