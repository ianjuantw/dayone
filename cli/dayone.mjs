#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

export const CLI_VERSION = "0.1.0";
export const REPORT_SCHEMA_VERSION = 1;
export const HEALTH_BODY_LIMIT_BYTES = 16 * 1024;

const LOCKFILES = new Map([
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
]);

const SUPPORTED_PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const DOCKER_FILES = new Set([
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
]);

export class DoctorUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "DoctorUsageError";
  }
}

export async function defaultCommandRunner(command, args = [], options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: options.timeout ?? 5_000,
      windowsHide: true,
    });

    return {
      ok: true,
      code: 0,
      stdout: result.stdout?.trim() ?? "",
      stderr: result.stderr?.trim() ?? "",
    };
  } catch (error) {
    return {
      ok: false,
      code: typeof error.code === "number" ? error.code : null,
      stdout: error.stdout?.trim() ?? "",
      stderr: error.stderr?.trim() || error.message,
    };
  }
}

function check(id, title, status, message, extra = {}) {
  return { id, title, status, message, ...extra };
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readProjectPackage(projectPath) {
  try {
    const source = await readFile(path.join(projectPath, "package.json"), "utf8");
    return { value: JSON.parse(source), error: null };
  } catch (error) {
    const reason = error.code === "ENOENT" ? "package.json was not found" : error.message;
    return { value: null, error: reason };
  }
}

export function parseSemver(input) {
  if (typeof input !== "string") return null;
  const match = input.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/i);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    precision: match[3] !== undefined ? 3 : match[2] !== undefined ? 2 : 1,
  };
}

function compareSemver(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] > right[key]) return 1;
    if (left[key] < right[key]) return -1;
  }
  return 0;
}

function versionAt(major, minor = 0, patch = 0) {
  return { major, minor, patch, precision: 3 };
}

function within(version, lower, upper) {
  return compareSemver(version, lower) >= 0 && compareSemver(version, upper) < 0;
}

function evaluateVersionToken(version, rawToken) {
  const token = rawToken.trim();
  if (!token || token === "*" || /^x$/i.test(token)) return true;

  if (token.startsWith("^") || token.startsWith("~")) {
    const operator = token[0];
    const base = parseSemver(token.slice(1));
    if (!base) return null;

    let upper;
    if (operator === "~") {
      upper = base.precision === 1
        ? versionAt(base.major + 1)
        : versionAt(base.major, base.minor + 1);
    } else if (base.major > 0) {
      upper = versionAt(base.major + 1);
    } else if (base.minor > 0) {
      upper = versionAt(0, base.minor + 1);
    } else {
      upper = versionAt(0, 0, base.patch + 1);
    }
    return within(version, base, upper);
  }

  const wildcard = token.match(/^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i);
  if (wildcard && [wildcard[2], wildcard[3]].some((part) => part === "x" || part === "X" || part === "*")) {
    const major = Number(wildcard[1]);
    if (!wildcard[2] || /^(?:x|\*)$/i.test(wildcard[2])) {
      return within(version, versionAt(major), versionAt(major + 1));
    }
    const minor = Number(wildcard[2]);
    return within(version, versionAt(major, minor), versionAt(major, minor + 1));
  }

  const comparator = token.match(/^(>=|<=|>|<|=)?\s*(v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?)$/);
  if (!comparator) return null;
  const operator = comparator[1] ?? "";
  const expected = parseSemver(comparator[2]);
  if (!expected) return null;
  const comparison = compareSemver(version, expected);

  if (operator === ">=") return comparison >= 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">") return comparison > 0;
  if (operator === "<") return comparison < 0;
  if (operator === "=") return comparison === 0;

  if (expected.precision === 1) {
    return within(version, versionAt(expected.major), versionAt(expected.major + 1));
  }
  if (expected.precision === 2) {
    return within(
      version,
      versionAt(expected.major, expected.minor),
      versionAt(expected.major, expected.minor + 1),
    );
  }
  return comparison === 0;
}

export function satisfiesSemver(versionInput, rangeInput) {
  const version = typeof versionInput === "string" ? parseSemver(versionInput) : versionInput;
  if (!version || typeof rangeInput !== "string" || !rangeInput.trim()) return null;

  const normalized = rangeInput.trim().replace(/,/g, " ");
  if (/^(?:latest|stable|node|lts(?:\/\*)?|--lts)$/i.test(normalized)) return null;

  let understoodAnyBranch = false;
  for (const rawBranch of normalized.split("||")) {
    let branch = rawBranch.trim();
    const hyphenRange = branch.match(/^(v?\d+(?:\.\d+){0,2})\s+-\s+(v?\d+(?:\.\d+){0,2})$/);
    if (hyphenRange) branch = `>=${hyphenRange[1]} <=${hyphenRange[2]}`;

    const tokens = branch.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const results = tokens.map((token) => evaluateVersionToken(version, token));
    if (results.every((result) => result !== null)) {
      understoodAnyBranch = true;
      if (results.every(Boolean)) return true;
    }
  }

  return understoodAnyBranch ? false : null;
}

async function checkNodeVersion({ packageInfo, runtimeVersion }) {
  const detected = parseSemver(runtimeVersion);
  if (!detected) {
    return check("node-version", "Node.js", "fail", `Could not parse Node.js version ${runtimeVersion}.`, {
      remediation: "Install a supported Node.js release and run the doctor again.",
    });
  }

  const requirement = packageInfo.value?.engines?.node;
  if (!requirement) {
    return check("node-version", "Node.js", "pass", `Detected Node.js ${runtimeVersion}; no engines.node range is declared.`, {
      details: { detected: runtimeVersion, requirement: null },
    });
  }

  const satisfies = satisfiesSemver(detected, requirement);
  if (satisfies === false) {
    return check("node-version", "Node.js", "fail", `Node.js ${runtimeVersion} does not satisfy ${requirement}.`, {
      details: { detected: runtimeVersion, requirement },
      remediation: "Switch to a compatible Node.js version (for example with nvm) and reinstall dependencies.",
    });
  }
  if (satisfies === null) {
    return check("node-version", "Node.js", "warn", `Detected Node.js ${runtimeVersion}, but the range ${requirement} could not be evaluated.`, {
      details: { detected: runtimeVersion, requirement },
      remediation: "Confirm the engines.node range manually.",
    });
  }

  return check("node-version", "Node.js", "pass", `Node.js ${runtimeVersion} satisfies ${requirement}.`, {
    details: { detected: runtimeVersion, requirement },
  });
}

async function checkNvmrc({ projectPath, runtimeVersion }) {
  const nvmrcPath = path.join(projectPath, ".nvmrc");
  let requirement;
  try {
    requirement = (await readFile(nvmrcPath, "utf8")).trim();
  } catch (error) {
    if (error.code === "ENOENT") {
      return check("node-version-file", ".nvmrc", "warn", "No .nvmrc file was found.", {
        remediation: "Add .nvmrc to make the expected Node.js version easy to select.",
      });
    }
    return check("node-version-file", ".nvmrc", "fail", `Could not read .nvmrc: ${error.message}`);
  }

  if (!requirement) {
    return check("node-version-file", ".nvmrc", "fail", ".nvmrc is empty.", {
      remediation: "Put a Node.js version or nvm alias in .nvmrc.",
    });
  }

  const satisfies = satisfiesSemver(runtimeVersion, requirement);
  if (satisfies === false) {
    return check("node-version-file", ".nvmrc", "fail", `Node.js ${runtimeVersion} does not match .nvmrc (${requirement}).`, {
      details: { detected: runtimeVersion, requirement },
      remediation: "Run `nvm use` and reinstall dependencies.",
    });
  }
  if (satisfies === null) {
    return check("node-version-file", ".nvmrc", "warn", `.nvmrc uses the alias ${requirement}; verify the selected release manually.`, {
      details: { detected: runtimeVersion, requirement },
    });
  }

  return check("node-version-file", ".nvmrc", "pass", `Node.js ${runtimeVersion} matches .nvmrc (${requirement}).`, {
    details: { detected: runtimeVersion, requirement },
  });
}

function parsePackageManagerDeclaration(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const match = value.trim().match(/^([a-z][a-z0-9-]*)(?:@(.+))?$/i);
  if (!match) return { name: null, version: null, raw: value };
  return { name: match[1].toLowerCase(), version: match[2]?.split("+")[0] ?? null, raw: value };
}

async function checkPackageManager({ projectPath, packageInfo, commandRunner }) {
  if (!packageInfo.value) {
    return check("package-manager", "Package manager", "fail", packageInfo.error, {
      remediation: "Run the doctor from a JavaScript project that contains package.json.",
    });
  }

  const discovered = [];
  for (const [filename, manager] of LOCKFILES) {
    if (await fileExists(path.join(projectPath, filename))) discovered.push({ filename, manager });
  }

  const declaration = parsePackageManagerDeclaration(packageInfo.value.packageManager);
  const managers = [...new Set(discovered.map((entry) => entry.manager))];
  const details = {
    declared: declaration?.raw ?? null,
    detected: managers,
    lockfiles: discovered.map((entry) => entry.filename),
  };

  if (declaration && (!declaration.name || !SUPPORTED_PACKAGE_MANAGERS.has(declaration.name))) {
    return check("package-manager", "Package manager", "fail", `Unsupported packageManager declaration: ${declaration.raw}.`, {
      details,
      remediation: "Use npm, pnpm, yarn, or bun and commit its lockfile.",
    });
  }
  if (discovered.length === 0) {
    return check("package-manager", "Package manager", "fail", "No supported lockfile was found.", {
      details,
      remediation: "Install dependencies with the project's package manager and commit its lockfile.",
    });
  }
  if (discovered.length > 1 || managers.length > 1) {
    return check("package-manager", "Package manager", "fail", `Multiple lockfiles were found: ${details.lockfiles.join(", ")}.`, {
      details,
      remediation: "Keep only the lockfile for the package manager used by this project.",
    });
  }

  const detectedManager = managers[0];
  if (declaration?.name && declaration.name !== detectedManager) {
    return check("package-manager", "Package manager", "fail", `${declaration.raw} conflicts with ${discovered[0].filename}.`, {
      details,
      remediation: "Align packageManager with the committed lockfile.",
    });
  }

  const manager = declaration?.name ?? detectedManager;
  const versionResult = await commandRunner(manager, ["--version"], { cwd: projectPath, timeout: 3_000 });
  details.version = versionResult.ok ? versionResult.stdout.split(/\s+/)[0] : null;
  if (!versionResult.ok) {
    return check("package-manager", "Package manager", "fail", `${manager} is required by ${discovered[0].filename}, but it is not available.`, {
      details,
      remediation: `Install or enable ${manager}, then install dependencies.`,
    });
  }

  if (declaration?.version) {
    const versionMatches = satisfiesSemver(details.version, declaration.version);
    if (versionMatches === false) {
      return check("package-manager", "Package manager", "fail", `${manager} ${details.version} does not match ${declaration.version}.`, {
        details,
        remediation: `Activate ${declaration.raw} and reinstall dependencies.`,
      });
    }
  }

  return check("package-manager", "Package manager", "pass", `${manager} ${details.version} is available and ${discovered[0].filename} is present.`, {
    details,
  });
}

function safeRepositorySegment(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(value)) return false;
  if (value === "." || value === "..") return false;
  return !/^(?:github_pat_|gh[pousr]_|glpat-|xox[baprs]-|AKIA)/i.test(value);
}

function safeRepositorySlug(owner, repository) {
  if (!safeRepositorySegment(owner) || !safeRepositorySegment(repository)) return null;
  return `${owner}/${repository}`;
}

function normalizeRepositorySlug(value) {
  if (typeof value !== "string") return null;
  const segments = value.split("/");
  if (segments.length !== 2) return null;
  return safeRepositorySlug(segments[0], segments[1]);
}

export function normalizeRepositoryRemote(remote) {
  if (typeof remote !== "string" || !remote.trim()) return null;
  const value = remote.trim();
  let remotePath;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!new Set(["https:", "ssh:"]).has(url.protocol) || hostname !== "github.com") return null;
    remotePath = decodeURIComponent(url.pathname);
  } catch {
    const scpStyle = value.match(/^(?:[^@\s/:]+@)?(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):(.+)$/);
    if (!scpStyle) return null;
    const hostname = scpStyle[1].toLowerCase().replace(/\.$/, "");
    if (hostname !== "github.com") return null;
    try {
      remotePath = decodeURIComponent(scpStyle[2].split(/[?#]/, 1)[0]);
    } catch {
      return null;
    }
  }

  const segments = remotePath
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  if (segments.length < 2) return null;
  return safeRepositorySlug(segments.at(-2), segments.at(-1));
}

async function checkGit({ projectPath, commandRunner }) {
  const rootResult = await commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd: projectPath });
  if (!rootResult.ok) {
    return check("git", "Git", "fail", "This directory is not inside an accessible Git repository.", {
      remediation: "Clone the repository with Git or initialize it before continuing.",
    });
  }

  const [branchResult, remoteResult] = await Promise.all([
    commandRunner("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: projectPath }),
    commandRunner("git", ["config", "--get", "remote.origin.url"], { cwd: projectPath }),
  ]);
  const repository = remoteResult.ok ? normalizeRepositoryRemote(remoteResult.stdout) : null;
  const repositoryHost = repository ? "github.com" : null;
  if (!branchResult.ok || !branchResult.stdout) {
    const commitResult = await commandRunner("git", ["rev-parse", "--short", "HEAD"], { cwd: projectPath });
    return check("git", "Git", "warn", `Repository detected, but HEAD is detached${commitResult.ok ? ` at ${commitResult.stdout}` : ""}.`, {
      details: {
        root: rootResult.stdout,
        branch: null,
        commit: commitResult.ok ? commitResult.stdout : null,
        repository,
        repositoryHost,
      },
      remediation: "Switch to a working branch before making changes.",
    });
  }

  if (!repository) {
    return check("git", "Git", "warn", `Git repository is on branch ${branchResult.stdout}, but no safe origin could be identified.`, {
      details: {
        root: rootResult.stdout,
        branch: branchResult.stdout,
        repository: null,
        repositoryHost: null,
      },
      remediation: "Add an origin remote with an owner/repository path before importing release evidence.",
    });
  }

  return check("git", "Git", "pass", `Git repository ${repository} is on branch ${branchResult.stdout}.`, {
    details: { root: rootResult.stdout, branch: branchResult.stdout, repository, repositoryHost },
  });
}

function dependencyEntries(packageJson) {
  return Object.entries({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  });
}

function dependencyRangeIsCheckable(range) {
  return typeof range === "string" && !/^(?:file:|git(?:\+|:)|https?:|workspace:|link:|npm:|github:)/i.test(range);
}

async function checkDependencies({ projectPath, packageInfo }) {
  if (!packageInfo.value) {
    return check("dependencies", "Dependencies", "fail", packageInfo.error, {
      remediation: "Restore package.json and install the project dependencies.",
    });
  }

  const dependencies = dependencyEntries(packageInfo.value);
  if (dependencies.length === 0) {
    return check("dependencies", "Dependencies", "pass", "package.json declares no runtime or development dependencies.", {
      details: { declared: 0, missing: [], incompatible: [] },
    });
  }

  const missing = [];
  const incompatible = [];
  for (const [name, range] of dependencies) {
    const packagePath = path.resolve(projectPath, "node_modules", name, "package.json");
    const modulesRoot = `${path.resolve(projectPath, "node_modules")}${path.sep}`;
    if (!packagePath.startsWith(modulesRoot)) {
      missing.push(name);
      continue;
    }

    try {
      const installed = JSON.parse(await readFile(packagePath, "utf8"));
      if (installed.version && dependencyRangeIsCheckable(range)) {
        const compatible = satisfiesSemver(installed.version, range);
        if (compatible === false) incompatible.push(`${name} (${installed.version}, expected ${range})`);
      }
    } catch {
      missing.push(name);
    }
  }

  const details = { declared: dependencies.length, missing, incompatible };
  if (missing.length > 0 || incompatible.length > 0) {
    const parts = [];
    if (missing.length) parts.push(`${missing.length} missing`);
    if (incompatible.length) parts.push(`${incompatible.length} incompatible`);
    return check("dependencies", "Dependencies", "fail", `Dependency installation is incomplete (${parts.join(", ")}).`, {
      details,
      remediation: "Run the install command for the detected package manager.",
    });
  }

  return check("dependencies", "Dependencies", "pass", `All ${dependencies.length} declared dependencies are installed.`, {
    details,
  });
}

export function parseEnvFile(source) {
  const values = new Map();
  let precedingOptional = false;

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      precedingOptional = false;
      continue;
    }
    if (trimmed.startsWith("#")) {
      precedingOptional = /\boptional\b/i.test(trimmed);
      continue;
    }

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      precedingOptional = false;
      continue;
    }

    const rawValue = match[2];
    const inlineOptional = /(?:#|;)\s*optional\b/i.test(rawValue);
    let value = rawValue.replace(/\s+(?:#|;)\s*optional\b.*$/i, "").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }

    values.set(match[1], { value, optional: precedingOptional || inlineOptional });
    precedingOptional = false;
  }

  return values;
}

async function checkEnvironment({ projectPath, env }) {
  let entries;
  try {
    entries = await readdir(projectPath, { withFileTypes: true });
  } catch (error) {
    return check("environment", "Environment", "fail", `Could not inspect environment files: ${error.message}`);
  }

  const filenames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const examples = filenames
    .filter((name) => /^\.env(?:\.[A-Za-z0-9_-]+)*\.(?:example|sample|template)$/i.test(name))
    .sort();
  if (examples.length === 0) {
    return check("environment", "Environment", "warn", "No .env example, sample, or template file was found.", {
      details: { examples: [], localFiles: [], required: [], missing: [] },
      remediation: "Add an environment template if contributors need configuration values.",
    });
  }

  const localFiles = filenames
    .filter((name) => /^\.env(?:\.[A-Za-z0-9_-]+)*$/i.test(name))
    .filter((name) => !/\.(?:example|sample|template)$/i.test(name))
    .sort();

  const requirements = new Map();
  for (const filename of examples) {
    const parsed = parseEnvFile(await readFile(path.join(projectPath, filename), "utf8"));
    for (const [name, entry] of parsed) {
      const previous = requirements.get(name);
      requirements.set(name, { optional: (previous?.optional ?? true) && entry.optional });
    }
  }

  const configured = new Set();
  for (const filename of localFiles) {
    const parsed = parseEnvFile(await readFile(path.join(projectPath, filename), "utf8"));
    for (const [name, entry] of parsed) {
      if (entry.value.trim()) configured.add(name);
    }
  }
  for (const name of requirements.keys()) {
    if (Object.prototype.hasOwnProperty.call(env, name) && String(env[name] ?? "").trim()) configured.add(name);
  }

  const required = [...requirements].filter(([, entry]) => !entry.optional).map(([name]) => name).sort();
  const missing = required.filter((name) => !configured.has(name));
  const details = { examples, localFiles, required, missing };
  if (missing.length > 0) {
    return check("environment", "Environment", "fail", `${missing.length} required environment variable${missing.length === 1 ? " is" : "s are"} missing.`, {
      details,
      remediation: `Configure: ${missing.join(", ")}. Values are never included in the report.`,
    });
  }

  return check("environment", "Environment", "pass", `All ${required.length} required environment variables are configured.`, {
    details,
  });
}

async function checkDocker({ projectPath, commandRunner }) {
  const entries = await readdir(projectPath, { withFileTypes: true });
  const projectFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^Dockerfile(?:\..+)?$/.test(name) || DOCKER_FILES.has(name));
  const required = projectFiles.length > 0;

  const versionResult = await commandRunner("docker", ["--version"], { cwd: projectPath, timeout: 3_000 });
  if (!versionResult.ok) {
    return check("docker", "Docker", required ? "fail" : "warn", required
      ? `Docker is required by ${projectFiles.join(", ")}, but the CLI is unavailable.`
      : "Docker CLI is not available; this project does not declare Docker configuration.", {
      details: { required, projectFiles, cli: null, server: null },
      remediation: required ? "Install Docker and start its daemon." : "Install Docker only if your workflow needs it.",
    });
  }

  const infoResult = await commandRunner("docker", ["info", "--format", "{{.ServerVersion}}"], {
    cwd: projectPath,
    timeout: 4_000,
  });
  const details = {
    required,
    projectFiles,
    cli: versionResult.stdout,
    server: infoResult.ok ? infoResult.stdout : null,
  };
  if (!infoResult.ok) {
    return check("docker", "Docker", required ? "fail" : "warn", required
      ? "Docker CLI is installed, but its daemon is not reachable."
      : "Docker CLI is installed, but its daemon is not reachable; Docker is not required by this project.", {
      details,
      remediation: required ? "Start Docker Desktop or the Docker daemon." : "Start Docker only if your workflow needs it.",
    });
  }

  return check("docker", "Docker", "pass", `Docker is available${infoResult.stdout ? ` (server ${infoResult.stdout})` : ""}.`, {
    details,
  });
}

function redactHealthUrl(value) {
  try {
    const url = new URL(String(value));
    const queryMarker = url.search ? "?<redacted>" : "";
    return `${url.origin}${url.pathname || "/"}${queryMarker}`;
  } catch {
    return "<invalid>";
  }
}

export function isLoopbackHealthHostname(hostname) {
  let normalized = String(hostname).trim().toLowerCase().replace(/\.$/, "");
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized === "localhost") return true;
  if (normalized.length > ".localhost".length && normalized.endsWith(".localhost")) return true;
  if (normalized === "::1") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(normalized)) {
    return normalized.split(".").every((part) => Number(part) <= 255);
  }
  return false;
}

function healthAbortError() {
  const error = new Error("Local health response timed out.");
  error.name = "AbortError";
  return error;
}

function readStreamChunk(reader, signal) {
  if (signal.aborted) return Promise.reject(healthAbortError());

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      try {
        Promise.resolve(reader.cancel()).catch(() => {});
      } catch {
        // The abort still rejects the read even if stream cleanup fails.
      }
      finish(reject, healthAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    try {
      reader.read().then(
        (result) => finish(resolve, result),
        (error) => finish(reject, error),
      );
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function readLimitedHealthBody(response, signal) {
  const reader = response.body?.getReader?.();
  if (!reader) return "";

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await readStreamChunk(reader, signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > HEALTH_BODY_LIMIT_BYTES) {
        try {
          Promise.resolve(reader.cancel()).catch(() => {});
        } catch {
          // The size guard has already stopped body consumption.
        }
        const error = new Error("Local health response is too large.");
        error.name = "HealthBodyTooLargeError";
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A pending aborted read can retain the lock until fetch cleanup completes.
    }
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function discardResponseBody(response) {
  try {
    Promise.resolve(response.body?.cancel()).catch(() => {});
  } catch {
    // Response bodies are never required after a failed status check.
  }
}

function hasDayOneHealthSignature(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && value.service === "dayone-web"
    && value.status === "ok";
}

async function checkLocalHealth({ healthUrl, healthTimeout, fetchImpl }) {
  const safeUrl = redactHealthUrl(healthUrl);
  let url;
  try {
    url = new URL(String(healthUrl));
  } catch {
    return check("local-health", "Local app", "fail", "The configured health URL is invalid.", {
      details: { url: safeUrl, statusCode: null, timeoutMs: healthTimeout },
      remediation: "Use an absolute http or https URL for --health-url or DAYONE_HEALTH_URL.",
    });
  }

  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    return check("local-health", "Local app", "fail", "The configured health URL must use http or https.", {
      details: { url: safeUrl, statusCode: null, timeoutMs: healthTimeout },
      remediation: "Use an absolute http or https URL for --health-url or DAYONE_HEALTH_URL.",
    });
  }
  if (url.username || url.password) {
    return check("local-health", "Local app", "fail", "Embedded credentials are not supported in the health URL.", {
      details: { url: safeUrl, statusCode: null, timeoutMs: healthTimeout },
      remediation: "Remove credentials from the URL and expose an unauthenticated local health endpoint.",
    });
  }
  if (!isLoopbackHealthHostname(url.hostname)) {
    return check("local-health", "Local app", "fail", "The health URL must point to a loopback host.", {
      details: { url: safeUrl, statusCode: null, timeoutMs: healthTimeout },
      remediation: "Use localhost, a .localhost name, 127.0.0.0/8, or ::1.",
    });
  }

  url.hash = "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), healthTimeout);
  let responseStatus = null;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/json, text/plain;q=0.9, */*;q=0.1",
        "user-agent": `dayone-cli/${CLI_VERSION}`,
      },
      redirect: "manual",
      signal: controller.signal,
    });
    responseStatus = response.status;
    const details = {
      url: safeUrl,
      statusCode: response.status,
      timeoutMs: healthTimeout,
      bodyLimitBytes: HEALTH_BODY_LIMIT_BYTES,
      signatureValid: null,
    };
    if (response.status < 200 || response.status >= 300) {
      discardResponseBody(response);
      return check("local-health", "Local app", "fail", `Local health endpoint returned HTTP ${response.status}; expected 2xx.`, {
        details,
        remediation: "Start the app, resolve its startup error, and run the doctor again.",
      });
    }

    const contentLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(contentLength) && contentLength > HEALTH_BODY_LIMIT_BYTES) {
      discardResponseBody(response);
      details.signatureValid = false;
      return check("local-health", "Local app", "fail", `Local health response exceeds ${HEALTH_BODY_LIMIT_BYTES} bytes.`, {
        details,
        remediation: "Use the DayOne /api/health endpoint rather than an application page.",
      });
    }

    let source;
    try {
      source = await readLimitedHealthBody(response, controller.signal);
    } catch (error) {
      if (error.name !== "HealthBodyTooLargeError") throw error;
      details.signatureValid = false;
      return check("local-health", "Local app", "fail", `Local health response exceeds ${HEALTH_BODY_LIMIT_BYTES} bytes.`, {
        details,
        remediation: "Use the DayOne /api/health endpoint rather than an application page.",
      });
    }

    let payload = null;
    try {
      payload = JSON.parse(source);
    } catch {
      // A 2xx response is not evidence unless it has the expected JSON shape.
    }
    details.signatureValid = hasDayOneHealthSignature(payload);
    if (!details.signatureValid) {
      return check("local-health", "Local app", "fail", `HTTP ${response.status} response did not contain the DayOne health signature.`, {
        details,
        remediation: "Use the DayOne /api/health endpoint and confirm the app is the expected service.",
      });
    }

    return check("local-health", "Local app", "pass", `Local DayOne health endpoint returned HTTP ${response.status} with a valid signature.`, {
      details,
    });
  } catch (error) {
    const timedOut = error.name === "AbortError";
    return check("local-health", "Local app", "fail", timedOut
      ? `Local health endpoint timed out after ${healthTimeout} ms.`
      : "Local health endpoint could not be reached.", {
      details: {
        url: safeUrl,
        statusCode: responseStatus,
        timeoutMs: healthTimeout,
        bodyLimitBytes: HEALTH_BODY_LIMIT_BYTES,
        signatureValid: false,
      },
      remediation: "Start the app, confirm the URL, and run the doctor again.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function summarize(checks) {
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const item of checks) counts[item.status] += 1;
  const status = counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass";
  return { status, counts, exitCode: counts.fail > 0 ? 1 : 0 };
}

export async function runDoctor(options = {}) {
  const projectPath = path.resolve(options.cwd ?? process.cwd());
  let projectStat;
  try {
    projectStat = await stat(projectPath);
  } catch {
    throw new DoctorUsageError(`Project directory does not exist: ${projectPath}`);
  }
  if (!projectStat.isDirectory()) throw new DoctorUsageError(`Project path is not a directory: ${projectPath}`);

  const packageInfo = await readProjectPackage(projectPath);
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const env = options.env ?? process.env;
  const configuredTimeout = Number(options.healthTimeout ?? 3_000);
  const healthTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.floor(configuredTimeout)
    : 3_000;
  const context = {
    projectPath,
    packageInfo,
    commandRunner,
    runtimeVersion: options.runtimeVersion ?? process.version,
    env,
    healthUrl: options.healthUrl ?? env.DAYONE_HEALTH_URL,
    healthTimeout,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  };

  const pendingChecks = [
    checkNodeVersion(context),
    checkNvmrc(context),
    checkPackageManager(context),
    checkGit(context),
    checkDependencies(context),
    checkEnvironment(context),
    checkDocker(context),
  ];
  if (context.healthUrl !== undefined && context.healthUrl !== null && String(context.healthUrl).trim()) {
    pendingChecks.push(checkLocalHealth(context));
  }
  const checks = await Promise.all(pendingChecks);
  const gitCheck = checks.find((item) => item.id === "git");
  const repositoryHost = gitCheck?.details?.repositoryHost === "github.com" ? "github.com" : null;
  const repository = repositoryHost
    ? normalizeRepositorySlug(gitCheck?.details?.repository)
    : null;

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: "dayone", version: CLI_VERSION },
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    project: {
      name: packageInfo.value?.name ?? path.basename(projectPath),
      path: projectPath,
      repository,
      repositoryHost,
    },
    summary: summarize(checks),
    checks,
  };
}

export function formatHuman(report) {
  const lines = [
    "DayOne environment doctor",
    `Project: ${report.project.name} (${report.project.path})`,
    "",
  ];
  const labels = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  for (const item of report.checks) {
    lines.push(`[${labels[item.status]}] ${item.title}: ${item.message}`);
    if (item.remediation && item.status !== "pass") lines.push(`       Next: ${item.remediation}`);
  }

  const { counts } = report.summary;
  lines.push(
    "",
    `${counts.pass} passed · ${counts.warn} warning${counts.warn === 1 ? "" : "s"} · ${counts.fail} failed`,
  );
  return `${lines.join("\n")}\n`;
}

function portableBasename(value) {
  const segments = String(value).split(/[\\/]+/).filter(Boolean);
  return segments.at(-1) ?? ".";
}

export function redactReportForExport(report) {
  const redacted = JSON.parse(JSON.stringify(report));
  const gitCheck = redacted.checks?.find((item) => item.id === "git");
  const projectHost = redacted.project?.repositoryHost === "github.com" ? "github.com" : null;
  const gitHost = gitCheck?.details?.repositoryHost === "github.com" ? "github.com" : null;
  const repositoryHost = projectHost ?? gitHost;
  const repository = repositoryHost
    ? normalizeRepositorySlug(
      projectHost ? redacted.project?.repository : gitCheck?.details?.repository,
    )
    : null;
  if (redacted.project) {
    if (redacted.project.path) redacted.project.path = portableBasename(redacted.project.path);
    redacted.project.repository = repository;
    redacted.project.repositoryHost = repository ? repositoryHost : null;
  }

  for (const item of redacted.checks ?? []) {
    if (item.id === "git" && item.details?.root) {
      item.details.root = portableBasename(item.details.root);
    }
    if (item.id === "git" && item.details) {
      item.details.repository = repository;
      item.details.repositoryHost = repository ? repositoryHost : null;
    }
    if (item.id === "local-health" && item.details?.url) {
      item.details.url = "<redacted>";
    }
  }
  return redacted;
}

export function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    json: false,
    healthUrl: null,
    help: false,
    version: false,
  };
  let positionalPath = null;

  const takeValue = (argument, index) => {
    const equals = argument.indexOf("=");
    if (equals !== -1) {
      const value = argument.slice(equals + 1);
      if (!value) throw new DoctorUsageError(`${argument.slice(0, equals)} requires a value.`);
      return { value, nextIndex: index };
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new DoctorUsageError(`${argument} requires a value.`);
    return { value, nextIndex: index + 1 };
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--version" || argument === "-v") options.version = true;
    else if (argument === "--cwd" || argument.startsWith("--cwd=")) {
      const result = takeValue(argument, index);
      options.cwd = result.value;
      index = result.nextIndex;
    } else if (argument === "--health-url" || argument.startsWith("--health-url=")) {
      const result = takeValue(argument, index);
      options.healthUrl = result.value;
      index = result.nextIndex;
    } else if (argument.startsWith("-")) {
      throw new DoctorUsageError(`Unknown option: ${argument}`);
    } else if (positionalPath) {
      throw new DoctorUsageError("Only one project path may be provided.");
    } else {
      positionalPath = argument;
    }
  }

  if (positionalPath) options.cwd = positionalPath;
  return options;
}

export function helpText() {
  return `DayOne environment doctor ${CLI_VERSION}

Usage:
  node cli/dayone.mjs [project-path] [options]

Options:
  --cwd <path>       Project directory (alternative to project-path)
  --json             Print a privacy-redacted report for UI import
  --health-url <url> Check an optional local app endpoint for a 2xx response
  -h, --help         Show this help
  -v, --version      Show the CLI version

Exit codes:
  0  Checks passed (warnings are allowed)
  1  One or more checks failed
  2  Invalid usage or the doctor could not run
`;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`DayOne: ${error.message}\n\n${helpText()}`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  if (options.version) {
    process.stdout.write(`${CLI_VERSION}\n`);
    return;
  }

  let report;
  try {
    report = await runDoctor({ cwd: options.cwd, healthUrl: options.healthUrl });
  } catch (error) {
    process.stderr.write(`DayOne: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  const output = options.json
    ? `${JSON.stringify(redactReportForExport(report), null, 2)}\n`
    : formatHuman(report);
  process.stdout.write(output);
  process.exitCode = report.summary.exitCode;
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main();
