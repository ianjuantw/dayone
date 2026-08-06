import { resolveBlocker } from "@/db/dayone";
import {
  ApiRequestError,
  apiResponse,
  normalizeTaskStatus,
  optionalString,
  readJsonObject,
  requireApiIdentity,
} from "../../_lib/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return apiResponse(async () => {
    const identity = await requireApiIdentity();
    const body = await readJsonObject(request);
    const status = body.status;
    if (status !== "resolved" && status !== "dismissed") {
      throw new ApiRequestError(
        400,
        "invalid_field",
        "status must be resolved or dismissed.",
        { field: "status" },
      );
    }
    const normalizedTaskStatus =
      body.taskStatus === undefined ? undefined : normalizeTaskStatus(body.taskStatus);
    if (normalizedTaskStatus === "blocked") {
      throw new ApiRequestError(
        400,
        "invalid_field",
        "A resolved blocker can only return its task to ready or done.",
        { field: "taskStatus" },
      );
    }
    const { id } = await params;
    return resolveBlocker(identity, id, {
      status,
      resolution: optionalString(body, "resolution", 1000),
      taskStatus: normalizedTaskStatus,
    });
  });
}
