"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { paymentStatusBadgeVariant, settlementStatusBadgeVariant } from "@/lib/status-badges";

type PaymentsRow = {
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
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function PaymentsPage() {
  const [rows, setRows] = useState<PaymentsRow[]>([]);
  const [booting, setBooting] = useState(true);
  const bootedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const res = await fetch("/api/ops/payments").catch(() => null);
      if (!res) return;
      const json = await res.json();
      if (cancelled) return;
      setRows(Array.isArray(json) ? json : []);

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

  return (
    <div className="space-y-4">
      <h1 className="bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-3xl font-semibold tracking-tight text-transparent dark:from-white dark:via-white dark:to-primary">
        Payments
      </h1>
      <div className="surface overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>paymentId</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Settlement</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Fees</TableHead>
              <TableHead>Net</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last event</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {booting
              ? Array.from({ length: 6 }).map((_, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Skeleton className="h-3 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-20" />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Skeleton className="h-3 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-16" />
                    </TableCell>
                  </TableRow>
                ))
              : rows
                  .slice()
                  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
                  .map((p) => (
                    <TableRow key={p.paymentId}>
                      <TableCell>
                        <Link
                          className="font-medium hover:text-primary hover:underline"
                          href={`/payments/${p.paymentId}`}
                        >
                          {p.paymentId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={paymentStatusBadgeVariant(p.status)}>{p.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={settlementStatusBadgeVariant(p.settlementStatus)}>{p.settlementStatus}</Badge>
                      </TableCell>
                      <TableCell>{usd(p.subtotal.cents)}</TableCell>
                      <TableCell>{usd(p.fees.cents)}</TableCell>
                      <TableCell>{usd(p.netToMerchant.cents)}</TableCell>
                      <TableCell className="whitespace-nowrap">{new Date(p.createdAt).toLocaleTimeString()}</TableCell>
                      <TableCell>{p.lastEventType ?? "—"}</TableCell>
                    </TableRow>
                  ))}
            {!booting && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No payments yet. Run a scenario from the dashboard.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

