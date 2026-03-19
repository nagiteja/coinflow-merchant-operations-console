import crypto from "node:crypto";

export type WebhookVerificationMode = "AUTH_HEADER" | "HMAC";

function hmacSha256Hex(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function buildCoinflowSignatureHeader(secret: string, rawBody: string, t?: number) {
  const unixSeconds = t ?? Math.floor(Date.now() / 1000);
  const payloadToSign = `${unixSeconds}.${rawBody}`;
  const v1 = hmacSha256Hex(secret, payloadToSign);
  return `t=${unixSeconds},v1=${v1}`;
}

export function verifyCoinflowSignatureHeader(params: {
  secret: string;
  rawBody: string;
  coinflowSignatureHeader: string | null;
}): { ok: boolean; reason?: string } {
  const { secret, rawBody, coinflowSignatureHeader } = params;
  if (!coinflowSignatureHeader) return { ok: false, reason: "Missing Coinflow-Signature header" };

  // Expected format: t=<unix_seconds>,v1=<hex_hmac_sha256>
  const parts = coinflowSignatureHeader.split(",").map((s) => s.trim());
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));
  if (!tPart || !v1Part) return { ok: false, reason: "Invalid Coinflow-Signature format" };

  const t = tPart.slice("t=".length);
  const v1 = v1Part.slice("v1=".length);
  if (!t || !v1) return { ok: false, reason: "Invalid signature values" };

  const payloadToSign = `${t}.${rawBody}`;
  const expectedV1 = hmacSha256Hex(secret, payloadToSign);

  return {
    ok: timingSafeEqualHex(expectedV1, v1)
  };
}

export function verifyWebhookSignature(params: {
  mode: WebhookVerificationMode;
  secret: string;
  headers: Headers;
  rawBody: string;
}): { ok: boolean; reason?: string } {
  const { mode, secret, headers, rawBody } = params;

  if (mode === "AUTH_HEADER") {
    const auth = headers.get("authorization") ?? "";
    const expected = `Bearer ${secret}`;
    if (auth !== expected) {
      return { ok: false, reason: "Authorization header secret mismatch" };
    }
    return { ok: true };
  }

  const coinflowSig = headers.get("Coinflow-Signature");
  return verifyCoinflowSignatureHeader({
    secret,
    rawBody,
    coinflowSignatureHeader: coinflowSig
  });
}

