"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ToastVariant = "default" | "success" | "warning" | "destructive" | "info";

export type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type Toast = ToastInput & { id: string; createdAt: number };

const ToastContext = React.createContext<{
  toast: (input: ToastInput) => void;
} | null>(null);

function variantBadgeVariant(variant: ToastVariant) {
  if (variant === "success") return "success";
  if (variant === "warning") return "warning";
  if (variant === "destructive") return "destructive";
  if (variant === "info") return "info";
  return "neutral";
}

function variantCardClasses(variant: ToastVariant) {
  if (variant === "success") return "border-emerald-500/30 bg-emerald-500/[0.08]";
  if (variant === "warning") return "border-amber-500/30 bg-amber-500/[0.08]";
  if (variant === "destructive") return "border-destructive/30 bg-destructive/[0.08]";
  if (variant === "info") return "border-sky-500/30 bg-sky-500/[0.08]";
  return "border-border/70 bg-card/80";
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const toast = React.useCallback((input: ToastInput) => {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const durationMs = input.durationMs ?? 4200;
    const variant = input.variant ?? "default";

    const nextToast: Toast = {
      ...input,
      id,
      createdAt,
      durationMs,
      variant
    };

    setToasts((prev) => [...prev, nextToast]);

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, durationMs);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      <div className="fixed bottom-4 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn("surface flex items-start justify-between gap-3 border p-3", variantCardClasses(t.variant ?? "default"))}
            role="status"
            aria-live="polite"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant={variantBadgeVariant(t.variant ?? "default")}>{t.variant ?? "default"}</Badge>
                <div className="truncate font-semibold">{t.title}</div>
              </div>
              {t.description ? (
                <div className="mt-1 text-sm text-muted-foreground">{t.description}</div>
              ) : null}
            </div>

            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
              aria-label="Dismiss notification"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

