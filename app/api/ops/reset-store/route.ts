import { resetStoreForDev } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const configuredToken = process.env.OPS_RESET_TOKEN;
  if (configuredToken) {
    const provided = req.headers.get("x-reset-token");
    if (!provided || provided !== configuredToken) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  resetStoreForDev();
  return Response.json({ ok: true, resetAt: new Date().toISOString() }, { status: 200 });
}

