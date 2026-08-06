import { updateTask } from "@/db/dayone";
import {
  apiResponse,
  normalizeTaskStatus,
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
    const { id } = await params;
    return updateTask(identity, id, normalizeTaskStatus(body.status));
  });
}
