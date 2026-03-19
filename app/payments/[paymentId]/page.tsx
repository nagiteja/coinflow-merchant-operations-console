"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  paymentStatusBadgeVariant,
  settlementStatusBadgeVariant,
  webhookOutcomeBadgeVariant
} from "@/lib/status-badges";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

type Money = { cents: number; currency: "USD" };

type DeliveryAttempt = {
  attemptId: string;
  eventId: string;
  outcome: "DELIVERED_200" | "FAILED_500" | "TIMEOUT" | "REJECTED_401";
  latencyMs?: number;
  responseCode?: number;
  responseBody?: string;
  sentAt: string;
};

type WebhookEvent = {
  eventId: string;
  eventType: string;
  created: string;
  data: {
    id: string;
    signature?: string;
    webhookInfo: Record<string, unknown>;
    subtotal: Money;
    fees: Money;
    gasFees: Money;
    chargebackProtectionFees: Money;
    total: Money;
  };
};

type PaymentDetailResponse = {
  payment: {
    paymentId: string;
    status: string;
    settlementStatus: string;
    createdAt: string;
    authorizedAt?: string;
    settledAt?: string;
    declinedAt?: string;
    netToMerchant: Money;
    fees: Money;
    subtotal: Money;
    settlementLocation: "COINFLOW_WALLET" | "BYO_WALLET";
  };
  events: WebhookEvent[];
  attempts: DeliveryAttempt[];
  ledgerEntries: Array<{ type: string; amount: Money; createdAt: string; notes?: string }>;
  settlementWallets: Record<"COINFLOW_WALLET" | "BYO_WALLET", { usdcBalanceCents: number; updatedAt: string }>;
  reconciliation: {
    entitlementsGranted: boolean;
    gapWarning?: { message: string; secondsWaiting: number };
  } | null;
};

function usd(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function eventPayloadPreview(event: WebhookEvent): string {
  try {
    // Keep the preview short and focused on debugging.
    const preview = {
      id: event.data.id,
      signature: event.data.signature,
      webhookInfo: event.data.webhookInfo
    };
    return JSON.stringify(preview);
  } catch {
    return String(event.data);
  }
}

function outcomeToUi(o: DeliveryAttempt["outcome"], responseCode?: number) {
  if (o === "DELIVERED_200") return "200";
  if (o === "REJECTED_401") return "401";
  if (o === "FAILED_500") return String(responseCode ?? 500);
  return "timeout";
}

export default function PaymentDetailPage() {
  const params = useParams<{ paymentId: string }>();
  const paymentId = params.paymentId;

  const [detail, setDetail] = useState<PaymentDetailResponse | null>(null);

  useEffect(() => {
    if (!paymentId) return;
    let cancelled = false;

    async function load() {
      const res = await fetch(`/api/ops/payments/${paymentId}`).catch(() => null);
      if (!res) return;
      const json = await res.json();
      if (cancelled) return;
      setDetail(json);
    }

    load();
    const t = setInterval(load, 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [paymentId]);

  const trace = useMemo(() => {
    if (!detail) return null;

    const created = { label: "Created", createdAt: detail.payment.createdAt };
    const authorized = detail.events.find((e) => e.eventType === "Card Payment Authorized") ?? null;
    const declined =
      detail.events.find((e) => e.eventType === "Card Payment Declined") ??
      detail.events.find((e) => e.eventType === "Card Payment Suspected Fraud") ??
      null;
    const settled = detail.events.find((e) => e.eventType === "Settled") ?? null;

    return { created, authorized, declined, settled };
  }, [detail]);

  async function resend(eventId: string, kind: "RESEND" | "DUPLICATE") {
    await fetch(`/api/ops/webhooks/${eventId}/resend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind })
    }).catch(() => {});
  }

  if (!detail || !trace) {
    return (
      <div className="text-sm text-muted-foreground">Loading payment details...</div>
    );
  }

  const { payment, events, attempts, ledgerEntries } = detail;
  const eventsById = new Map(events.map((e) => [e.eventId, e]));

  const relevantEventIds = events.map((e) => e.eventId);
  const attemptsByEventId = new Map<string, DeliveryAttempt[]>();
  for (const a of attempts) {
    const list = attemptsByEventId.get(a.eventId) ?? [];
    list.push(a);
    attemptsByEventId.set(a.eventId, list);
  }

  const reconciliation = detail.reconciliation;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-2xl font-semibold tracking-tight text-transparent dark:from-white dark:via-white dark:to-primary">
          Payment Trace
        </h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant={paymentStatusBadgeVariant(payment.status)}>{payment.status}</Badge>
          <Badge variant={settlementStatusBadgeVariant(payment.settlementStatus)}>{payment.settlementStatus}</Badge>
          <Badge variant="neutral">{payment.settlementLocation}</Badge>
        </div>
      </div>

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="raw">Raw JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-4">
          <div className="rounded-lg border p-4">
            <h2 className="font-semibold">Payment Trace improvement</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Events shown in provider sequence: Created &rarr; Authorized &rarr; Settled OR Declined. Dedupe and retries are visible under Webhooks.
            </p>

            <ol className="mt-4 space-y-3">
              <li className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{trace.created.label}</div>
                  <div className="text-xs text-muted-foreground">{new Date(trace.created.createdAt).toLocaleTimeString()}</div>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">No webhook payload yet.</div>
              </li>

              {trace.authorized ? (
                <li className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{trace.authorized.eventType}</div>
                    <div className="text-xs text-muted-foreground">{new Date(trace.authorized.created).toLocaleTimeString()}</div>
                  </div>
                  <div className="mt-2 text-xs font-mono text-muted-foreground">{eventPayloadPreview(trace.authorized)}</div>
                  <div className="mt-2 text-sm text-muted-foreground">Settlement impact: none (entitlements not granted until Settled).</div>
                </li>
              ) : trace.declined ? (
                <li className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{trace.declined.eventType}</div>
                    <div className="text-xs text-muted-foreground">{new Date(trace.declined.created).toLocaleTimeString()}</div>
                  </div>
                  <div className="mt-2 text-xs font-mono text-muted-foreground">{eventPayloadPreview(trace.declined)}</div>
                  <div className="mt-2 text-sm text-muted-foreground">Settlement impact: declined (no settlement webhook scheduled).</div>
                </li>
              ) : null}

              {trace.settled ? (
                <li className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{trace.settled.eventType}</div>
                    <div className="text-xs text-muted-foreground">{new Date(trace.settled.created).toLocaleTimeString()}</div>
                  </div>
                  <div className="mt-2 text-xs font-mono text-muted-foreground">{eventPayloadPreview(trace.settled)}</div>
                  <div className="mt-2 text-sm">
                    Settlement impact: credited <span className="font-medium">{usd(payment.netToMerchant.cents)}</span> to{" "}
                    <span className="font-medium">{payment.settlementLocation}</span>.
                  </div>
                  {trace.settled.data.signature ? (
                    <div className="mt-2 text-xs font-mono text-muted-foreground">
                      on-chain tx signature={trace.settled.data.signature}
                    </div>
                  ) : null}
                </li>
              ) : trace.authorized ? (
                <li className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">Settled (pending)</div>
                    <div className="text-xs text-muted-foreground">not received yet</div>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    Waiting for the terminal “Settled” signal.
                  </div>
                </li>
              ) : null}
            </ol>
          </div>
        </TabsContent>

        <TabsContent value="webhooks" className="space-y-4">
          <div className="rounded-lg border p-4">
            <h2 className="font-semibold">Webhook Delivery Panel</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Provider delivery is at-least-once; retries happen on non-200 or timeouts. Retries are capped to 36h.
            </p>

            <Separator className="my-4" />

            <div className="space-y-6">
              {relevantEventIds.map((eventId) => {
                const event = eventsById.get(eventId);
                if (!event) return null;

                const list = (attemptsByEventId.get(eventId) ?? []).slice().sort(
                  (a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt)
                );

                return (
                  <div key={eventId}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{event.eventType}</div>
                        <div className="text-xs text-muted-foreground">
                          eventId={event.eventId}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => resend(event.eventId, "RESEND")}>
                          Resend event
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => resend(event.eventId, "DUPLICATE")}>
                          Send duplicate delivery
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3">
                      {list.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No delivery attempts yet.</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>#</TableHead>
                              <TableHead>outcome</TableHead>
                              <TableHead>latencyMs</TableHead>
                              <TableHead>response</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {list.map((a, i) => (
                              <TableRow key={a.attemptId}>
                                <TableCell>{i + 1}</TableCell>
                                <TableCell>
                                  <Badge variant={webhookOutcomeBadgeVariant(a.outcome, a.responseCode)}>
                                    {outcomeToUi(a.outcome, a.responseCode)}
                                  </Badge>
                                </TableCell>
                                <TableCell>{typeof a.latencyMs === "number" ? a.latencyMs : "—"}</TableCell>
                                <TableCell className="max-w-[520px]">
                                  <div className="truncate text-xs font-mono text-muted-foreground">
                                    {a.responseBody ? a.responseBody : "—"}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="reconciliation" className="space-y-4">
          <div className="rounded-lg border p-4">
            <h2 className="font-semibold">Reconciliation</h2>

            {reconciliation?.gapWarning ? (
              <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <div className="font-medium">Warning</div>
                <div className="mt-1 text-muted-foreground">
                  {reconciliation.gapWarning.message} (waiting {reconciliation.gapWarning.secondsWaiting}s)
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">Gross</div>
                <div className="mt-1 text-lg font-semibold">{usd(payment.subtotal.cents)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">Fees</div>
                <div className="mt-1 text-lg font-semibold">{usd(payment.fees.cents)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">Net</div>
                <div className="mt-1 text-lg font-semibold">{usd(payment.netToMerchant.cents)}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant="outline">destination={payment.settlementLocation}</Badge>
              <Badge variant={reconciliation?.entitlementsGranted ? "success" : "warning"}>
                entitlements: {reconciliation?.entitlementsGranted ? "granted" : "pending"}
              </Badge>
            </div>

            <div className="mt-4">
              <h3 className="text-sm font-semibold">Ledger entries</h3>
              <div className="mt-2">
                {ledgerEntries.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No ledger entries yet. Wait for the Settled webhook.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>type</TableHead>
                        <TableHead>amount</TableHead>
                        <TableHead>createdAt</TableHead>
                        <TableHead>notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerEntries.map((l, idx) => (
                        <TableRow key={`${l.type}-${idx}`}>
                          <TableCell>{l.type}</TableCell>
                          <TableCell>{usd(l.amount.cents)}</TableCell>
                          <TableCell className="whitespace-nowrap">{new Date(l.createdAt).toLocaleTimeString()}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{l.notes ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="raw">
          <div className="rounded-lg border p-4">
            <h2 className="font-semibold">Raw JSON</h2>
            <ScrollArea className="mt-3 h-[420px]">
              <pre className="whitespace-pre-wrap text-xs font-mono text-muted-foreground">
                {JSON.stringify(
                  { payment: detail.payment, events: detail.events, attempts: detail.attempts, ledgerEntries: detail.ledgerEntries },
                  null,
                  2
                )}
              </pre>
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

