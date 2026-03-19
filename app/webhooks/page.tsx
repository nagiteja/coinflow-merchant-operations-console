"use client";

import { useEffect, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";

type WebhookRow = {
  eventId: string;
  eventType: string;
  category: string;
  paymentId: string;
  sentAt: string | null;
  url: string | null;
  attemptCount: number;
  lastResponseCode: number | null;
  lastResponseBody: string | null;
};

export default function WebhooksPage() {
  const [rows, setRows] = useState<WebhookRow[]>([]);
  const [booting, setBooting] = useState(true);
  const bootedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const res = await fetch("/api/ops/webhooks").catch(() => null);
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
        Webhook Activity
      </h1>

      <div className="surface overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>eventId</TableHead>
              <TableHead>eventType</TableHead>
              <TableHead>category</TableHead>
              <TableHead>paymentId</TableHead>
              <TableHead>sentAt</TableHead>
              <TableHead>url</TableHead>
              <TableHead>attempts</TableHead>
              <TableHead>last code</TableHead>
              <TableHead>last body</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {booting
              ? Array.from({ length: 6 }).map((_, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Skeleton className="h-3 w-28 font-mono" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-10" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-3 w-32" />
                    </TableCell>
                  </TableRow>
                ))
              : rows
                  .slice()
                  .sort((a, b) => (a.sentAt ? Date.parse(a.sentAt) : 0) - (b.sentAt ? Date.parse(b.sentAt) : 0))
                  .reverse()
                  .map((w) => (
                    <TableRow key={w.eventId}>
                      <TableCell>
                        <div className="font-mono text-xs">{w.eventId}</div>
                      </TableCell>
                      <TableCell>{w.eventType}</TableCell>
                      <TableCell>{w.category}</TableCell>
                      <TableCell>
                        <Link
                          className="font-medium hover:text-primary hover:underline"
                          href={`/payments/${w.paymentId}`}
                        >
                          {w.paymentId}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {w.sentAt ? new Date(w.sentAt).toLocaleTimeString() : "—"}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                        {w.url ?? "—"}
                      </TableCell>
                      <TableCell>{w.attemptCount}</TableCell>
                      <TableCell>
                        {w.lastResponseCode === 200 ? (
                          <Badge variant="success">200</Badge>
                        ) : w.lastResponseCode ? (
                          <Badge variant="outline">{w.lastResponseCode}</Badge>
                        ) : (
                          <Badge variant="outline">—</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[420px] truncate text-xs font-mono text-muted-foreground">
                        {w.lastResponseBody ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
            {!booting && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  No webhook deliveries yet. Run a scenario from the dashboard.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

