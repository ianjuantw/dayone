import { answerGuideQuestion } from "@/db/dayone";
import {
  apiResponse,
  readJsonObject,
  requiredString,
  requireApiIdentity,
} from "../_lib/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return apiResponse(async () => {
    const identity = await requireApiIdentity();
    const body = await readJsonObject(request);
    const question = requiredString(body, "question", 1000);
    const context =
      body.context === undefined
        ? undefined
        : typeof body.context === "string"
          ? body.context.slice(0, 2000)
          : JSON.stringify(body.context).slice(0, 2000);
    return answerGuideQuestion(identity, question, context);
  });
}
