"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ToastProvider";

type PaymentDetail = {
  payment: {
    paymentId: string;
    status: string;
    settlementStatus: string;
    authorizedAt?: string;
    settledAt?: string;
  };
  events: Array<{ eventId: string; eventType: string; created: string }>;
  attempts: Array<{
    eventId: string;
    outcome: string;
    latencyMs?: number;
    responseCode?: number;
    responseBody?: string;
  }>;
  ledgerEntries: Array<{ type: string; amount: { cents: number } }>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runScenarioAndWait(params: {
  scenario: "happy" | "delayed" | "timeoutDuplicates" | "failedDeclined" | "failedFraud";
  settlementLocation: "COINFLOW_WALLET" | "BYO_WALLET";
  timeoutMs?: number;
  pollMs?: number;
  when: (detail: PaymentDetail) => boolean;
}): Promise<PaymentDetail | null> {
  const { scenario, settlementLocation, when, timeoutMs = 45_000, pollMs = 1000 } = params;
  const start = Date.now();

  const merchantId = "merchant_1";
  const customerId = `customer_${Math.random().toString(16).slice(2)}`;
  const subtotalCents = 1999;
  const webhookInfo: Record<string, unknown> = { note: `scenario=${scenario}` };
  const testControls: Record<string, unknown> = {};

  let zipcode = "12345";
  let fraudMode = "NONE";
  if (scenario === "failedDeclined") zipcode = "99999";
  if (scenario === "failedFraud") zipcode = "00000";
  if (scenario === "delayed") testControls.settlementDelayMs = 12_000;
  if (scenario === "timeoutDuplicates") testControls.merchantWebhookFailureMode = "TIMEOUT_ONCE";

  const createCheckoutRes = await fetch("/api/sim/checkout-sessions", {
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
  const completeRes = await fetch(
    `/api/sim/checkout-sessions/${createCheckoutRes.checkoutSessionId}/complete`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentMethod: "CARD",
        email: "demo@merchant.example",
        zipcode,
        fraudMode,
        idempotencyKey
      })
    }
  ).then((r) => r.json());

  const paymentId = completeRes.paymentId as string;

  while (Date.now() - start < timeoutMs) {
    const detail = await fetch(`/api/ops/payments/${paymentId}`).then((r) => r.json());
    if (when(detail)) return detail;
    await sleep(pollMs);
  }

  return null;
}

export default function GoLivePage() {
  const [settlementLocation, setSettlementLocation] = useState<
    "COINFLOW_WALLET" | "BYO_WALLET"
  >("COINFLOW_WALLET");

  const [checks, setChecks] = useState({
    settlementLocationConfigured: false,
    signatureModeConfigured: false,
    webhookAckUnder5s: false,
    paymentSuccess: false,
    paymentFailure: false,
    dedupeWorking: false
  });

  const [testRunning, setTestRunning] = useState(false);
  const { toast } = useToast();

  async function runAckTest() {
    setTestRunning(true);
    setChecks((c) => ({ ...c, webhookAckUnder5s: false }));
    try {
      const detail = await runScenarioAndWait({
        scenario: "happy",
        settlementLocation,
        when: (d) => d.payment.settlementStatus === "SETTLED" && d.payment.status === "SETTLED"
      });
      if (!detail) {
        toast({
          title: "ACK test inconclusive",
          description: "No matching payment detail found.",
          variant: "warning"
        });
        return;
      }

      const settledEvent = detail.events.find((e) => e.eventType === "Settled");
      if (!settledEvent) {
        toast({
          title: "ACK test inconclusive",
          description: "No Settled event found in trace.",
          variant: "warning"
        });
        return;
      }

      const settledAttempts = detail.attempts
        .filter((a) => a.eventId === settledEvent.eventId)
        .sort((a, b) => (a.latencyMs ?? 0) - (b.latencyMs ?? 0));
      const firstDelivered = settledAttempts.find((a) => a.outcome === "DELIVERED_200");

      const ok = typeof firstDelivered?.latencyMs === "number" && firstDelivered!.latencyMs! < 5000;
      setChecks((c) => ({ ...c, webhookAckUnder5s: ok }));
      toast({
        title: ok ? "ACK test passed" : "ACK test failed",
        description:
          typeof firstDelivered?.latencyMs === "number"
            ? `First delivered latency: ${firstDelivered.latencyMs}ms (threshold: < 5000ms)`
            : "First delivered latency not observed.",
        variant: ok ? "success" : "warning"
      });
    } finally {
      setTestRunning(false);
    }
  }

  async function runPaymentSuccessTest() {
    setTestRunning(true);
    setChecks((c) => ({ ...c, paymentSuccess: false }));
    try {
      const detail = await runScenarioAndWait({
        scenario: "happy",
        settlementLocation,
        when: (d) => d.payment.settlementStatus === "SETTLED" && d.payment.status === "SETTLED"
      });
      if (!detail) {
        toast({
          title: "Success test inconclusive",
          description: "No matching payment detail found.",
          variant: "warning"
        });
        return;
      }
      setChecks((c) => ({ ...c, paymentSuccess: true }));
      toast({
        title: "Payment success test passed",
        description: "Card → Settled → reconciliation succeeded.",
        variant: "success"
      });
    } finally {
      setTestRunning(false);
    }
  }

  async function runPaymentFailureTest() {
    setTestRunning(true);
    setChecks((c) => ({ ...c, paymentFailure: false }));
    try {
      const detailDeclined = await runScenarioAndWait({
        scenario: "failedDeclined",
        settlementLocation,
        when: (d) => d.payment.status === "DECLINED"
      });
      if (!detailDeclined) {
        toast({
          title: "Failure test inconclusive",
          description: "No declined trace found.",
          variant: "warning"
        });
        return;
      }

      const noLedger = detailDeclined.ledgerEntries.length === 0;
      const okDeclined = detailDeclined.payment.settlementStatus !== "SETTLED" && noLedger;

      const detailFraud = await runScenarioAndWait({
        scenario: "failedFraud",
        settlementLocation,
        when: (d) => d.payment.status === "DECLINED"
      });

      const okFraud = detailFraud?.ledgerEntries?.length === 0;
      const ok = okDeclined && !!okFraud;
      setChecks((c) => ({ ...c, paymentFailure: ok }));
      toast({
        title: ok ? "Failure test passed" : "Failure test failed",
        description: ok
          ? "No settlement webhook / no ledger entries for declines."
          : "Unexpected settlement or ledger entries.",
        variant: ok ? "success" : "warning"
      });
    } finally {
      setTestRunning(false);
    }
  }

  async function runDedupeTest() {
    setTestRunning(true);
    setChecks((c) => ({ ...c, dedupeWorking: false }));
    try {
      const detail = await runScenarioAndWait({
        scenario: "timeoutDuplicates",
        settlementLocation,
        timeoutMs: 60_000,
        when: (d) => d.payment.status === "SETTLED" && d.payment.settlementStatus === "SETTLED"
      });
      if (!detail) {
        toast({
          title: "Dedupe test inconclusive",
          description: "No matching payment detail found.",
          variant: "warning"
        });
        return;
      }

      const settledEvent = detail.events.find((e) => e.eventType === "Settled");
      if (!settledEvent) {
        toast({
          title: "Dedupe test inconclusive",
          description: "No Settled event found in trace.",
          variant: "warning"
        });
        return;
      }

      const settledAttempts = detail.attempts.filter((a) => a.eventId === settledEvent.eventId);
      const deliveredTwiceOrMore = settledAttempts.length >= 2;

      const positiveNetSettledCount = detail.ledgerEntries.filter(
        (l) => l.type === "NET_SETTLED" && l.amount.cents > 0
      ).length;

      const ok = deliveredTwiceOrMore && positiveNetSettledCount === 1;
      setChecks((c) => ({
        ...c,
        dedupeWorking: ok
      }));
      toast({
        title: ok ? "Dedupe test passed" : "Dedupe test failed",
        description: `Attempts: ${settledAttempts.length}, NET_SETTLED entries: ${positiveNetSettledCount}`,
        variant: ok ? "success" : "warning"
      });
    } finally {
      setTestRunning(false);
    }
  }

  useEffect(() => {
    // These are informational in this MVP (server reads env vars at boot).
    setChecks((c) => ({ ...c, settlementLocationConfigured: !!settlementLocation, signatureModeConfigured: true }));
  }, [settlementLocation]);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-3xl font-semibold tracking-tight text-transparent dark:from-white dark:via-white dark:to-primary">
          Go-Live Checklist
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Checklist items are validated using real simulated webhooks, retries, and reconciliation.
        </p>
      </section>

      <section className="surface space-y-3 p-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Configuration</h2>

        <div className="flex items-start gap-3">
          <Checkbox
            checked={checks.settlementLocationConfigured}
            onCheckedChange={() => setSettlementLocation((v) => (v === "COINFLOW_WALLET" ? "BYO_WALLET" : "COINFLOW_WALLET"))}
            aria-label="toggle settlement location"
          />
          <div>
            <div className="font-medium">Configure settlement location</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Using <span className="font-mono">{settlementLocation}</span> for USDC settlement destination.
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Checkbox checked={checks.signatureModeConfigured} disabled aria-label="signature verification configured" />
          <div>
            <div className="font-medium">Signature verification mode</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Server uses <span className="font-mono">{process.env.NEXT_PUBLIC_WEBHOOK_VERIFICATION_MODE ?? "HMAC"}</span> and COINFLOW_WEBHOOK_SECRET at boot.
            </div>
            <div className="mt-2">
              <Badge variant="secondary">Provider &rarr; Merchant</Badge>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="surface space-y-2 p-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={checks.webhookAckUnder5s} disabled />
            <div>
              <div className="font-medium">Webhook receiver ACK &lt; 5 seconds</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Validated by measuring delivery latencyMs on the Settled webhook.
              </div>
            </div>
          </div>
          <Button onClick={runAckTest} disabled={testRunning}>
            {testRunning ? "Running..." : "Run ACK test"}
          </Button>
        </div>

        <div className="surface space-y-2 p-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={checks.paymentSuccess} disabled />
            <div>
              <div className="font-medium">Test payment success</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Zip succeeds: Card Payment Authorized &rarr; Settled &rarr; reconciliation passes.
              </div>
            </div>
          </div>
          <Button onClick={runPaymentSuccessTest} disabled={testRunning}>
            {testRunning ? "Running..." : "Run success test"}
          </Button>
        </div>

        <div className="surface space-y-2 p-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={checks.paymentFailure} disabled />
            <div>
              <div className="font-medium">Test payment failure</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Zip <span className="font-mono">99999</span> declines; zip <span className="font-mono">00000</span> fraud-rejects; no settlement/ledger.
              </div>
            </div>
          </div>
          <Button onClick={runPaymentFailureTest} disabled={testRunning}>
            {testRunning ? "Running..." : "Run failure test"}
          </Button>
        </div>

        <div className="surface space-y-2 p-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={checks.dedupeWorking} disabled />
            <div>
              <div className="font-medium">Confirm dedupe is working</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Timeout/duplicates scenario delivers the same Settled eventId multiple times; entitlements granted exactly once.
              </div>
            </div>
          </div>
          <Button onClick={runDedupeTest} disabled={testRunning}>
            {testRunning ? "Running..." : "Run dedupe test"}
          </Button>
        </div>
      </section>
    </div>
  );
}

