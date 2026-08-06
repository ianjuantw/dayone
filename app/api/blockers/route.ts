import { listBlockers, reportBlocker } from "@/db/dayone";
import {
  apiResponse,
  optionalString,
  readJsonObject,
  requiredString,
  requireApiIdentity,
} from "../_lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return apiResponse(async () => listBlockers(await requireApiIdentity()));
}

export async function POST(request: Request) {
  return apiResponse(async () => {
    const identity = await requireApiIdentity();
    const body = await readJsonObject(request);
    return reportBlocker(identity, {
      taskId: optionalString(body, "taskId", 160),
      category: optionalString(body, "category", 60) ?? "environment",
      summary: requiredString(body, "summary", 240),
      detail: optionalString(body, "detail", 2000),
    });
  }, 201);
}
