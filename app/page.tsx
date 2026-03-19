"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ToastProvider";
import { paymentStatusBadgeVariant, settlementStatusBadgeVariant } from "@/lib/status-badges";

type PaymentsApiRow = {
  paymentId: string;
  status: string;
  settlementStatus: string;
  subtotal: { cents: number; currency: "USD" };
  fees: { cents: number; currency: "USD" };
  netToMerchant: { cents: number; currency: "USD" };
  createdAt: string;
  lastEventType: string | null;
};

function usd(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100
  );
}

async function fetchPayments(): Promise<PaymentsApiRow[]> {
  const res = await fetch("/api/ops/payments");
  return res.json();
}

async function fetchWebhooks() {
  const res = await fetch("/api/ops/webhooks");
  return res.json();
}

export default function DashboardPage() {
  const [payments, setPayments] = useState<PaymentsApiRow[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [booting, setBooting] = useState(true);
  const bootedRef = useRef(false);
  const [scenarioRunning, setScenarioRunning] = useState<
    null | "happy" | "delayed" | "timeoutDuplicates" | "failed"
  >(null);

  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [p, w] = await Promise.allSettled([fetchPayments(), fetchWebhooks()]);
      if (cancelled) return;
      setPayments(p.status === "fulfilled" ? p.value : []);
      setWebhooks(w.status === "fulfilled" ? w.value : []);

      if (!bootedRef.current) {
        bootedRef.current = true;
        setBooting(false);
      }
    }

    load();
    const t = setInterval(load, 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const kpis = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const paymentsToday = payments.filter((p) => Date.parse(p.createdAt) >= dayAgo).length;

    const pendingSettlement = payments.filter((p) => p.settlementStatus === "PENDING").length;
    const failedPayments = payments.filter((p) => p.status === "DECLINED" || p.status === "REFUNDED").length;

    const webhookFailures = webhooks.filter((w) => {
      const ok = w.lastResponseCode === 200;
      return w.attemptCount > 0 && !ok;
    }).length;

    return { paymentsToday, pendingSettlement, failedPayments, webhookFailures };
  }, [payments, webhooks]);

  async function runScenario(scenario: "happy" | "delayed" | "timeoutDuplicates" | "failed") {
    // Single-merchant MVP: hardcoded merchantId for demo realism.
    const merchantId = "merchant_1";
    const customerId = `customer_${Math.random().toString(16).slice(2)}`;

    const settlementLocation = "COINFLOW_WALLET";
    const subtotalCents = 1999; // $19.99
    const webhookInfo: Record<string, any> = {
      note: `scenario=${scenario}`
    };

    let zipcode = "12345";
    const testControls: Record<string, unknown> = {};
    if (scenario === "failed") zipcode = "99999";
    if (scenario === "delayed") testControls.settlementDelayMs = 12000;
    if (scenario === "timeoutDuplicates") testControls.merchantWebhookFailureMode = "TIMEOUT_ONCE";
    if (scenario === "happy") testControls.settlementDelayMs = 2000;

    const checkoutRes = await fetch("/api/sim/checkout-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        merchantId,
        customerId,
        subtotalCents,
        settlementLocation,
        settlementType: "USDC",
        webhookInfo,
        testControls
      })
    }).then((r) => r.json());

    const idempotencyKey = crypto.randomUUID();

    const completeRes = await fetch(`/api/sim/checkout-sessions/${checkoutRes.checkoutSessionId}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentMethod: "CARD",
        email: "demo@merchant.example",
        zipcode,
        fraudMode: "NONE",
        idempotencyKey
      })
    }).then((r) => r.json());

    return completeRes.paymentId as string;
  }

  async function runScenarioWithToast(scenario: "happy" | "delayed" | "timeoutDuplicates" | "failed") {
    setScenarioRunning(scenario);
    try {
      const paymentId = await runScenario(scenario);
      toast({
        title: "Scenario started",
        description: `Created payment ${paymentId}`,
        variant: "info"
      });
    } catch {
      toast({
        title: "Scenario failed",
        description: "Could not start simulation. Please try again.",
        variant: "destructive"
      });
    } finally {
      setScenarioRunning(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-3xl font-semibold tracking-tight text-transparent dark:from-white dark:via-white dark:to-primary">
          Merchant Ops Dashboard
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          At-least-once webhooks, retries, dedupe, reconciliation, and simulated USDC settlement.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="metric-card">
          <div className="text-sm font-medium text-muted-foreground">Payments today</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {booting ? <Skeleton className="h-8 w-12" /> : <AnimatedNumber value={kpis.paymentsToday} />}
          </div>
        </div>
        <div className="metric-card">
          <div className="text-sm font-medium text-muted-foreground">Pending settlement</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {booting ? <Skeleton className="h-8 w-14" /> : <AnimatedNumber value={kpis.pendingSettlement} />}
          </div>
        </div>
        <div className="metric-card">
          <div className="text-sm font-medium text-muted-foreground">Failed payments</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {booting ? <Skeleton className="h-8 w-12" /> : <AnimatedNumber value={kpis.failedPayments} />}
          </div>
        </div>
        <div className="metric-card">
          <div className="text-sm font-medium text-muted-foreground">Webhook failures</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {booting ? <Skeleton className="h-8 w-16" /> : <AnimatedNumber value={kpis.webhookFailures} />}
          </div>
        </div>
      </section>

      <section className="surface flex flex-wrap items-center gap-3 p-4 shadow-sm">
        <Button
          variant="outline"
          disabled={scenarioRunning !== null}
          onClick={async () => {
            const ok = window.confirm(
              "Reset in-memory state? This will clear payments, webhook events, ledger entries, and the job queue."
            );
            if (!ok) return;

            try {
              await fetch("/api/ops/reset-store", {
                method: "POST",
                headers: { "content-type": "application/json" }
              });
              toast({ title: "Store reset", description: "In-memory state cleared.", variant: "success" });
              window.location.reload();
            } catch {
              toast({
                title: "Reset failed",
                description: "Could not reset store.",
                variant: "destructive"
              });
            }
          }}
        >
          Reset store
        </Button>
        <Button disabled={scenarioRunning !== null} onClick={() => runScenarioWithToast("happy")}>
          {scenarioRunning === "happy" ? "Running..." : "Run scenario: happy path"}
        </Button>
        <Button
          variant="secondary"
          disabled={scenarioRunning !== null}
          onClick={() => runScenarioWithToast("delayed")}
        >
          {scenarioRunning === "delayed" ? "Running..." : "Run scenario: delayed settlement"}
        </Button>
        <Button
          variant="secondary"
          disabled={scenarioRunning !== null}
          onClick={() => runScenarioWithToast("timeoutDuplicates")}
        >
          {scenarioRunning === "timeoutDuplicates" ? "Running..." : "Run scenario: webhook timeout/duplicates"}
        </Button>
        <Button variant="secondary" disabled={scenarioRunning !== null} onClick={() => runScenarioWithToast("failed")}>
          {scenarioRunning === "failed" ? "Running..." : "Run scenario: failed payment (zip 99999)"}
        </Button>
      </section>

      <section className="surface p-4 md:p-5">
        <h2 className="text-lg font-semibold">Latest payments</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Payment</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Settlement</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Net</th>
                <th className="py-2">Last event</th>
              </tr>
            </thead>
            <tbody>
              {booting
                ? Array.from({ length: 6 }).map((_, idx) => (
                    <tr key={idx} className="border-t border-border/70">
                      <td className="py-3 pr-3">
                        <Skeleton className="h-3 w-32" />
                      </td>
                      <td className="py-3 pr-3">
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </td>
                      <td className="py-3 pr-3">
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </td>
                      <td className="py-3 pr-3">
                        <Skeleton className="h-3 w-20" />
                      </td>
                      <td className="py-3 pr-3">
                        <Skeleton className="h-3 w-20" />
                      </td>
                      <td className="py-3">
                        <Skeleton className="h-3 w-16" />
                      </td>
                    </tr>
                  ))
                : payments
                    .slice()
                    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
                    .slice(0, 8)
                    .map((p) => (
                      <tr key={p.paymentId} className="border-t border-border/70">
                        <td className="py-3 pr-3">
                          <Link
                            className="font-medium hover:text-primary hover:underline"
                            href={`/payments/${p.paymentId}`}
                          >
                            {p.paymentId}
                          </Link>
                        </td>
                        <td className="py-3 pr-3">
                          <Badge variant={paymentStatusBadgeVariant(p.status)}>{p.status}</Badge>
                        </td>
                        <td className="py-3 pr-3">
                          <Badge variant={settlementStatusBadgeVariant(p.settlementStatus)}>{p.settlementStatus}</Badge>
                        </td>
                        <td className="py-3 pr-3">{usd(p.subtotal.cents)}</td>
                        <td className="py-3 pr-3">{usd(p.netToMerchant.cents)}</td>
                        <td className="py-3">{p.lastEventType ?? "—"}</td>
                      </tr>
                    ))}
              {!booting && payments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-muted-foreground">
                    No payments yet. Run a scenario above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

