import { getGuideSources } from "@/db/dayone";
import { apiResponse, requireApiIdentity } from "../../_lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiResponse(async () => {
    const identity = await requireApiIdentity();
    const topic = new URL(request.url).searchParams.get("topic")?.trim() || undefined;
    return getGuideSources(identity, topic?.slice(0, 60));
  });
}
