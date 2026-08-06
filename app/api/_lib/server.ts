import { getChatGPTUser } from "@/app/chatgpt-auth";
import { DayOneDataError, type DayOneIdentity, type TaskStatus } from "@/db/dayone";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function requireApiIdentity(): Promise<DayOneIdentity> {
  const user = await getChatGPTUser();
  if (!user) {
    throw new ApiRequestError(
      401,
      "authentication_required",
      "Sign in with ChatGPT to access your DayOne journey.",
    );
  }
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
  };
}

export async function apiResponse(
  action: () => Promise<unknown>,
  status = 200,
): Promise<Response> {
  try {
    const payload = await action();
    return Response.json(payload, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function readJsonObject(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ApiRequestError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRequestError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function requiredString(
  body: Record<string, unknown>,
  field: string,
  maxLength = 500,
) {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiRequestError(400, "invalid_field", `${field} is required.`, {
      field,
    });
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new ApiRequestError(
      400,
      "invalid_field",
      `${field} must be at most ${maxLength} characters.`,
      { field },
    );
  }
  return normalized;
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  maxLength = 500,
): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ApiRequestError(400, "invalid_field", `${field} must be a string.`, {
      field,
    });
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new ApiRequestError(
      400,
      "invalid_field",
      `${field} must contain 1–${maxLength} characters.`,
      { field },
    );
  }
  return normalized;
}

export function nullableString(
  body: Record<string, unknown>,
  field: string,
  maxLength = 500,
): string | null | undefined {
  if (body[field] === null) return null;
  return optionalString(body, field, maxLength);
}

export function optionalNonNegativeInteger(
  body: Record<string, unknown>,
  field: string,
) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ApiRequestError(
      400,
      "invalid_field",
      `${field} must be a non-negative integer.`,
      { field },
    );
  }
  return value as number;
}

export function normalizeTaskStatus(value: unknown): TaskStatus {
  if (typeof value !== "string") {
    throw new ApiRequestError(400, "invalid_field", "status is required.", {
      field: "status",
    });
  }
  switch (value.toLowerCase()) {
    case "done":
    case "complete":
    case "completed":
    case "pass":
    case "passed":
      return "done";
    case "ready":
    case "current":
    case "warn":
    case "warning":
      return "ready";
    case "blocked":
    case "fail":
    case "failed":
      return "blocked";
    default:
      throw new ApiRequestError(
        400,
        "invalid_field",
        "status must be ready, done, or blocked.",
        { field: "status" },
      );
  }
}

function errorResponse(error: unknown) {
  if (error instanceof ApiRequestError) {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (error instanceof DayOneDataError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "conflict" || error.code === "locked"
          ? 409
          : 400;
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected error";
  const databaseUnavailable =
    message.includes("D1 binding") || message.includes("no such table");
  return Response.json(
    {
      error: {
        code: databaseUnavailable ? "database_unavailable" : "internal_error",
        message: databaseUnavailable
          ? "DayOne storage is not ready. Apply the generated D1 migration and try again."
          : "DayOne could not complete this request.",
      },
    },
    {
      status: databaseUnavailable ? 503 : 500,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
