/** Must match `variant` keys on `Badge` / `badgeVariants`. */
export type StatusBadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info"
  | "neutral";

/** Maps payment `status` strings to semantic badge styles. */
export function paymentStatusBadgeVariant(status: string): StatusBadgeVariant {
  const s = status.toUpperCase();
  if (s === "SETTLED") return "success";
  if (s === "DECLINED" || s === "REFUNDED" || s === "FAILED") return "destructive";
  if (s === "PENDING" || s === "AUTHORIZED" || s === "AUTHORISING" || s === "PROCESSING") return "warning";
  if (s === "CAPTURED" || s === "COMPLETED") return "info";
  return "default";
}

/** Maps settlement `settlementStatus` to badge styles. */
export function settlementStatusBadgeVariant(settlementStatus: string): StatusBadgeVariant {
  const s = settlementStatus.toUpperCase();
  if (s === "SETTLED") return "success";
  if (s === "PENDING" || s === "PROCESSING") return "warning";
  if (s === "FAILED") return "destructive";
  return "neutral";
}

/** Webhook / HTTP delivery outcome → badge. */
export function webhookOutcomeBadgeVariant(
  outcome: string,
  responseCode?: number | null
): StatusBadgeVariant {
  if (outcome === "DELIVERED_200" || responseCode === 200) return "success";
  if (outcome === "REJECTED_401") return "destructive";
  if (outcome === "TIMEOUT") return "warning";
  if (outcome === "FAILED_500") return "destructive";
  return "neutral";
}
