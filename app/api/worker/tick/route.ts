import { tickWorker } from "@/lib/simulator";

export const runtime = "nodejs";

export async function POST() {
  const result = await tickWorker({ maxJobsPerTick: 6 });
  return Response.json(result);
}

