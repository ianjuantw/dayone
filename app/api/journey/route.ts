import { getJourney, updateJourneyPlan } from "@/db/dayone";
import {
  ApiRequestError,
  apiResponse,
  nullableString,
  optionalString,
  readJsonObject,
  requireApiIdentity,
} from "../_lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return apiResponse(async () => getJourney(await requireApiIdentity()));
}

export async function PATCH(request: Request) {
  return apiResponse(async () => {
    const identity = await requireApiIdentity();
    const body = await readJsonObject(request);
    const branch = optionalString(body, "branch", 120);
    const targetDate = nullableString(body, "targetDate", 10);
    if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      throw new ApiRequestError(
        400,
        "invalid_field",
        "targetDate must use YYYY-MM-DD format.",
        { field: "targetDate" },
      );
    }
    if ("repository" in body) {
      throw new ApiRequestError(
        400,
        "repository_scope_locked",
        "This pilot is fixed to ianjuantw/dayone.",
        { field: "repository" },
      );
    }
    if (branch === undefined && targetDate === undefined) {
      throw new ApiRequestError(
        400,
        "invalid_body",
        "Provide branch or targetDate to update.",
      );
    }
    return updateJourneyPlan(identity, { branch, targetDate });
  });
}
