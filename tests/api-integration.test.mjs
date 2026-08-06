import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workerPath = path.join(repositoryRoot, "dist/server/index.js");

const authenticatedHeaders = {
  "oai-authenticated-user-id": "integration-user",
  "oai-authenticated-user-email": "integration@example.com",
  "oai-authenticated-user-full-name": "Integration%20Engineer",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

test(
  "DayOne API persists a guarded, idempotent journey through the first MR",
  { timeout: 120_000 },
  async (t) => {
    if (!existsSync(workerPath)) {
      t.skip("dist/server/index.js is unavailable; run npm run build first");
      return;
    }

    const miniflare = new Miniflare({
      modules: workerModules(path.dirname(workerPath)),
      modulesRoot: path.dirname(workerPath),
      compatibilityDate: "2026-05-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      serviceBindings: {
        ASSETS: async () => new Response("Not found", { status: 404 }),
      },
    });
    t.after(() => miniflare.dispose());

    const anonymous = await requestJson(miniflare, "/api/bootstrap", {
      authenticated: false,
    });
    assert.equal(anonymous.response.status, 401);
    assert.equal(anonymous.body.error.code, "authentication_required");

    let snapshot = await successfulSnapshot(miniflare, "/api/bootstrap");
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.mode, "connected");
    assert.equal(snapshot.profile.email, "integration@example.com");
    assert.equal(snapshot.profile.displayName, "Integration Engineer");
    assert.equal(snapshot.journey.activeStep, "get-access");
    assert.equal(step(snapshot, "get-access").status, "active");
    assert.equal(step(snapshot, "run-locally").status, "locked");
    assert.equal(snapshot.metrics.openBlockers, 0);
    assert.equal(snapshot.metrics.gapsFound, 0);
    assert.equal(step(snapshot, "know-the-system").status, "locked");

    const dependencyGuide = await requestJson(miniflare, "/api/guide", {
      method: "POST",
      body: {
        question: "How do I fix Dependencies?",
        context: "run-locally",
      },
    });
    assert.equal(dependencyGuide.response.status, 200);
    assert.equal(dependencyGuide.body.topic, "environment");

    const deliveryGuide = await requestJson(miniflare, "/api/guide", {
      method: "POST",
      body: {
        question: "What will my first MR be?",
        context: "know-the-system",
      },
    });
    assert.equal(deliveryGuide.response.status, 200);
    assert.equal(deliveryGuide.body.topic, "delivery");

    const repositoryMutation = await requestJson(miniflare, "/api/journey", {
      method: "PATCH",
      body: { repository: "someone-else/dayone" },
    });
    assert.equal(repositoryMutation.response.status, 400);
    assert.equal(
      repositoryMutation.body.error.code,
      "repository_scope_locked",
    );
    snapshot = await successfulSnapshot(miniflare, "/api/bootstrap");
    assert.equal(snapshot.journey.repository, "ianjuantw/dayone");

    snapshot = await successfulSnapshot(miniflare, "/api/profile", {
      method: "PATCH",
      body: { displayName: "Journey Display Name" },
    });
    assert.equal(snapshot.profile.displayName, "Journey Display Name");
    snapshot = await successfulSnapshot(miniflare, "/api/bootstrap");
    assert.equal(snapshot.profile.displayName, "Journey Display Name");

    const lockedTask = taskIn(snapshot, "know-the-system", "routing-quiz");
    const lockedMutation = await requestJson(
      miniflare,
      `/api/tasks/${encodeURIComponent(lockedTask.id)}`,
      { method: "PATCH", body: { status: "done" } },
    );
    assert.equal(lockedMutation.response.status, 409);
    assert.equal(lockedMutation.body.error.code, "conflict");

    const lockedMr = await requestJson(miniflare, "/api/merge-request", {
      method: "POST",
      body: { url: "https://github.com/ianjuantw/dayone/pull/42" },
    });
    assert.equal(lockedMr.response.status, 409);
    assert.equal(lockedMr.body.error.code, "locked");

    snapshot = await completeStep(miniflare, snapshot, "get-access");
    assert.equal(snapshot.journey.activeStep, "run-locally");
    assert.equal(step(snapshot, "run-locally").status, "active");

    const runtimeTask = taskIn(snapshot, "run-locally", "runtime");
    const manualDoctorMutation = await requestJson(
      miniflare,
      `/api/tasks/${encodeURIComponent(runtimeTask.id)}`,
      { method: "PATCH", body: { status: "done" } },
    );
    assert.equal(manualDoctorMutation.response.status, 409);
    assert.equal(manualDoctorMutation.body.error.code, "conflict");

    snapshot = await successfulSnapshot(miniflare, "/api/blockers", {
      method: "POST",
      body: {
        taskId: runtimeTask.id,
        category: "environment",
        summary: "Runtime evidence is missing",
        detail: "The environment doctor must verify the configured Node.js runtime.",
      },
      expectedStatus: 201,
    });
    assert.equal(taskIn(snapshot, "run-locally", "runtime").status, "blocked");
    assert.equal(snapshot.metrics.openBlockers, 1);
    assert.equal(snapshot.metrics.gapsFound, 1);
    const evidenceBlocker = snapshot.blockers.find(
      (blocker) => blocker.taskId === runtimeTask.id,
    );
    assert.ok(evidenceBlocker);

    const blockerBypass = await requestJson(
      miniflare,
      `/api/blockers/${encodeURIComponent(evidenceBlocker.id)}`,
      {
        method: "PATCH",
        body: {
          status: "resolved",
          resolution: "Attempted to skip the doctor evidence.",
          taskStatus: "done",
        },
      },
    );
    assert.equal(blockerBypass.response.status, 409);
    assert.equal(blockerBypass.body.error.code, "conflict");
    snapshot = await successfulSnapshot(miniflare, "/api/bootstrap");
    assert.equal(taskIn(snapshot, "run-locally", "runtime").status, "blocked");
    assert.ok(
      snapshot.blockers.some((blocker) => blocker.id === evidenceBlocker.id),
    );
    assert.equal(snapshot.metrics.openBlockers, 1);
    assert.equal(snapshot.metrics.gapsFound, 1);

    const doctorReport = {
      schemaVersion: 1,
      generatedAt: "2026-08-06T02:00:00.000Z",
      tool: { name: "dayone", version: "1.0.0" },
      project: {
        name: "dayone",
        repository: "ianjuantw/dayone",
        repositoryHost: "github.com",
        path: "dayone",
      },
      checks: [
        { id: "node-version", taskId: lockedTask.id, title: "Node.js", status: "pass", message: "Node matches." },
        { id: "node-version-file", title: ".nvmrc", status: "warn", message: "No version file; package engines still match." },
        { id: "package-manager", title: "Package manager", status: "pass", message: "npm is ready." },
        { id: "git", title: "Git", status: "pass", message: "Git is ready." },
        { id: "dependencies", title: "Dependencies", status: "pass", message: "Dependencies are installed." },
        { id: "environment", title: "Environment", status: "pass", message: "Required values exist." },
        { id: "docker", title: "Docker", status: "warn", message: "This project does not require Docker." },
        { id: "local-health", title: "Local app", status: "pass", message: "Health returned 204." },
      ],
    };

    const unknownDoctorCheck = await requestJson(miniflare, "/api/doctor-runs", {
      method: "POST",
      body: {
        ...doctorReport,
        generatedAt: "2026-08-06T02:00:01.000Z",
        checks: [
          ...doctorReport.checks,
          {
            id: "routing-quiz",
            taskId: lockedTask.id,
            title: "Injected task",
            status: "pass",
            message: "This check must not mutate a journey task.",
          },
        ],
      },
    });
    assert.equal(unknownDoctorCheck.response.status, 400);
    assert.equal(unknownDoctorCheck.body.error.code, "invalid_doctor_checks");
    snapshot = await successfulSnapshot(miniflare, "/api/bootstrap");
    assert.equal(snapshot.metrics.doctorRuns, 0);
    assert.equal(taskIn(snapshot, "run-locally", "runtime").status, "blocked");
    assert.equal(
      taskIn(snapshot, "know-the-system", "routing-quiz").status,
      "ready",
    );

    const warningHealthReport = {
      ...doctorReport,
      generatedAt: "2026-08-06T02:00:02.000Z",
      checks: doctorReport.checks.map((check) =>
        check.id === "local-health" ? { ...check, status: "warn" } : check,
      ),
    };
    const warningHealth = await requestJson(miniflare, "/api/doctor-runs", {
      method: "POST",
      body: warningHealthReport,
    });
    assert.equal(warningHealth.response.status, 400);
    assert.equal(
      warningHealth.body.error.code,
      "invalid_local_health_evidence",
    );
    snapshot = await successfulSnapshot(miniflare, "/api/bootstrap");
    assert.equal(snapshot.metrics.doctorRuns, 0);
    assert.equal(taskIn(snapshot, "run-locally", "runtime").status, "blocked");

    snapshot = await successfulSnapshot(miniflare, "/api/doctor-runs", {
      method: "POST",
      body: doctorReport,
      expectedStatus: 201,
    });
    assert.equal(snapshot.metrics.doctorRuns, 1);
    assert.equal(snapshot.doctorRuns.length, 1);
    assert.equal(snapshot.doctorRuns[0].status, "healthy");
    assert.equal(snapshot.doctorRuns[0].passedChecks, 6);
    assert.deepEqual(
      snapshot.doctorRuns[0].checks.map((check) => check.id),
      doctorReport.checks.map((check) => check.id),
    );
    assert.equal(
      snapshot.doctorRuns[0].checks.find((check) => check.id === "docker").title,
      "Docker",
    );
    assert.equal(
      snapshot.doctorRuns[0].checks.filter((check) => check.evidenceStatus === "warning").length,
      2,
    );
    assert.equal(typeof snapshot.metrics.firstLocalRunMinutes, "number");
    assert.equal(snapshot.metrics.openBlockers, 0);
    assert.equal(snapshot.metrics.gapsFound, 1);
    assert.equal(step(snapshot, "run-locally").status, "complete");
    assert.equal(snapshot.journey.activeStep, "know-the-system");
    assert.equal(
      taskIn(snapshot, "know-the-system", "routing-quiz").status,
      "ready",
    );

    const firstDoctorRunId = snapshot.doctorRuns[0].id;
    snapshot = await successfulSnapshot(miniflare, "/api/doctor-runs", {
      method: "POST",
      body: doctorReport,
      expectedStatus: 201,
    });
    assert.equal(snapshot.metrics.doctorRuns, 1);
    assert.equal(snapshot.doctorRuns.length, 1);
    assert.equal(snapshot.doctorRuns[0].id, firstDoctorRunId);

    snapshot = await successfulSnapshot(miniflare, "/api/blockers", {
      method: "POST",
      body: {
        category: "mentoring",
        summary: "Need a quick architecture review",
        detail: "Confirm the ownership boundary before the first change.",
      },
      expectedStatus: 201,
    });
    assert.equal(snapshot.metrics.helpRequests, 1);
    assert.equal(snapshot.metrics.openBlockers, 1);
    assert.equal(snapshot.metrics.gapsFound, 2);
    const mentoringBlocker = snapshot.blockers.find(
      (blocker) => blocker.category === "mentoring",
    );
    assert.ok(mentoringBlocker);

    snapshot = await successfulSnapshot(
      miniflare,
      `/api/blockers/${encodeURIComponent(mentoringBlocker.id)}`,
      {
        method: "PATCH",
        body: {
          status: "resolved",
          resolution: "Reviewed with the Platform buddy.",
        },
      },
    );
    assert.equal(snapshot.metrics.helpRequests, 1);
    assert.equal(snapshot.metrics.openBlockers, 0);
    assert.equal(snapshot.metrics.gapsFound, 2);

    snapshot = await completeStep(miniflare, snapshot, "know-the-system");
    assert.equal(snapshot.journey.activeStep, "make-a-change");
    snapshot = await completeStep(miniflare, snapshot, "make-a-change");
    assert.equal(snapshot.journey.activeStep, "ship-first-mr");

    const directMrTask = taskIn(
      snapshot,
      "ship-first-mr",
      "open-merge-request",
    );
    const directMrMutation = await requestJson(
      miniflare,
      `/api/tasks/${encodeURIComponent(directMrTask.id)}`,
      { method: "PATCH", body: { status: "done" } },
    );
    assert.equal(directMrMutation.response.status, 409);
    assert.equal(directMrMutation.body.error.code, "conflict");

    snapshot = await completeTask(miniflare, snapshot, "ship-first-mr", "push-branch");
    const invalidMr = await requestJson(miniflare, "/api/merge-request", {
      method: "POST",
      body: { url: "https://github.com/someone-else/dayone/pull/42" },
    });
    assert.equal(invalidMr.response.status, 400);
    assert.equal(invalidMr.body.error.code, "invalid_merge_request_url");

    snapshot = await successfulSnapshot(miniflare, "/api/merge-request", {
      method: "POST",
      body: { url: "https://github.com/ianjuantw/dayone/pull/42" },
      expectedStatus: 201,
    });
    assert.equal(
      taskIn(snapshot, "ship-first-mr", "open-merge-request").status,
      "done",
    );
    assert.equal(
      snapshot.journey.firstMrUrl,
      "https://github.com/ianjuantw/dayone/pull/42",
    );
    assert.ok(snapshot.journey.firstMrRecordedAt);
    const firstMrRecordedAt = snapshot.journey.firstMrRecordedAt;

    snapshot = await successfulSnapshot(miniflare, "/api/merge-request", {
      method: "POST",
      body: { url: "https://github.com/ianjuantw/dayone/pull/42" },
      expectedStatus: 201,
    });
    assert.equal(snapshot.journey.firstMrRecordedAt, firstMrRecordedAt);

    const replacementMr = await requestJson(miniflare, "/api/merge-request", {
      method: "POST",
      body: { url: "https://github.com/ianjuantw/dayone/pull/43" },
    });
    assert.equal(replacementMr.response.status, 409);
    assert.equal(replacementMr.body.error.code, "conflict");

    snapshot = await completeTask(
      miniflare,
      snapshot,
      "ship-first-mr",
      "request-review",
    );
    assert.equal(snapshot.journey.status, "active");
    snapshot = await completeTask(
      miniflare,
      snapshot,
      "ship-first-mr",
      "share-feedback",
    );
    assert.equal(snapshot.journey.status, "complete");
    assert.ok(snapshot.journey.completedAt);
    assert.equal(typeof snapshot.metrics.firstMrMinutes, "number");

    const refreshed = await successfulSnapshot(miniflare, "/api/bootstrap");
    assert.equal(refreshed.journey.status, "complete");
    assert.equal(refreshed.metrics.doctorRuns, 1);
    assert.equal(refreshed.metrics.helpRequests, 1);
    assert.equal(refreshed.metrics.openBlockers, 0);
    assert.equal(refreshed.metrics.gapsFound, 2);
    assert.equal(refreshed.blockers.length, 2);
    assert.ok(
      refreshed.blockers.every((blocker) => blocker.status === "resolved"),
    );
  },
);

function workerModules(root) {
  const files = [];
  collectJavaScript(root, files);
  const entryIndex = files.indexOf(workerPath);
  assert.notEqual(entryIndex, -1, "Expected the built Worker entry module");
  files.splice(entryIndex, 1);
  return [workerPath, ...files].map((file) => ({
    type: "ESModule",
    path: file,
  }));
}

function collectJavaScript(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJavaScript(entryPath, files);
    } else if (entry.isFile() && /\.m?js$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
}

async function completeStep(miniflare, snapshot, stepSlug) {
  let current = snapshot;
  for (const journeyTask of step(current, stepSlug).tasks) {
    if (journeyTask.status !== "done") {
      current = await completeTask(
        miniflare,
        current,
        stepSlug,
        journeyTask.slug,
      );
    }
  }
  return current;
}

async function completeTask(miniflare, snapshot, stepSlug, taskSlug) {
  const journeyTask = taskIn(snapshot, stepSlug, taskSlug);
  return successfulSnapshot(
    miniflare,
    `/api/tasks/${encodeURIComponent(journeyTask.id)}`,
    { method: "PATCH", body: { status: "done" } },
  );
}

function step(snapshot, slug) {
  const journeyStep = snapshot.steps.find((candidate) => candidate.slug === slug);
  assert.ok(journeyStep, `Expected journey step ${slug}`);
  return journeyStep;
}

function taskIn(snapshot, stepSlug, taskSlug) {
  const journeyTask = step(snapshot, stepSlug).tasks.find(
    (candidate) => candidate.slug === taskSlug,
  );
  assert.ok(journeyTask, `Expected task ${taskSlug} in ${stepSlug}`);
  return journeyTask;
}

async function successfulSnapshot(miniflare, pathname, options = {}) {
  const result = await requestJson(miniflare, pathname, options);
  assert.equal(
    result.response.status,
    options.expectedStatus ?? 200,
    `${options.method ?? "GET"} ${pathname}: ${JSON.stringify(result.body)}`,
  );
  assert.equal(result.body.schemaVersion, 1);
  assert.equal(result.body.mode, "connected");
  return result.body;
}

async function requestJson(
  miniflare,
  pathname,
  { method = "GET", body, authenticated = true } = {},
) {
  const headers = new Headers({ accept: "application/json" });
  if (authenticated) {
    for (const [name, value] of Object.entries(authenticatedHeaders)) {
      headers.set(name, value);
    }
  }
  if (body !== undefined) headers.set("content-type", "application/json");

  const response = await miniflare.dispatchFetch(
    new URL(pathname, "http://dayone.test"),
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    assert.fail(
      `${method} ${pathname} returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`,
    );
  }
  return { response, body: parsed };
}
