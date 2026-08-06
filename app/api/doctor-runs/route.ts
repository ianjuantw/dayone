import {
  recordDoctorRun,
  type DoctorCheck,
  type DoctorStatus,
} from "@/db/dayone";
import {
  ApiRequestError,
  apiResponse,
  normalizeTaskStatus,
  optionalNonNegativeInteger,
  readJsonObject,
  requireApiIdentity,
} from "../_lib/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return apiResponse(async () => {
    const identity = await requireApiIdentity();
    const body = await readJsonObject(request);
    validateDoctorEnvelope(body);
    if (!Array.isArray(body.checks) || body.checks.length === 0 || body.checks.length > 100) {
      throw new ApiRequestError(
        400,
        "invalid_field",
        "checks must contain between 1 and 100 doctor results.",
        { field: "checks" },
      );
    }
    const checks = body.checks.map(normalizeDoctorCheck);
    return recordDoctorRun(identity, {
      idempotencyKey: await deriveIdempotencyKey(request, body),
      status: normalizeDoctorStatus(body.status),
      durationMs: optionalNonNegativeInteger(body, "durationMs"),
      checks,
    });
  }, 201);
}

const REQUIRED_V1_CHECKS = [
  "node-version",
  "node-version-file",
  "package-manager",
  "git",
  "dependencies",
  "environment",
  "docker",
] as const;
const OPTIONAL_V1_CHECKS = new Set(["local-health"]);

function validateDoctorEnvelope(body: Record<string, unknown>) {
  const tool =
    body.tool && typeof body.tool === "object" && !Array.isArray(body.tool)
      ? (body.tool as Record<string, unknown>)
      : undefined;
  const project =
    body.project && typeof body.project === "object" && !Array.isArray(body.project)
      ? (body.project as Record<string, unknown>)
      : undefined;
  if (body.schemaVersion !== 1 || tool?.name !== "dayone") {
    throw new ApiRequestError(
      400,
      "invalid_doctor_report",
      "Expected a DayOne doctor report with schemaVersion 1.",
    );
  }
  if (
    project?.name !== "dayone" ||
    project.repositoryHost !== "github.com" ||
    typeof project.repository !== "string" ||
    project.repository.toLowerCase() !== "ianjuantw/dayone"
  ) {
    throw new ApiRequestError(
      400,
      "report_project_mismatch",
      "Run the doctor from the ianjuantw/dayone checkout.",
      { field: "project.repository" },
    );
  }
  if (typeof body.generatedAt !== "string" || !Number.isFinite(Date.parse(body.generatedAt))) {
    throw new ApiRequestError(
      400,
      "invalid_doctor_report",
      "generatedAt must be a valid timestamp.",
      { field: "generatedAt" },
    );
  }
  if (!Array.isArray(body.checks)) return;
  const ids = body.checks.map((value) =>
    value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).id === "string"
      ? String((value as Record<string, unknown>).id)
      : "",
  );
  const unique = new Set(ids);
  if (
    ids.some((id) => !id) ||
    unique.size !== ids.length ||
    REQUIRED_V1_CHECKS.some((id) => !unique.has(id)) ||
    ids.some((id) => !REQUIRED_V1_CHECKS.includes(id as (typeof REQUIRED_V1_CHECKS)[number]) && !OPTIONAL_V1_CHECKS.has(id))
  ) {
    throw new ApiRequestError(
      400,
      "invalid_doctor_checks",
      "The v1 report must contain each standard doctor check exactly once; local-health is optional.",
      { required: REQUIRED_V1_CHECKS },
    );
  }
}

async function deriveIdempotencyKey(
  request: Request,
  body: Record<string, unknown>,
) {
  const headerKey =
    request.headers.get("idempotency-key") ??
    request.headers.get("x-idempotency-key");
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  const generatedAt =
    typeof body.generatedAt === "string" ? body.generatedAt.trim() : "";
  const project =
    body.project && typeof body.project === "object" && !Array.isArray(body.project)
      ? (body.project as Record<string, unknown>)
      : undefined;
  const projectName =
    project && typeof project.name === "string" ? project.name.trim() : "";
  const source =
    headerKey?.trim() ||
    runId ||
    (generatedAt && projectName ? `${generatedAt}:${projectName}` : "") ||
    crypto.randomUUID();
  if (source.length > 1000) {
    throw new ApiRequestError(
      400,
      "invalid_idempotency_key",
      "Doctor run idempotency metadata is too long.",
    );
  }
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function normalizeDoctorCheck(value: unknown): DoctorCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRequestError(400, "invalid_field", "Each check must be an object.", {
      field: "checks",
    });
  }
  const check = value as Record<string, unknown>;
  const rawName =
    typeof check.id === "string"
      ? check.id
      : typeof check.slug === "string"
        ? check.slug
        : typeof check.name === "string"
          ? check.name
          : typeof check.title === "string"
            ? check.title
            : undefined;
  const slug = rawName ? doctorSlug(rawName) : undefined;
  if (!slug) {
    throw new ApiRequestError(
      400,
      "invalid_field",
      "Each check must be a supported DayOne doctor check.",
      { field: "checks" },
    );
  }
  const detailValue = check.detail ?? check.message;
  const detail = typeof detailValue === "string" ? detailValue.trim().slice(0, 1000) : undefined;
  const id = typeof check.id === "string" ? check.id : rawName;
  const title = id ? DOCTOR_CHECK_TITLES[id] : undefined;
  if (!id || !title) {
    throw new ApiRequestError(
      400,
      "invalid_field",
      "Each check must use a canonical DayOne doctor id.",
      { field: "checks.id" },
    );
  }
  const rawStatus = typeof check.status === "string" ? check.status.toLowerCase() : "";
  if (
    slug === "local-health" &&
    !["pass", "passed", "fail", "failed", "blocked"].includes(rawStatus)
  ) {
    throw new ApiRequestError(
      400,
      "invalid_local_health_evidence",
      "local-health must be an explicit pass or fail result.",
      { field: "checks.status" },
    );
  }
  const normalizedStatus = normalizeTaskStatus(check.status);
  const evidenceStatus = ["warn", "warning"].includes(rawStatus)
    ? "warning"
    : ["blocked", "fail", "failed"].includes(rawStatus)
      ? "blocked"
      : "passed";
  return {
    id,
    title,
    slug,
    // A warning remains visible as evidence, but it does not block a required
    // task. Only an explicit failed/blocked check prevents progression.
    status: evidenceStatus === "warning" ? "done" : normalizedStatus,
    evidenceStatus,
    detail: detail || undefined,
  };
}

const DOCTOR_CHECK_TITLES: Record<string, string> = {
  "node-version": "Node.js",
  "node-version-file": ".nvmrc",
  "package-manager": "Package manager",
  git: "Git",
  dependencies: "Dependencies",
  environment: "Environment",
  docker: "Docker",
  "local-health": "Local app health",
};

function normalizeDoctorStatus(value: unknown): DoctorStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ApiRequestError(400, "invalid_field", "status must be a string.");
  }
  const normalized = value.toLowerCase();
  if (["healthy", "pass", "passed"].includes(normalized)) return "healthy";
  if (["warn", "warning"].includes(normalized)) return "healthy";
  if (["blocked", "fail", "failed"].includes(normalized)) {
    return "blocked";
  }
  if (normalized === "error") return "error";
  throw new ApiRequestError(400, "invalid_field", "Invalid doctor run status.");
}

function doctorSlug(value: string) {
  const normalized = value.trim().toLowerCase();
  const known: Record<string, string> = {
    "node-version": "runtime",
    "node-version-file": "runtime",
    "package-manager": "dependencies",
    environment: "secrets",
    docker: "database",
    "local-health": "local-health",
    git: "git",
    "runtime is ready": "runtime",
    runtime: "runtime",
    "dependencies installed": "dependencies",
    dependencies: "dependencies",
    "development secrets": "secrets",
    secrets: "secrets",
    "local database": "database",
    database: "database",
  };
  return known[normalized];
}
