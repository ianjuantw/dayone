import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CLI_VERSION,
  HEALTH_BODY_LIMIT_BYTES,
  formatHuman,
  isLoopbackHealthHostname,
  normalizeRepositoryRemote,
  parseArgs,
  parseEnvFile,
  redactReportForExport,
  runDoctor,
  satisfiesSemver,
} from "../cli/dayone.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function makeProject(t, options = {}) {
  const projectPath = await mkdtemp(path.join(tmpdir(), "dayone-doctor-"));
  t.after(() => rm(projectPath, { recursive: true, force: true }));

  const packageJson = options.packageJson ?? {
    name: "healthy-project",
    engines: { node: ">=22 <23" },
    packageManager: "npm@10.9.8",
    dependencies: { "example-dependency": "^1.0.0" },
  };
  await writeFile(path.join(projectPath, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

  for (const [filename, content] of Object.entries(options.files ?? {})) {
    const filePath = path.join(projectPath, filename);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
  return projectPath;
}

function successfulCommandRunner(projectPath) {
  return async (command, args) => {
    if (command === "npm") return { ok: true, code: 0, stdout: "10.9.8", stderr: "" };
    if (command === "git" && args[0] === "rev-parse") {
      return { ok: true, code: 0, stdout: projectPath, stderr: "" };
    }
    if (command === "git" && args[0] === "symbolic-ref") {
      return { ok: true, code: 0, stdout: "feature/onboarding", stderr: "" };
    }
    if (command === "git" && args[0] === "config") {
      return {
        ok: true,
        code: 0,
        stdout: "https://x-access-token:ghp_raw-secret@github.com/acme/healthy-project.git?access_token=also-secret",
        stderr: "",
      };
    }
    if (command === "docker" && args[0] === "--version") {
      return { ok: true, code: 0, stdout: "Docker version 29.0.0", stderr: "" };
    }
    if (command === "docker" && args[0] === "info") {
      return { ok: true, code: 0, stdout: "29.0.0", stderr: "" };
    }
    return { ok: false, code: 1, stdout: "", stderr: "unexpected command" };
  };
}

test("semantic version checks cover Node and package ranges", () => {
  assert.equal(satisfiesSemver("v22.13.1", ">=22.13.0 <23"), true);
  assert.equal(satisfiesSemver("23.0.0", ">=22.13.0 <23"), false);
  assert.equal(satisfiesSemver("1.8.0", "^1.2.3"), true);
  assert.equal(satisfiesSemver("2.0.0", "^1.2.3"), false);
  assert.equal(satisfiesSemver("22.9.0", "22"), true);
  assert.equal(satisfiesSemver("22.9.0", "lts/*"), null);
});

test("Git origins normalize to owner/repository without retaining credentials", () => {
  assert.equal(
    normalizeRepositoryRemote("https://user:ghp_raw-secret@github.com/acme/dayone.git?token=also-secret"),
    "acme/dayone",
  );
  assert.equal(normalizeRepositoryRemote("git@github.com:acme/dayone.git"), "acme/dayone");
  assert.equal(normalizeRepositoryRemote("ssh://git@github.com/acme/dayone.git"), "acme/dayone");
  assert.equal(normalizeRepositoryRemote("https://gitlab.example.com/acme/dayone.git"), null);
  assert.equal(normalizeRepositoryRemote("ssh://git@gitlab.example.com/acme/dayone.git"), null);
  assert.equal(normalizeRepositoryRemote("git://github.com/acme/dayone.git"), null);
  assert.equal(normalizeRepositoryRemote("https://github.com.evil.example/acme/dayone.git"), null);
  assert.equal(normalizeRepositoryRemote("file:///Users/private-user/dayone.git"), null);
  assert.equal(normalizeRepositoryRemote("/Users/private-user/dayone.git"), null);
});

test("health host allowlist accepts only explicit loopback names and addresses", () => {
  for (const hostname of ["localhost", "dev.localhost", "api.dev.localhost.", "127.0.0.1", "127.255.4.3", "[::1]"]) {
    assert.equal(isLoopbackHealthHostname(hostname), true, hostname);
  }
  for (const hostname of ["example.com", "localhost.example.com", "127.0.0.1.example.com", "::ffff:127.0.0.1", "10.0.0.1"]) {
    assert.equal(isLoopbackHealthHostname(hostname), false, hostname);
  }
});

test("environment parser identifies required and optional keys without exposing values", () => {
  const parsed = parseEnvFile(`
API_KEY="secret value"
# optional for local analytics
ANALYTICS_ID=
DEBUG=0 # optional
export REGION=tw
`);

  assert.deepEqual(parsed.get("API_KEY"), { value: "secret value", optional: false });
  assert.deepEqual(parsed.get("ANALYTICS_ID"), { value: "", optional: true });
  assert.deepEqual(parsed.get("DEBUG"), { value: "0", optional: true });
  assert.deepEqual(parsed.get("REGION"), { value: "tw", optional: false });
});

test("doctor returns a passing structured report for a ready project", async (t) => {
  const projectPath = await makeProject(t, {
    files: {
      ".nvmrc": "22\n",
      "package-lock.json": "{}\n",
      ".env.example": "API_KEY=\nANALYTICS_ID= # optional\n",
      ".env.local": "API_KEY=configured\n",
      "Dockerfile": "FROM node:22-alpine\n",
      "node_modules/example-dependency/package.json": '{"name":"example-dependency","version":"1.4.0"}\n',
    },
  });

  const report = await runDoctor({
    cwd: projectPath,
    runtimeVersion: "v22.15.0",
    env: {},
    now: () => new Date("2026-08-06T00:00:00.000Z"),
    commandRunner: successfulCommandRunner(projectPath),
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.generatedAt, "2026-08-06T00:00:00.000Z");
  assert.equal(report.project.repository, "acme/healthy-project");
  assert.equal(report.project.repositoryHost, "github.com");
  assert.deepEqual(report.summary, {
    status: "pass",
    counts: { pass: 7, warn: 0, fail: 0 },
    exitCode: 0,
  });
  assert.deepEqual(report.checks.map((item) => item.id), [
    "node-version",
    "node-version-file",
    "package-manager",
    "git",
    "dependencies",
    "environment",
    "docker",
  ]);
  assert.match(formatHuman(report), /7 passed · 0 warnings · 0 failed/);
  assert.doesNotMatch(JSON.stringify(report), /API_KEY=configured|secret value/);
  assert.doesNotMatch(JSON.stringify(report), /ghp_raw-secret|also-secret|x-access-token/);
  assert.equal(report.checks.some((item) => item.id === "local-health"), false, "no URL means no synthetic health pass");
});

test("Git without an origin remains a warning and exports a null repository", async (t) => {
  const projectPath = await makeProject(t, {
    files: {
      ".nvmrc": "22\n",
      "package-lock.json": "{}\n",
      ".env.example": "API_KEY=\n",
      ".env.local": "API_KEY=configured\n",
      "node_modules/example-dependency/package.json": '{"name":"example-dependency","version":"1.4.0"}\n',
    },
  });
  const baseRunner = successfulCommandRunner(projectPath);
  const commandRunner = async (command, args, options) => {
    if (command === "git" && args[0] === "config") {
      return { ok: false, code: 1, stdout: "", stderr: "origin is not configured" };
    }
    return baseRunner(command, args, options);
  };

  const report = await runDoctor({
    cwd: projectPath,
    runtimeVersion: "v22.15.0",
    env: {},
    commandRunner,
  });
  const git = report.checks.find((item) => item.id === "git");
  const exported = redactReportForExport(report);

  assert.equal(git.status, "warn");
  assert.equal(git.details.repository, null);
  assert.equal(report.project.repository, null);
  assert.equal(report.project.repositoryHost, null);
  assert.equal(exported.project.repository, null);
  assert.equal(exported.project.repositoryHost, null);
  assert.deepEqual(report.summary.counts, { pass: 6, warn: 1, fail: 0 });
});

test("configured local health endpoint passes only with a loopback 2xx DayOne signature", async (t) => {
  const projectPath = await makeProject(t, {
    files: {
      ".nvmrc": "22\n",
      "package-lock.json": "{}\n",
      ".env.example": "API_KEY=\n",
      ".env.local": "API_KEY=configured\n",
      "node_modules/example-dependency/package.json": '{"name":"example-dependency","version":"1.4.0"}\n',
    },
  });
  let requestedUrl;

  const report = await runDoctor({
    cwd: projectPath,
    runtimeVersion: "v22.15.0",
    env: { DAYONE_HEALTH_URL: "http://127.0.0.1:3000/health?token=super-secret#fragment" },
    commandRunner: successfulCommandRunner(projectPath),
    fetchImpl: async (url) => {
      requestedUrl = url.toString();
      return new Response(JSON.stringify({ service: "dayone-web", status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const health = report.checks.find((item) => item.id === "local-health");
  assert.equal(health.status, "pass");
  assert.equal(health.details.statusCode, 200);
  assert.equal(health.details.signatureValid, true);
  assert.equal(health.details.bodyLimitBytes, HEALTH_BODY_LIMIT_BYTES);
  assert.equal(health.details.url, "http://127.0.0.1:3000/health?<redacted>");
  assert.doesNotMatch(JSON.stringify(report), /super-secret|fragment/);
  assert.equal(requestedUrl, "http://127.0.0.1:3000/health?token=super-secret");
  assert.deepEqual(report.summary.counts, { pass: 8, warn: 0, fail: 0 });
});

test("external health URL fails before any fetch is attempted", async (t) => {
  const projectPath = await makeProject(t, {
    files: {
      ".nvmrc": "22\n",
      "package-lock.json": "{}\n",
      ".env.example": "API_KEY=\n",
      ".env.local": "API_KEY=configured\n",
      "node_modules/example-dependency/package.json": '{"name":"example-dependency","version":"1.4.0"}\n',
    },
  });
  let fetchCalls = 0;

  const report = await runDoctor({
    cwd: projectPath,
    runtimeVersion: "v22.15.0",
    env: {},
    healthUrl: "https://example.com/health?token=must-not-leak",
    commandRunner: successfulCommandRunner(projectPath),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fetch must not run");
    },
  });

  const health = report.checks.find((item) => item.id === "local-health");
  assert.equal(fetchCalls, 0);
  assert.equal(health.status, "fail");
  assert.match(health.message, /loopback host/);
  assert.equal(health.details.url, "https://example.com/health?<redacted>");
  assert.doesNotMatch(JSON.stringify(report), /must-not-leak/);
});

test("local health endpoint rejects non-2xx, impostor, oversized, and stalled responses", async (t) => {
  const projectPath = await makeProject(t, {
    files: {
      ".nvmrc": "22\n",
      "package-lock.json": "{}\n",
      ".env.example": "API_KEY=\n",
      ".env.local": "API_KEY=configured\n",
      "node_modules/example-dependency/package.json": '{"name":"example-dependency","version":"1.4.0"}\n',
    },
  });
  const common = {
    cwd: projectPath,
    runtimeVersion: "v22.15.0",
    env: {},
    healthUrl: "http://localhost:3000/health",
    commandRunner: successfulCommandRunner(projectPath),
  };

  const unavailable = await runDoctor({
    ...common,
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
  });
  const unavailableHealth = unavailable.checks.find((item) => item.id === "local-health");
  assert.equal(unavailableHealth.status, "fail");
  assert.equal(unavailableHealth.details.statusCode, 503);
  assert.equal(unavailable.summary.exitCode, 1);

  const impostor = await runDoctor({
    ...common,
    fetchImpl: async () => new Response(JSON.stringify({ service: "some-other-app", status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const impostorHealth = impostor.checks.find((item) => item.id === "local-health");
  assert.equal(impostorHealth.status, "fail");
  assert.equal(impostorHealth.details.signatureValid, false);
  assert.match(impostorHealth.message, /did not contain the DayOne health signature/);

  const oversized = await runDoctor({
    ...common,
    fetchImpl: async () => new Response(JSON.stringify({
      service: "dayone-web",
      status: "ok",
      padding: "x".repeat(HEALTH_BODY_LIMIT_BYTES),
    }), { status: 200 }),
  });
  const oversizedHealth = oversized.checks.find((item) => item.id === "local-health");
  assert.equal(oversizedHealth.status, "fail");
  assert.match(oversizedHealth.message, new RegExp(`exceeds ${HEALTH_BODY_LIMIT_BYTES} bytes`));

  const timedOut = await runDoctor({
    ...common,
    healthTimeout: 5,
    fetchImpl: async () => new Response(new ReadableStream({ start() {} }), { status: 200 }),
  });
  const timedOutHealth = timedOut.checks.find((item) => item.id === "local-health");
  assert.equal(timedOutHealth.status, "fail");
  assert.match(timedOutHealth.message, /timed out after 5 ms/);
});

test("doctor fails every blocking check and uses exit code 1", async (t) => {
  const projectPath = await makeProject(t, {
    packageJson: {
      name: "blocked-project",
      engines: { node: ">=99" },
      packageManager: "pnpm@9.0.0",
      dependencies: { missing: "1.0.0" },
    },
    files: {
      ".nvmrc": "99\n",
      "package-lock.json": "{}\n",
      ".env.example": "DATABASE_URL=\n",
      "Dockerfile": "FROM node:22\n",
    },
  });

  const commandRunner = async (command, args) => {
    if (command === "git" && args[0] === "rev-parse") {
      return { ok: false, code: 128, stdout: "", stderr: "not a repository" };
    }
    if (command === "docker") return { ok: false, code: null, stdout: "", stderr: "not found" };
    return { ok: false, code: 1, stdout: "", stderr: "unavailable" };
  };

  const report = await runDoctor({
    cwd: projectPath,
    runtimeVersion: "v22.15.0",
    env: {},
    commandRunner,
  });

  assert.equal(report.summary.status, "fail");
  assert.equal(report.summary.exitCode, 1);
  assert.equal(report.summary.counts.fail, 7);
  assert.equal(report.checks.find((item) => item.id === "environment").details.missing[0], "DATABASE_URL");
});

test("argument parser accepts JSON and health options but rejects removed delivery flags", () => {
  const parsed = parseArgs([
    "./project",
    "--json",
    "--health-url",
    "http://localhost:3000/health",
  ]);
  assert.equal(parsed.cwd, "./project");
  assert.equal(parsed.json, true);
  assert.equal(parsed.healthUrl, "http://localhost:3000/health");

  assert.throws(() => parseArgs(["--health-url="]), /requires a value/);
  assert.throws(() => parseArgs(["--send"]), /Unknown option/);
  assert.throws(() => parseArgs(["--api-url=https://dayone.test"]), /Unknown option/);
  assert.throws(() => parseArgs(["--token=unsupported"]), /Unknown option/);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown option/);
});

test("JSON export removes local filesystem and health endpoint details for UI import", () => {
  const report = {
    schemaVersion: 1,
    project: {
      name: "dayone",
      path: "/Users/private-user/work/dayone",
      repository: "acme/dayone",
      repositoryHost: "github.com",
    },
    summary: { status: "pass" },
    checks: [
      {
        id: "git",
        details: {
          root: "/Users/private-user/work/dayone",
          branch: "main",
          repository: "acme/dayone",
          repositoryHost: "github.com",
        },
      },
      { id: "local-health", status: "pass", details: { url: "http://127.0.0.1:3000/health?token=secret" } },
    ],
  };

  const exported = redactReportForExport(report);
  const serialized = JSON.stringify(exported);
  assert.equal(exported.project.path, "dayone");
  assert.equal(exported.project.repository, "acme/dayone");
  assert.equal(exported.project.repositoryHost, "github.com");
  assert.equal(exported.checks[0].details.root, "dayone");
  assert.equal(exported.checks[1].details.url, "<redacted>");
  assert.doesNotMatch(serialized, /private-user|127\.0\.0\.1|token=secret/);
  assert.equal(report.project.path, "/Users/private-user/work/dayone", "the local report remains unchanged");

  const nonGitHub = redactReportForExport({
    project: { name: "dayone", path: "/work/dayone", repository: "acme/dayone", repositoryHost: "gitlab.com" },
    checks: [{ id: "git", details: { repository: "acme/dayone", repositoryHost: "gitlab.com" } }],
  });
  assert.equal(nonGitHub.project.repository, null);
  assert.equal(nonGitHub.project.repositoryHost, null);
});

test("CLI can be run directly with Node", async () => {
  const result = await execFileAsync(process.execPath, [path.join(repositoryRoot, "cli/dayone.mjs"), "--version"], {
    cwd: repositoryRoot,
  });
  assert.equal(result.stdout.trim(), CLI_VERSION);
  assert.equal(result.stderr, "");

  const help = await execFileAsync(process.execPath, [path.join(repositoryRoot, "cli/dayone.mjs"), "--help"], {
    cwd: repositoryRoot,
  });
  assert.match(help.stdout, /--health-url/);
  assert.doesNotMatch(help.stdout, /--send|--api-url|--token|DAYONE_API/);
});
