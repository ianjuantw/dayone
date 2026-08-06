import { recordFirstMergeRequest } from "@/db/dayone";
import {
  ApiRequestError,
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
    const rawUrl = requiredString(body, "url", 300);
    const url = canonicalMergeRequestUrl(rawUrl);
    return recordFirstMergeRequest(identity, url);
  }, 201);
}

function canonicalMergeRequestUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidMergeRequestUrl();
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/ianjuantw\/dayone\/pull\/[1-9]\d*\/?$/.test(url.pathname)
  ) {
    throw invalidMergeRequestUrl();
  }
  return `https://github.com${url.pathname.replace(/\/$/, "")}`;
}

function invalidMergeRequestUrl() {
  return new ApiRequestError(
    400,
    "invalid_merge_request_url",
    "url must be a GitHub pull request for ianjuantw/dayone.",
    { field: "url" },
  );
}
