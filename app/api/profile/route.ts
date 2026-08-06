import { updateProfile } from "@/db/dayone";
import {
  ApiRequestError,
  apiResponse,
  nullableString,
  optionalString,
  readJsonObject,
  requireApiIdentity,
} from "../_lib/server";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  return apiResponse(async () => {
    const identity = await requireApiIdentity();
    const body = await readJsonObject(request);
    const displayName = optionalString(body, "displayName", 120);
    const role = optionalString(body, "role", 120);
    const team = optionalString(body, "team", 120);
    const buddyName = optionalString(body, "buddyName", 120);
    const buddyEmail = nullableString(body, "buddyEmail", 254);
    if (
      displayName === undefined &&
      role === undefined &&
      team === undefined &&
      buddyName === undefined &&
      buddyEmail === undefined
    ) {
      throw new ApiRequestError(400, "invalid_body", "No profile fields were provided.");
    }
    if (buddyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buddyEmail)) {
      throw new ApiRequestError(
        400,
        "invalid_field",
        "buddyEmail must be a valid email address.",
        { field: "buddyEmail" },
      );
    }
    return updateProfile(identity, {
      displayName,
      role,
      team,
      buddyName,
      buddyEmail,
    });
  });
}
