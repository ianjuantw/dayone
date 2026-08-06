import { getMetrics } from "@/db/dayone";
import { apiResponse, requireApiIdentity } from "../_lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return apiResponse(async () => getMetrics(await requireApiIdentity()));
}
