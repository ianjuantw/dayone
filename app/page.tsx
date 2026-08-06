"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = "complete" | "current" | "blocked" | "ready" | "locked";
type CheckStatus = "passed" | "warning" | "blocked" | "pending";
type View = "journey" | "insights";
type Modal = "plan" | "blocker" | "import" | null;

type JourneyTask = {
  id: string;
  key?: string;
  title: string;
  description: string;
  status: Status;
  command?: string;
  source?: string;
};

type JourneyStep = {
  id: string;
  slug: string;
  number: string;
  title: string;
  shortTitle: string;
  summary: string;
  status: Status;
  tasks: JourneyTask[];
};

type DoctorCheck = {
  id: string;
  name: string;
  detail: string;
  status: CheckStatus;
  command?: string;
};

type GuideMessage = {
  id: string;
  role: "guide" | "user";
  text: string;
  sources?: { label: string; section: string; href?: string }[];
};

type BootstrapData = {
  mode: "demo" | "connected";
  schemaVersion: 1;
  profile: {
    name: string;
    initials: string;
    role: string;
    team: string;
    buddy: string;
    targetDate: string;
  };
  repository: { org: string; name: string; branch: string };
  journey: {
    id: string;
    startedAt: string;
    status: string;
    firstMrUrl: string | null;
    firstMrRecordedAt: string | null;
  };
  steps: JourneyStep[];
  doctorChecks: DoctorCheck[];
  services: { id: string; name: string; kind: string; description: string; owner: string }[];
  blockers: { id: string; category: string; summary: string; status: string; createdAt: string }[];
  metrics: {
    firstLocalRunMinutes: number | null;
    firstMrMinutes: number | null;
    helpRequests: number;
    gapsFound: number;
    completion: number;
  };
};

const demoData: BootstrapData = {
  mode: "demo",
  schemaVersion: 1,
  profile: {
    name: "Example Engineer",
    initials: "EE",
    role: "Software Engineer",
    team: "Repository",
    buddy: "Example reviewer",
    targetDate: "2026-08-07",
  },
  repository: { org: "ianjuantw", name: "dayone", branch: "main" },
  journey: {
    id: "journey_demo",
    startedAt: new Date().toISOString(),
    status: "active",
    firstMrUrl: null,
    firstMrRecordedAt: null,
  },
  steps: [
    {
      id: "step_access",
      slug: "access",
      number: "01",
      title: "Get the access you need",
      shortTitle: "Get access",
      summary: "Confirm identity, repository, secrets, and infrastructure access.",
      status: "complete",
      tasks: [
        { id: "access_repo", title: "Repository access", description: "Can open and clone ianjuantw/dayone", status: "complete", source: "Example self-acknowledgement" },
        { id: "access_support", title: "Support path identified", description: "Knows where repository blockers should be raised", status: "complete", source: "Example self-acknowledgement" },
        { id: "access_github", title: "GitHub authentication", description: "Git can use the intended GitHub account", status: "complete", source: "Example self-acknowledgement" },
        { id: "access_reviewer", title: "Reviewer identified", description: "A first pull request reviewer is selected", status: "complete", source: "Example self-acknowledgement" },
      ],
    },
    {
      id: "step_run",
      slug: "run",
      number: "02",
      title: "Bring the repository to life",
      shortTitle: "Run locally",
      summary: "Verify your machine against what this project actually needs.",
      status: "current",
      tasks: [
        { id: "runtime", title: "Runtime is ready", description: "Node 22.13.0 satisfies package engines", status: "complete" },
        { id: "git", title: "Git checkout", description: "ianjuantw/dayone · main", status: "complete" },
        { id: "dependencies", title: "Dependencies installed", description: "node_modules is missing", status: "blocked", command: "npm install" },
        { id: "secrets", title: "Environment template", description: "No required environment template detected", status: "ready" },
        { id: "database", title: "Local data tooling", description: "Docker is not required by this repository", status: "ready" },
        { id: "local-health", title: "DayOne local health", description: "The local app is not responding yet", status: "blocked", command: "npm run dev" },
      ],
    },
    {
      id: "step_system",
      slug: "system",
      number: "03",
      title: "Understand the system",
      shortTitle: "Know the system",
      summary: "Follow one real request through services, data, and owners.",
      status: "locked",
      tasks: [
        { id: "system_flow", title: "Trace bootstrap", description: "UI → API route → identity → domain → D1", status: "ready" },
        { id: "system_owner", title: "Meet the service owners", description: "Know where to ask and when", status: "ready" },
        { id: "system_quiz", title: "Check your mental model", description: "Answer one routing scenario", status: "locked" },
      ],
    },
    {
      id: "step_change",
      slug: "change",
      number: "04",
      title: "Make a safe first change",
      shortTitle: "Make a change",
      summary: "Practice the delivery loop on a real, low-risk issue.",
      status: "locked",
      tasks: [
        { id: "change_issue", title: "Review the real task brief", description: "Clarify docs/environment-doctor.md", status: "locked" },
        { id: "change_branch", title: "Create a branch", description: "Use the documented branch name", status: "locked", command: "git switch -c docs/onboarding-improvement" },
        { id: "change_test", title: "Run the focused checks", description: "Verify the doctor docs and CLI behavior", status: "locked", command: "node --test tests/dayone-cli.test.mjs && npm run lint" },
      ],
    },
    {
      id: "step_ship",
      slug: "ship",
      number: "05",
      title: "Ship your first merge request",
      shortTitle: "Ship first MR",
      summary: "Submit your first PR link and close the onboarding feedback loop.",
      status: "locked",
      tasks: [
        { id: "ship_push", title: "Push your branch", description: "Publish your first change", status: "locked" },
        { id: "ship_mr", title: "Open the merge request", description: "Use the repository template", status: "locked" },
        { id: "ship_review", title: "Request review", description: "Ask your buddy and service owner", status: "locked" },
        { id: "ship_feedback", title: "Share onboarding feedback", description: "Turn friction into platform backlog", status: "locked" },
      ],
    },
  ],
  doctorChecks: [
    { id: "node-version", name: "Node runtime", detail: "22.13.0 satisfies package engines", status: "passed" },
    { id: "node-version-file", name: ".nvmrc", detail: "No .nvmrc; package engines remain authoritative", status: "warning" },
    { id: "git", name: "Git repository", detail: "main · working tree clean", status: "passed" },
    { id: "dependencies", name: "Dependencies", detail: "node_modules is missing", status: "blocked", command: "npm install" },
    { id: "environment", name: "Environment template", detail: "No required environment template detected", status: "warning" },
    { id: "docker", name: "Docker", detail: "Not required by this repository", status: "warning" },
    { id: "local-health", name: "DayOne local health", detail: "The local app is not responding yet", status: "blocked", command: "npm run dev" },
  ],
  services: [
    { id: "ui", name: "DayOne UI", kind: "client", description: "app/page.tsx requests and renders the canonical onboarding journey.", owner: "Repository maintainer" },
    { id: "route", name: "API route", kind: "route", description: "app/api/* validates HTTP input and delegates to the domain layer.", owner: "Repository maintainer" },
    { id: "auth", name: "ChatGPT identity", kind: "auth", description: "app/chatgpt-auth.ts reads server-provided identity headers.", owner: "Sites runtime" },
    { id: "domain", name: "Journey service", kind: "service", description: "db/dayone.ts enforces transitions, blockers, and metrics.", owner: "Repository maintainer" },
    { id: "d1", name: "Cloudflare D1", kind: "database", description: "Drizzle persists user-owned onboarding state.", owner: "Sites runtime" },
  ],
  blockers: [
    { id: "blocker_dependencies", category: "environment", summary: "Project dependencies are not installed", status: "open", createdAt: new Date().toISOString() },
  ],
  metrics: { firstLocalRunMinutes: null, firstMrMinutes: null, helpRequests: 0, gapsFound: 1, completion: 30 },
};

const guideAnswers: Record<string, { text: string; sources: GuideMessage["sources"] }> = {
  docker: {
    text: "Run the environment doctor in this repository, fix explicit failures, then import the fresh JSON report. Warnings stay visible but do not block the journey, and this project does not require Docker.",
    sources: [{ label: "Environment doctor reference", section: "docs/environment-doctor.md", href: "https://github.com/ianjuantw/dayone/blob/main/docs/environment-doctor.md" }],
  },
  system: {
    text: "The browser calls a vinext API route. Sites supplies authenticated-user headers, the route validates input, db/dayone.ts enforces journey rules, and Drizzle persists the result in Cloudflare D1.",
    sources: [{ label: "Request flow map", section: "docs/architecture/request-flow.md", href: "https://github.com/ianjuantw/dayone/blob/main/docs/architecture/request-flow.md" }],
  },
  help: {
    text: "DayOne records the current step and failed checks but does not notify anyone. Share that context manually with the reviewer or repository maintainer you selected.",
    sources: [{ label: "Ownership map", section: "docs/onboarding/ownership.md", href: "https://github.com/ianjuantw/dayone/blob/main/docs/onboarding/ownership.md" }],
  },
  mr: {
    text: "Your first repository task is a small documentation improvement in docs/environment-doctor.md. Make one evidence-based clarification, then run the existing doctor tests and lint before opening a pull request.",
    sources: [{ label: "First change brief", section: "docs/onboarding/first-change.md", href: "https://github.com/ianjuantw/dayone/blob/main/docs/onboarding/first-change.md" }],
  },
};

const sleep = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uiStatus(value: unknown, fallback: Status = "ready"): Status {
  const map: Record<string, Status> = {
    done: "complete", completed: "complete", complete: "complete", passed: "complete",
    active: "current", current: "current", available: "ready", ready: "ready",
    failed: "blocked", blocked: "blocked", locked: "locked",
  };
  return typeof value === "string" ? map[value] ?? fallback : fallback;
}

function canonicalStepSlug(value: unknown) {
  const slug = String(value ?? "");
  const map: Record<string, string> = {
    "get-access": "access", access: "access",
    "run-locally": "run", run: "run",
    "know-the-system": "system", system: "system",
    "make-a-change": "change", change: "change",
    "ship-first-mr": "ship", ship: "ship",
  };
  return map[slug] ?? slug;
}

function canonicalTaskKey(value: unknown) {
  const slug = String(value ?? "");
  const map: Record<string, string> = {
    "request-flow": "system_flow", "ownership-map": "system_owner", "routing-quiz": "system_quiz", observability: "system_quiz",
    "development-branch": "change_branch", "first-change": "change_issue", tests: "change_test",
    "push-branch": "ship_push", "open-merge-request": "ship_mr", "request-review": "ship_review", "share-feedback": "ship_feedback",
  };
  return map[slug] ?? slug;
}

function doctorStatus(value: unknown): CheckStatus {
  const map: Record<string, CheckStatus> = {
    pass: "passed", passed: "passed", done: "passed",
    warn: "warning", warning: "warning",
    fail: "blocked", failed: "blocked", blocked: "blocked",
    pending: "pending", running: "pending", stale: "pending",
  };
  return typeof value === "string" ? map[value] ?? "pending" : "pending";
}

function initialsFor(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "D1";
}

function formatMinutes(value: number | null) {
  if (value === null) return "—";
  return value === 0 ? "<1m" : `${value}m`;
}

function normalizeDoctorChecks(value: unknown): DoctorCheck[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((check, index) => ({
    id: String(check.id ?? `check_${index}`),
    name: String(check.name ?? check.title ?? `Check ${index + 1}`),
    detail: String(check.detail ?? check.message ?? "No detail provided"),
    status: doctorStatus(check.evidenceStatus ?? check.status),
    command: typeof check.command === "string" ? check.command : typeof check.remediation === "string" && check.remediation.startsWith("`") ? check.remediation.replaceAll("`", "") : undefined,
  }));
}

function advanceJourney(steps: JourneyStep[]): JourneyStep[] {
  let previousComplete = true;
  let activeAssigned = false;
  return steps.map((step) => {
    const isComplete = step.tasks.length > 0 && step.tasks.every((task) => task.status === "complete");
    if (isComplete) {
      previousComplete = previousComplete && true;
      return { ...step, status: "complete" };
    }
    if (!previousComplete || activeAssigned) {
      previousComplete = false;
      return { ...step, status: "locked", tasks: step.tasks.map((task) => task.status === "complete" ? task : { ...task, status: "locked" }) };
    }
    activeAssigned = true;
    previousComplete = false;
    return { ...step, status: "current", tasks: step.tasks.map((task) => task.status === "locked" ? { ...task, status: "ready" } : task) };
  });
}

function normalizeBootstrap(payload: unknown): BootstrapData | null {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || payload.mode !== "connected") return null;
  if (!isRecord(payload.journey) || !isRecord(payload.profile) || !Array.isArray(payload.steps)) return null;

  const journey = payload.journey;
  const profile = payload.profile;
  const apiSteps = payload.steps.filter(isRecord);
  const mappedSteps: JourneyStep[] = apiSteps.map((apiStep, index) => {
    const tasks = Array.isArray(apiStep.tasks) ? apiStep.tasks.filter(isRecord) : [];
    return {
      id: String(apiStep.id ?? `step_${index}`),
      slug: canonicalStepSlug(apiStep.slug ?? `step-${index + 1}`),
      number: String(index + 1).padStart(2, "0"),
      title: String(apiStep.title ?? `Onboarding step ${index + 1}`),
      shortTitle: String(apiStep.shortTitle ?? apiStep.title ?? `Step ${index + 1}`),
      summary: String(apiStep.summary ?? apiStep.description ?? ""),
      status: uiStatus(apiStep.status, index === 0 ? "current" : "locked"),
      tasks: tasks.map((task, taskIndex) => ({
        id: String(task.id ?? `${apiStep.id ?? index}_task_${taskIndex}`),
        key: canonicalTaskKey(task.slug ?? task.id),
        title: String(task.title ?? task.label ?? `Task ${taskIndex + 1}`),
        description: String(task.description ?? task.detail ?? ""),
        status: uiStatus(task.status),
        command: typeof task.command === "string" ? task.command : undefined,
        source: typeof task.source === "string" ? task.source : undefined,
      })),
    };
  });
  if (mappedSteps.length === 0) return null;

  const displayName = String(profile.name ?? profile.displayName ?? profile.email ?? "New teammate");
  const projectKey = String(journey.projectKey ?? "dayone-project");
  const repository = isRecord(payload.repository) ? payload.repository : {};
  const repositoryParts = typeof journey.repository === "string" ? journey.repository.split("/") : [];
  const rawMetrics = isRecord(payload.metrics) ? payload.metrics : {};
  const rawBlockers = Array.isArray(payload.blockers) ? payload.blockers.filter(isRecord) : [];
  const rawServices = Array.isArray(payload.services) ? payload.services.filter(isRecord) : [];
  const doctorRuns = Array.isArray(payload.doctorRuns) ? payload.doctorRuns.filter(isRecord) : [];
  const latestRun = doctorRuns.at(0) ?? doctorRuns.at(-1);
  const latestChecks = latestRun && (latestRun.checks ?? latestRun.results);
  const doctorChecks = normalizeDoctorChecks(payload.doctorChecks ?? latestChecks);

  return {
    mode: "connected",
    schemaVersion: 1,
    profile: {
      name: displayName,
      initials: String(profile.initials ?? initialsFor(displayName)),
      role: String(profile.role ?? "Engineer"),
      team: String(profile.team ?? "Product engineering"),
      buddy: String(profile.buddy ?? profile.buddyName ?? "Not assigned"),
      targetDate: String(profile.targetDate ?? journey.targetDate ?? "Not set"),
    },
    repository: {
      org: String(repository.org ?? repositoryParts[0] ?? "Workspace"),
      name: String(repository.name ?? repositoryParts[1] ?? projectKey),
      branch: String(repository.branch ?? journey.branch ?? "main"),
    },
    journey: {
      id: String(journey.id),
      startedAt: String(journey.startedAt ?? new Date().toISOString()),
      status: String(journey.status ?? "active"),
      firstMrUrl:
        typeof journey.firstMrUrl === "string" ? journey.firstMrUrl : null,
      firstMrRecordedAt:
        typeof journey.firstMrRecordedAt === "string"
          ? journey.firstMrRecordedAt
          : null,
    },
    steps: mappedSteps,
    doctorChecks: doctorChecks.length ? doctorChecks : [],
    services: rawServices.map((service, index) => {
      const kind = String(service.kind ?? "service");
      const defaultOwners: Record<string, string> = { client: "Repository maintainer", route: "Repository maintainer", auth: "Sites runtime", service: "Repository maintainer", database: "Sites runtime" };
      return { id: String(service.id ?? `service_${index}`), name: String(service.name ?? `Service ${index + 1}`), kind, description: String(service.description ?? ""), owner: String(service.owner ?? defaultOwners[kind] ?? "Platform") };
    }),
    blockers: rawBlockers.map((blocker, index) => ({
      id: String(blocker.id ?? `blocker_${index}`),
      category: String(blocker.category ?? "other"),
      summary: String(blocker.summary ?? blocker.description ?? "Onboarding blocker"),
      status: String(blocker.status ?? "open"),
      createdAt: String(blocker.createdAt ?? blocker.created_at ?? new Date().toISOString()),
    })),
    metrics: {
      firstLocalRunMinutes: typeof rawMetrics.firstLocalRunMinutes === "number" ? rawMetrics.firstLocalRunMinutes : null,
      firstMrMinutes: typeof rawMetrics.firstMrMinutes === "number" ? rawMetrics.firstMrMinutes : null,
      helpRequests: Number(rawMetrics.helpRequests ?? 0),
      gapsFound: Number(rawMetrics.gapsFound ?? 0),
      completion: Number(rawMetrics.completion ?? rawMetrics.progressPercent ?? 0),
    },
  };
}

export default function Home() {
  const [data, setData] = useState<BootstrapData>(demoData);
  const [activeStep, setActiveStep] = useState("run");
  const [view, setView] = useState<View>("journey");
  const [modal, setModal] = useState<Modal>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideOverlay, setGuideOverlay] = useState(false);
  const [guideBusy, setGuideBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [toast, setToast] = useState("");
  const [messages, setMessages] = useState<GuideMessage[]>([
    { id: "welcome", role: "guide", text: guideAnswers.docker.text, sources: guideAnswers.docker.sources },
  ]);
  const [importValue, setImportValue] = useState("");
  const [importError, setImportError] = useState("");
  const [mrUrl, setMrUrl] = useState("");
  const guideEndRef = useRef<HTMLDivElement>(null);

  const closeModal = useCallback(() => {
    setModal(null);
    setImportError("");
  }, []);
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1240px)");
    const update = () => setGuideOverlay(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/bootstrap", { headers: { accept: "application/json" } })
      .then((response) => readJson<Partial<BootstrapData>>(response))
      .then((payload) => {
        const connected = normalizeBootstrap(payload);
        if (!cancelled && connected) {
          setData(connected);
          setMrUrl(connected.journey.firstMrUrl ?? "");
          setActiveStep(connected.steps.find((item) => item.status !== "complete" && item.status !== "locked")?.slug ?? connected.steps[0].slug);
          setImportValue("");
          setImportError("");
          setModal((current) => current === "import" ? null : current);
          setMessages([{ id: "connected-welcome", role: "guide", text: "Your connected journey is ready. Start with the active checklist; Guide answers cite files that exist in this repository.", sources: [{ label: "Developer access checklist", section: "docs/onboarding/access.md", href: "https://github.com/ianjuantw/dayone/blob/main/docs/onboarding/access.md" }] }]);
          setOnline(true);
        } else if (!cancelled) {
          setOnline(false);
        }
        if (!cancelled) setBootstrapReady(true);
      })
      .catch(() => {
        if (!cancelled) { setOnline(false); setBootstrapReady(true); }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    guideEndRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }, [messages, guideBusy]);

  const step = useMemo(
    () => data.steps.find((item) => item.slug === activeStep) ?? data.steps[1],
    [activeStep, data.steps],
  );

  const completedTasks = data.steps.flatMap((item) => item.tasks).filter((task) => task.status === "complete").length;
  const totalTasks = data.steps.flatMap((item) => item.tasks).length;

  function notify(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function refreshConnected() {
    if (!online) return;
    const response = await fetch("/api/bootstrap", { headers: { accept: "application/json" } });
    const connected = normalizeBootstrap(await readJson<unknown>(response));
    if (!connected) throw new Error("Invalid connected snapshot");
    setData(connected);
    setMrUrl(connected.journey.firstMrUrl ?? "");
    setActiveStep(connected.steps.find((item) => item.status !== "complete" && item.status !== "locked")?.slug ?? connected.steps[0].slug);
  }

  async function updateTask(taskId: string, status: Status = "complete") {
    const ownerStep = data.steps.find((journeyStep) => journeyStep.tasks.some((task) => task.id === taskId || task.key === taskId));
    const target = ownerStep?.tasks.find((task) => task.id === taskId || task.key === taskId);
    if (!ownerStep || !target || ownerStep.status === "locked" || target.status === "locked") {
      notify("That task is still locked by an earlier milestone");
      return false;
    }
    if (target.status === "blocked") {
      notify("Blocked checks need fresh doctor evidence before they can pass");
      return false;
    }
    const ownerIndex = data.steps.findIndex((journeyStep) => journeyStep.id === ownerStep.id);
    const completesStep =
      status === "complete" &&
      ownerStep.tasks.every(
        (task) => task.id === target.id || task.status === "complete",
      );
    const previous = data;
    setData((current) => {
      const steps = advanceJourney(current.steps.map((journeyStep) => ({
        ...journeyStep,
        tasks: journeyStep.tasks.map((task) => task.id === target.id ? { ...task, status } : task),
      })));
      const tasks = steps.flatMap((journeyStep) => journeyStep.tasks);
      const journeyComplete = tasks.every(
        (task) => task.status === "complete",
      );
      return {
        ...current,
        journey: {
          ...current.journey,
          status: journeyComplete ? "complete" : current.journey.status,
        },
        steps,
        metrics: {
          ...current.metrics,
          completion: Math.round(
            (tasks.filter((task) => task.status === "complete").length /
              tasks.length) *
              100,
          ),
        },
      };
    });
    try {
      const response = online ? await fetch(`/api/tasks/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: status === "complete" ? "done" : status }),
      }) : null;
      if (response && !response.ok) throw new Error("Update failed");
      if (online) await refreshConnected();
      else if (completesStep && data.steps[ownerIndex + 1]) {
        setActiveStep(data.steps[ownerIndex + 1].slug);
      }
      notify(
        online
          ? "Progress saved to your onboarding journey"
          : "Progress updated in this demo",
      );
      return true;
    } catch {
      setData(previous);
      notify("Could not save that change — try again");
      return false;
    }
  }

  function selectStep(slug: string) {
    const selected = data.steps.find((item) => item.slug === slug);
    if (selected?.status === "locked") {
      notify("Complete the current milestone to unlock this step");
      return;
    }
    setView("journey");
    setActiveStep(slug);
  }

  function openDoctorInstructions() {
    setModal("import");
  }

  async function submitDoctorImport(event: FormEvent) {
    event.preventDefault();
    setImportError("");
    try {
      const parsed = JSON.parse(importValue) as unknown;
      if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.tool) || parsed.tool.name !== "dayone") {
        throw new Error("This is not a DayOne doctor report (schemaVersion 1)");
      }
      const normalized = normalizeDoctorChecks(parsed.checks);
      if (normalized.length === 0) throw new Error("No checks found in this report");
      const response = await fetch("/api/doctor-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...parsed, journeyId: data.journey.id, idempotencyKey: `${String(isRecord(parsed.project) ? parsed.project.name ?? "project" : "project")}:${String(parsed.generatedAt ?? "unknown")}` }),
      });
      if (!response.ok && online) throw new Error("Server rejected the run");
      const taskCheckIds: Record<string, string[]> = {
        runtime: ["node-version", "node-version-file"],
        dependencies: ["dependencies", "package-manager"],
        git: ["git"],
        secrets: ["environment"],
        database: ["docker"],
        "local-health": ["local-health"],
      };
      const localHealthPassed = normalized.some((check) => check.id === "local-health" && check.status === "passed");
      const expectedRunChecks = [
        "node-version",
        "node-version-file",
        "package-manager",
        "git",
        "dependencies",
        "environment",
        "docker",
        "local-health",
      ];
      const completesDemoRun =
        localHealthPassed &&
        expectedRunChecks.every((id) =>
          normalized.some((check) => check.id === id),
        ) &&
        normalized.every((check) => check.status !== "blocked");
      setData((current) => {
        const updatedSteps = current.steps.map((journeyStep) => journeyStep.slug !== "run" ? journeyStep : {
          ...journeyStep,
          tasks: journeyStep.tasks.map((task) => {
            const relevant = normalized.filter((check) => taskCheckIds[task.key ?? task.id]?.includes(check.id));
            if (!relevant.length) return task;
            if (relevant.some((check) => check.status === "blocked")) return { ...task, status: "blocked" as const };
            if ((task.key ?? task.id) === "local-health" && !relevant.some((check) => check.status === "passed")) {
              return { ...task, status: "blocked" as const };
            }
            return { ...task, status: "complete" as const };
          }),
        });
        const steps = advanceJourney(updatedSteps);
        const journeyTasks = steps.flatMap((journeyStep) => journeyStep.tasks);
        const environmentReady = normalized.every(
          (check) => check.status !== "blocked",
        );
        return {
          ...current,
          doctorChecks: normalized,
          steps,
          blockers: current.blockers.map((blocker) =>
            blocker.category === "environment" && environmentReady
              ? { ...blocker, status: "resolved" }
              : blocker,
          ),
          metrics: {
            ...current.metrics,
            completion: Math.round(
              (journeyTasks.filter((task) => task.status === "complete").length /
                journeyTasks.length) *
                100,
            ),
            firstLocalRunMinutes: localHealthPassed ? current.metrics.firstLocalRunMinutes ?? Math.max(1, Math.round((Date.now() - new Date(current.journey.startedAt).getTime()) / 60000)) : current.metrics.firstLocalRunMinutes,
          },
        };
      });
      if (!online && completesDemoRun) setActiveStep("system");
      setModal(null);
      setImportValue("");
      if (online) await refreshConnected();
      notify("Doctor run imported and linked to this journey");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Invalid doctor JSON");
    }
  }

  async function askGuide(question: string, topic?: keyof typeof guideAnswers) {
    const cleaned = question.trim();
    if (!cleaned) return;
    const userMessage: GuideMessage = { id: crypto.randomUUID(), role: "user", text: cleaned };
    setMessages((current) => [...current, userMessage]);
    setGuideOpen(true);
    setGuideBusy(true);

    let fallbackKey: keyof typeof guideAnswers = topic ?? "system";
    const lower = cleaned.toLowerCase();
    if (/docker|database|daemon/.test(lower)) fallbackKey = "docker";
    else if (/help|stuck|who|buddy/.test(lower)) fallbackKey = "help";
    else if (/mr|merge|change|issue/.test(lower)) fallbackKey = "mr";

    try {
      const response = await fetch("/api/guide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: cleaned, journeyId: data.journey.id, context: activeStep }),
      });
      const answer = await readJson<{ answer?: string; text?: string; sources?: unknown[] }>(response);
      const connectedSources = Array.isArray(answer.sources) ? answer.sources.filter(isRecord).map((source) => {
        const locator = String(source.section ?? source.locator ?? "Source");
        const isFile = !locator.startsWith("#") && !/^https?:\/\//.test(locator);
        return {
          label: String(source.label ?? source.title ?? "Repository source"),
          section: locator,
          href: /^https?:\/\//.test(locator) ? locator : isFile ? `https://github.com/ianjuantw/dayone/blob/main/${locator}` : "https://github.com/ianjuantw/dayone",
        };
      }) : [];
      setMessages((current) => [...current, {
        id: crypto.randomUUID(), role: "guide", text: answer.answer ?? answer.text ?? guideAnswers[fallbackKey].text,
        sources: connectedSources.length ? connectedSources : guideAnswers[fallbackKey].sources,
      }]);
    } catch {
      await sleep(450);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "guide", ...guideAnswers[fallbackKey] }]);
    } finally {
      setGuideBusy(false);
    }
  }

  async function submitBlocker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const blocker = {
      id: crypto.randomUUID(),
      category: String(form.get("category") ?? "other"),
      summary: String(form.get("summary") ?? ""),
      status: "open",
      createdAt: new Date().toISOString(),
    };
    if (!blocker.summary.trim()) return;
    try {
      if (online) {
        const response = await fetch("/api/blockers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...blocker, journeyId: data.journey.id }) });
        const connected = normalizeBootstrap(await readJson<unknown>(response));
        if (!connected) throw new Error("Could not report blocker");
        setData(connected);
      } else {
        setData((current) => ({ ...current, blockers: [blocker, ...current.blockers], metrics: { ...current.metrics, gapsFound: current.metrics.gapsFound + 1 } }));
      }
      setModal(null);
      notify("Friction captured in the journey and platform backlog");
    } catch {
      notify("Could not save that friction record");
    }
  }

  async function recordHelpRequest() {
    const escalation = {
      id: crypto.randomUUID(), category: "mentoring", summary: `Help context recorded for ${step.shortTitle}`,
      status: "open", createdAt: new Date().toISOString(),
    };
    try {
      if (online) {
        const response = await fetch("/api/blockers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...escalation, journeyId: data.journey.id, detail: `Share this record manually with ${data.profile.buddy}, including the current step and latest doctor run.` }) });
        const connected = normalizeBootstrap(await readJson<unknown>(response));
        if (!connected) throw new Error("Escalation failed");
        setData(connected);
      } else {
        setData((current) => ({ ...current, blockers: [escalation, ...current.blockers], metrics: { ...current.metrics, helpRequests: current.metrics.helpRequests + 1, gapsFound: current.metrics.gapsFound + 1 } }));
      }
      notify(`Help context recorded — share it with ${data.profile.buddy}`);
      await askGuide("What context should I share with my onboarding buddy?", "help");
    } catch {
      notify("Could not record the help request");
    }
  }

  async function updatePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const previous = data;
    const changes = {
      role: String(form.get("role") || data.profile.role),
      team: String(form.get("team") || data.profile.team),
      repository: String(form.get("repository") || data.repository.name),
      buddy: String(form.get("buddy") || data.profile.buddy),
      targetDate: String(form.get("target") || data.profile.targetDate),
    };
    setData((current) => ({
      ...current,
      profile: {
        ...current.profile,
        role: changes.role,
        team: changes.team,
        buddy: changes.buddy,
        targetDate: changes.targetDate,
      },
      repository: { ...current.repository, name: changes.repository },
    }));
    try {
      if (online) {
        const [profileResponse, journeyResponse] = await Promise.all([
          fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: changes.role, team: changes.team, buddyName: changes.buddy }) }),
          fetch("/api/journey", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ branch: data.repository.branch, targetDate: changes.targetDate }) }),
        ]);
        if (!profileResponse.ok || !journeyResponse.ok) throw new Error("Plan update failed");
        await refreshConnected();
      }
      setModal(null);
      notify("Onboarding plan updated");
    } catch {
      setData(previous);
      notify("Could not save the onboarding plan");
    }
  }

  async function submitMr(event: FormEvent) {
    event.preventDefault();
    const escapedOrg = data.repository.org.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedRepo = data.repository.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expectedMr = new RegExp(`^https://github\\.com/${escapedOrg}/${escapedRepo}/pull/\\d+/?$`, "i");
    if (!expectedMr.test(mrUrl.trim())) {
      notify(`Use a GitHub pull request URL for ${data.repository.org}/${data.repository.name}`);
      return;
    }
    if (online) {
      try {
        const response = await fetch("/api/merge-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: mrUrl.trim() }) });
        const connected = normalizeBootstrap(await readJson<unknown>(response));
        if (!connected) throw new Error("Invalid merge request snapshot");
        setData(connected);
        setMrUrl(connected.journey.firstMrUrl ?? "");
      } catch {
        notify("Could not record that merge request");
        return;
      }
    } else {
      const saved = await updateTask("ship_mr", "complete");
      if (!saved) return;
      const recordedAt = new Date().toISOString();
      setData((current) => ({
        ...current,
        journey: {
          ...current.journey,
          firstMrUrl: mrUrl.trim(),
          firstMrRecordedAt: recordedAt,
        },
        metrics: {
          ...current.metrics,
          firstMrMinutes:
            current.metrics.firstMrMinutes ??
            Math.max(
              0,
              Math.round(
                (Date.now() - new Date(current.journey.startedAt).getTime()) /
                  60000,
              ),
            ),
        },
      }));
    }
    notify("First PR link recorded — welcome to the delivery loop!");
  }

  async function saveFeedback(text: string) {
    const summary = text.trim();
    if (!summary) { notify("Add a short note before saving feedback"); return; }
    const feedback = { id: crypto.randomUUID(), category: "feedback", summary, status: "open", createdAt: new Date().toISOString() };
    try {
      if (online) {
        const response = await fetch("/api/blockers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...feedback, journeyId: data.journey.id }) });
        const connected = normalizeBootstrap(await readJson<unknown>(response));
        if (!connected) throw new Error("Feedback failed");
        setData(connected);
      } else {
        setData((current) => ({ ...current, blockers: [feedback, ...current.blockers], metrics: { ...current.metrics, gapsFound: current.metrics.gapsFound + 1 } }));
      }
      const saved = await updateTask("ship_feedback", "complete");
      if (!saved) return;
      notify(
        online
          ? "Feedback saved to the platform backlog"
          : "Feedback added to this demo backlog",
      );
    } catch {
      notify("Could not save onboarding feedback");
    }
  }

  if (!bootstrapReady) {
    return <main className="bootstrap-loading" aria-live="polite"><span className="brand-mark">D1</span><div><strong>DayOne</strong><p>Preparing your onboarding journey…</p></div></main>;
  }

  return (
    <main className={`app-shell ${guideOpen ? "with-guide" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to onboarding content</a>
      <aside className="sidebar" inert={guideOpen && guideOverlay ? true : undefined}>
        <button className="brand" onClick={() => { setView("journey"); setActiveStep(data.steps.find((item) => item.status !== "complete" && item.status !== "locked")?.slug ?? data.steps[0].slug); }} aria-label="DayOne home">
          <span className="brand-mark">D1</span><span>DayOne</span>
        </button>

        <button className="person-card" onClick={() => setModal("plan")}>
          <span className="avatar">{data.profile.initials}</span>
          <span className="person-copy"><strong>{data.profile.name}</strong><small>{data.profile.role}</small></span>
          <span className="more">•••</span>
        </button>

        <nav className="journey" aria-label="Your onboarding journey">
          <p className="eyebrow">YOUR JOURNEY</p>
          <ol>{data.steps.map((item) => {
            const itemDone = item.tasks.filter((task) => task.status === "complete").length;
            return (
              <li key={item.id}><button disabled={item.status === "locked"} aria-disabled={item.status === "locked"} aria-current={activeStep === item.slug && view === "journey" ? "step" : undefined} aria-label={`${item.number}. ${item.shortTitle}${item.status === "locked" ? ", locked" : ""}`} className={`journey-step ${activeStep === item.slug && view === "journey" ? "active" : ""} ${item.status}`} onClick={() => selectStep(item.slug)}>
                <span className="step-number">{item.status === "complete" ? "✓" : item.number}</span>
                <span className="step-copy"><strong>{item.shortTitle}</strong><small>{itemDone ? `${itemDone} / ${item.tasks.length} complete` : item.status === "locked" ? "Locked" : "Ready"}</small></span>
              </button></li>
            );
          })}</ol>
        </nav>

        <div className="sidebar-footer">
          <button className={`side-insights ${view === "insights" ? "active" : ""}`} onClick={() => setView("insights")}><span>↗</span> Insights</button>
          <button className="help-link" onClick={recordHelpRequest}><span>?</span> Record help request</button>
          <p>STARTED {data.journey.startedAt.slice(0, 10)} · {data.metrics.completion}% COMPLETE</p>
        </div>
      </aside>

      <section className="workspace" id="main-content" tabIndex={-1} inert={guideOpen && guideOverlay ? true : undefined}>
        <header className="topbar">
          <div className="breadcrumb"><strong>{data.repository.org}</strong><span>/</span>{data.profile.team}<span>/</span>{data.repository.name}</div>
          <div className="top-actions">
            <span className={`sync-state ${online ? "online" : "demo"}`}><i />{online ? "Synced" : "Demo mode"}</span>
            {!online && <a className="sign-in-link" href="/signin-with-chatgpt?return_to=%2F">Sign in to save</a>}
            <button className="mobile-action" aria-label="Edit onboarding plan" onClick={() => setModal("plan")}>◎</button>
            <button className="mobile-action" aria-label="Open insights" onClick={() => setView("insights")}>↗</button>
            <button className="mobile-action" aria-label="Record a help request" onClick={recordHelpRequest}>?</button>
            <button className="report-button" aria-label="Capture onboarding friction" onClick={() => setModal("blocker")}>Capture friction</button>
            <button className="guide-toggle" aria-expanded={guideOpen} aria-controls="dayone-guide" onClick={() => setGuideOpen((open) => !open)}><span>✦</span> Guide</button>
          </div>
        </header>

        {view === "insights" ? (
          <Insights data={data} onBack={() => setView("journey")} />
        ) : (
          <div className="content">
            <header className="page-intro">
              <div>
                <p className="eyebrow accent">STEP {step.number} · {step.shortTitle.toUpperCase()}</p>
                <h1>{step.title}</h1>
                <p>{step.summary}</p>
              </div>
              <div className="overall-progress" role="progressbar" aria-valuemin={0} aria-valuemax={totalTasks} aria-valuenow={completedTasks} aria-label="Onboarding journey progress">
                <div className="progress-track"><span style={{ width: `${Math.round((completedTasks / totalTasks) * 100)}%` }} /></div>
                <strong>{completedTasks}<span> / {totalTasks}</span></strong><small>journey tasks</small>
              </div>
            </header>

            {step.slug === "access" && <AccessStep step={step} mode={data.mode} onComplete={updateTask} />}
            {step.slug === "run" && <RunStep data={data} onCheck={openDoctorInstructions} onImport={() => setModal("import")} onAsk={(question) => askGuide(question, "docker")} />}
            {step.slug === "system" && <SystemStep step={step} services={data.services} onComplete={updateTask} onAsk={(question) => askGuide(question, "system")} notify={notify} />}
            {step.slug === "change" && <ChangeStep step={step} onComplete={updateTask} onAsk={(question) => askGuide(question, "mr")} notify={notify} />}
            {step.slug === "ship" && <ShipStep step={step} repository={`${data.repository.org}/${data.repository.name}`} mrUrl={mrUrl} setMrUrl={setMrUrl} onSubmit={submitMr} onComplete={updateTask} onFeedback={saveFeedback} recordedUrl={data.journey.firstMrUrl} />}
          </div>
        )}
      </section>

      {guideOpen && guideOverlay && <button className="guide-backdrop" aria-label="Close DayOne Guide" onClick={closeGuide} />}
      {guideOpen && <GuidePanel messages={messages} busy={guideBusy} overlay={guideOverlay} onAsk={askGuide} onClose={closeGuide} endRef={guideEndRef} />}

      {modal === "plan" && <PlanModal data={data} onClose={closeModal} onSubmit={updatePlan} />}
      {modal === "blocker" && <BlockerModal onClose={closeModal} onSubmit={submitBlocker} />}
      {modal === "import" && <ImportModal value={importValue} error={importError} setValue={setImportValue} allowExample={data.mode === "demo"} onClose={closeModal} onSubmit={submitDoctorImport} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function StatusBadge({ status }: { status: Status | CheckStatus }) {
  const labels: Record<string, string> = { complete: "Complete", passed: "Passed", current: "In progress", ready: "Ready", warning: "Action needed", blocked: "Blocked", pending: "Pending", locked: "Locked" };
  return <span className={`status-badge ${status}`}><i />{labels[status]}</span>;
}

function CopyButton({ value, notify }: { value: string; notify?: (text: string) => void }) {
  const [label, setLabel] = useState("Copy");
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setLabel("Copied");
      notify?.("Command copied");
    } catch {
      setLabel("Failed");
      notify?.("Could not copy the command");
    }
    window.setTimeout(() => setLabel("Copy"), 1800);
  }
  return <button className="copy-button" onClick={copy} aria-label={`Copy ${value}`} aria-live="polite">{label}</button>;
}

function AccessStep({ step, mode, onComplete }: { step: JourneyStep; mode: BootstrapData["mode"]; onComplete: (id: string) => void }) {
  const allComplete = step.tasks.every((task) => task.status === "complete");
  return (
    <div className="step-stack">
      <section className="panel access-panel">
        <div className="panel-heading"><div><p className="eyebrow">ACCESS MAP</p><h2>Confirm what you can actually use</h2></div><span className="verified-label">{mode === "demo" ? "Example checklist" : allComplete ? "✓ Self-acknowledged" : "Self-acknowledgement"}</span></div>
        <div className="access-grid">
          {step.tasks.map((task, index) => (
            <article className="access-card" key={task.id}>
              <span className="access-icon">{["GH", "?", "KEY", "PR"][index]}</span>
              <div><strong>{task.title}</strong><p>{task.description}</p><small>{task.source ?? "Self acknowledgement · access checklist"}</small></div>
              <button disabled={task.status === "complete"} className={`round-check ${task.status === "complete" ? "done" : ""}`} onClick={() => onComplete(task.id)} aria-label={task.status === "complete" ? `${task.title} acknowledged` : `Acknowledge ${task.title}`}>{task.status === "complete" ? "✓" : "○"}</button>
            </article>
          ))}
        </div>
      </section>
      <section className={`callout ${allComplete ? "success-callout" : "info-callout"}`}><span>{allComplete ? "✓" : "i"}</span><div><strong>{allComplete ? "Access checklist acknowledged" : "DayOne does not query external access systems"}</strong><p>{allComplete ? "These items reflect your confirmations, not automated GitHub or messaging-platform verification." : "Confirm an item only after checking it yourself; no credential values are stored."}</p></div><a href="https://github.com/ianjuantw/dayone/blob/main/docs/onboarding/access.md" target="_blank" rel="noreferrer">Open checklist ↗</a></section>
    </div>
  );
}

function RunStep({ data, onCheck, onImport, onAsk }: { data: BootstrapData; onCheck: () => void; onImport: () => void; onAsk: (q: string) => void }) {
  const passed = data.doctorChecks.filter((check) => check.status === "passed").length;
  const openBlockers = data.blockers.filter((item) => item.status === "open");
  return (
    <div className="step-stack">
      <section className="panel doctor-panel">
        <div className="panel-heading doctor-heading">
          <span className="doctor-icon">⌁</span>
          <div><h2>Environment doctor</h2><p>Last run · {data.repository.name} · {data.repository.branch}</p></div>
          <div className="doctor-score"><strong>{data.doctorChecks.length ? `${passed}/${data.doctorChecks.length}` : "—"}</strong><small>{data.doctorChecks.length ? "checks passed" : "no report yet"}</small></div>
          <button className="secondary-button" onClick={onImport}>Import result</button>
          <button className="primary-small" onClick={onCheck}>Run on your machine</button>
        </div>
        <div className="check-list">
          {data.doctorChecks.length === 0 && <div className="empty-doctor"><strong>No doctor report imported yet</strong><p>Run the local CLI with the health URL, then import its privacy-redacted JSON result.</p></div>}
          {data.doctorChecks.map((check) => (
            <article className={`check-row ${check.status}`} key={check.id}>
              <span className="check-icon" aria-hidden="true">{check.status === "passed" ? "✓" : check.status === "blocked" ? "!" : "→"}</span><span className="sr-only">Status: {check.status}</span>
              <div className="check-copy"><strong>{check.name}</strong><p>{check.detail}</p></div>
              {check.command && <div className="inline-command"><code>{check.command}</code><CopyButton value={check.command} /></div>}
              <StatusBadge status={check.status} />
              {check.status === "blocked" && <button className="guide-link" onClick={() => onAsk(`How do I fix ${check.name}?`)}>Fix with Guide</button>}
            </article>
          ))}
        </div>
      </section>

      <div className="two-column">
        <section className="panel command-panel">
          <p className="eyebrow">RUN FROM YOUR REPOSITORY</p><h2>Use the real doctor CLI</h2><p>It checks the machine you are actually working on and returns a privacy-redacted JSON report for browser import.</p>
          <div className="terminal"><div><i /><i /><i /></div><code>node cli/dayone.mjs --health-url http://localhost:3000/api/health --json</code><CopyButton value="node cli/dayone.mjs --health-url http://localhost:3000/api/health --json" /></div>
          <button className="text-action" onClick={onImport}>Paste a doctor result <span>→</span></button>
        </section>
        <section className="panel blocker-summary">
          <p className="eyebrow">OPEN FRICTION</p><h2>{openBlockers.length} blocker needs context</h2>
          {openBlockers.slice(0, 2).map((blocker) => <div className="mini-blocker" key={blocker.id}><span>!</span><div><strong>{blocker.summary}</strong><small>{blocker.category} · captured for platform backlog</small></div></div>)}
          <button className="text-action" onClick={onImport}>Import a passing rerun <span>↗</span></button>
        </section>
      </div>
    </div>
  );
}

function SystemStep({ step, services, onComplete, onAsk, notify }: { step: JourneyStep; services: BootstrapData["services"]; onComplete: (id: string) => void; onAsk: (q: string) => void; notify: (text: string) => void }) {
  const [selected, setSelected] = useState(services[1]?.id ?? services[0]?.id ?? "");
  const service = services.find((item) => item.id === selected) ?? services[0];
  const whenByKind: Record<string, string> = { client: "Rendering, local interaction, or snapshot normalization is wrong.", route: "HTTP validation, status codes, or response shape is wrong.", auth: "The Sites-provided identity is missing or malformed.", service: "Journey transitions, evidence guards, or metrics are wrong.", database: "D1 persistence, schema, or migration behavior is wrong." };
  if (!service) return <section className="panel empty-state"><h2>No service map is connected yet</h2><p>Add services to the repository context before completing this step.</p></section>;
  return (
    <div className="step-stack">
      <section className="panel architecture-panel">
        <div className="panel-heading"><div><p className="eyebrow">REQUEST FLOW · GET /API/BOOTSTRAP</p><h2>Follow one real request through this repository</h2></div><button className="secondary-button" onClick={() => onAsk("Explain this request flow to me")}>✦ Explain with Guide</button></div>
        <div className="architecture-body">
          <div className="flow-map">
            {services.map((item, index) => (
              <div className="flow-item" key={item.id}>
                <button className={`service-node ${selected === item.id ? "selected" : ""}`} onClick={() => { setSelected(item.id); onComplete("system_owner"); }}><span>{["↗", "⌘", "◇", "⇢"][index] ?? "◇"}</span><small>{item.owner}</small><strong>{item.name}</strong></button>
                {index < services.length - 1 && <span className="flow-arrow">→<small>{["fetch", "headers", "rules", "SQL"][index] ?? "call"}</small></span>}
              </div>
            ))}
          </div>
          <aside className="service-detail"><p className="eyebrow">SELECTED SERVICE</p><h3>{service.name}</h3><span className="owner-pill">Owner · {service.owner}</span><p>{service.description}</p><div><strong>Ask this team when</strong><p>{whenByKind[service.kind] ?? "The service behavior differs from the documented request flow."}</p></div><button onClick={() => onAsk(`What should I know about ${service.name}?`)}>Ask Guide about this service →</button></aside>
        </div>
      </section>
      <section className="panel knowledge-check"><div><span className="quiz-mark">?</span><div><p className="eyebrow">KNOWLEDGE CHECK</p><h2>Where is a task transition authorized and reconciled?</h2></div></div><div className="quiz-options"><button onClick={() => notify("Not quite — the UI requests a transition but cannot authorize it")}>DayOne UI</button><button className={step.tasks.find((task) => (task.key ?? task.id) === "system_quiz")?.status === "complete" ? "correct" : ""} onClick={() => onComplete("system_quiz")}>Journey service {step.tasks.find((task) => (task.key ?? task.id) === "system_quiz")?.status === "complete" && <span>✓</span>}</button><button onClick={() => notify("Not quite — D1 stores the result after domain rules approve it")}>Cloudflare D1</button></div></section>
      <section className="task-footer"><span>{step.tasks.filter((task) => task.status === "complete").length}/{step.tasks.length} complete</span><button className="primary-button" onClick={() => onComplete("system_flow")}>I understand this flow <span>→</span></button></section>
    </div>
  );
}

function ChangeStep({ step, onComplete, onAsk, notify }: { step: JourneyStep; onComplete: (id: string) => void; onAsk: (q: string) => void; notify: (text: string) => void }) {
  return (
    <div className="step-stack">
      <section className="panel issue-card">
        <div className="issue-top"><span className="issue-id">REPOSITORY TASK</span><span className="safe-badge">LOW-RISK FIRST CHANGE</span><button onClick={() => onAsk("Explain the first documentation task")}>✦ Get context</button></div>
        <h2>Clarify one environment-doctor instruction</h2><p>Update <code>docs/environment-doctor.md</code> with one concise clarification grounded in something you verified during setup. Do not invent a command, service, or credential flow.</p>
        <div className="issue-meta"><div><small>OWNER</small><strong>Repository maintainer</strong></div><div><small>FILES</small><strong>docs/environment-doctor.md</strong></div><div><small>RISK</small><strong>Documentation only</strong></div><div><small>CHECK</small><strong>Doctor tests + lint</strong></div></div>
      </section>
      <section className="panel delivery-loop">
        <div className="panel-heading"><div><p className="eyebrow">DELIVERY LOOP</p><h2>Make the change with evidence</h2></div><span className="branch-chip">main → docs/onboarding-improvement</span></div>
        <div className="delivery-steps">
          {step.tasks.map((task, index) => <article key={task.id}><span className="delivery-number">{index + 1}</span><div><strong>{task.title}</strong><p>{task.description}</p>{task.command && <div className="inline-command wide"><code>{task.command}</code><CopyButton value={task.command} notify={notify} /></div>}</div><button className={`task-check ${task.status === "complete" ? "done" : ""}`} onClick={() => onComplete(task.id)}>{task.status === "complete" ? "✓" : "Mark done"}</button></article>)}
        </div>
      </section>
      <section className="callout info-callout"><span>i</span><div><strong>Nothing here runs automatically</strong><p>DayOne guides and verifies. You keep control of every command and change.</p></div></section>
    </div>
  );
}

function ShipStep({ step, repository, mrUrl, setMrUrl, onSubmit, onComplete, onFeedback, recordedUrl }: { step: JourneyStep; repository: string; mrUrl: string; setMrUrl: (value: string) => void; onSubmit: (event: FormEvent) => void; onComplete: (id: string) => void; onFeedback: (text: string) => void; recordedUrl: string | null }) {
  const [feedback, setFeedback] = useState("");
  return (
    <div className="step-stack">
      <section className="panel ship-card">
        <div className="ship-illustration"><span>01</span><i /><span>MR</span><i /><span>✓</span></div>
        <p className="eyebrow">FINAL MILESTONE</p><h2>Submit your first pull request link</h2><p>DayOne records a repository-scoped GitHub URL and its submission time; it does not verify the pull request state on GitHub.</p>
        <form className="mr-form" onSubmit={onSubmit}><label><span>Pull request URL</span><div><input value={mrUrl} onChange={(event) => setMrUrl(event.target.value)} placeholder={`https://github.com/${repository}/pull/…`} readOnly={Boolean(recordedUrl)} /><button disabled={Boolean(recordedUrl)}>{recordedUrl ? "PR link recorded ✓" : "Record PR link →"}</button></div></label></form>
        {recordedUrl && <p className="recorded-pr">Recorded evidence: <a href={recordedUrl} target="_blank" rel="noreferrer">{recordedUrl} ↗</a></p>}
      </section>
      <section className="panel ship-checklist"><p className="eyebrow">READY TO REVIEW MEANS</p>{step.tasks.map((task) => { const key = task.key ?? task.id; const requiresEvidence = key === "ship_mr" || key === "ship_feedback"; return <button key={task.id} disabled={requiresEvidence} aria-label={requiresEvidence ? task.title : task.status === "complete" ? `${task.title} acknowledged` : `Acknowledge ${task.title}`} title={key === "ship_mr" ? "Submit the repository pull request link above" : key === "ship_feedback" ? "Save feedback below" : "Complete the external action, then acknowledge it here"} onClick={() => onComplete(task.id)}><span className={task.status === "complete" ? "done" : ""}>{task.status === "complete" ? "✓" : ""}</span><div><strong>{task.title}</strong><small>{task.description}</small></div></button>; })}</section>
      <section className="callout info-callout"><span>i</span><div><strong>External actions remain manual</strong><p>DayOne does not run git push or notify a reviewer. Perform those actions outside DayOne, then acknowledge them here.</p></div></section>
      <section className="feedback-card"><div><p className="eyebrow">CLOSE THE LOOP</p><h2>What was harder than it should have been?</h2><p>Your answer becomes a traceable documentation, permission, or platform improvement.</p></div><textarea aria-label="Onboarding feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="I expected… but instead…" /><button onClick={() => onFeedback(feedback)}>Save feedback</button></section>
    </div>
  );
}

function Insights({ data, onBack }: { data: BootstrapData; onBack: () => void }) {
  function exportSummary() {
    const summary = JSON.stringify({ exportedAt: new Date().toISOString(), repository: `${data.repository.org}/${data.repository.name}`, journey: data.journey, metrics: data.metrics, blockers: data.blockers, steps: data.steps.map((step) => ({ slug: step.slug, status: step.status, completedTasks: step.tasks.filter((task) => task.status === "complete").length, totalTasks: step.tasks.length })) }, null, 2);
    const url = URL.createObjectURL(new Blob([summary], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "dayone-experiment-summary.json"; link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="content insights-page">
      <header className="page-intro"><div><p className="eyebrow accent">MEASUREMENT PLAN</p><h1>Onboarding, made observable.</h1><p>Progress, help requests, and gaps from this journey — without pretending draft signals are outcomes.</p></div><button className="secondary-button" onClick={onBack}>← Back to journey</button></header>
      <div className="metric-grid">
        <article><span className="metric-code">BOOT</span><strong>{formatMinutes(data.metrics.firstLocalRunMinutes)}</strong><h3>Time to local run</h3><p>Starts when the journey is created and stops on a passing doctor run.</p></article>
        <article><span className="metric-code">MR1</span><strong>{formatMinutes(data.metrics.firstMrMinutes)}</strong><h3>Time to first PR link</h3><p>Stops when a repository-scoped pull request URL is submitted.</p></article>
        <article><span className="metric-code">HELP</span><strong>{data.metrics.helpRequests}</strong><h3>Recorded help requests</h3><p>Contexts prepared for manual buddy or service-owner escalation.</p></article>
        <article><span className="metric-code">GAP</span><strong>{data.metrics.gapsFound}</strong><h3>Gaps discovered</h3><p>Reproducible documentation, access, and environment friction.</p></article>
      </div>
      <div className="insights-grid">
        <section className="panel journey-chart"><div className="panel-heading"><div><p className="eyebrow">JOURNEY PROGRESS</p><h2>{data.metrics.completion}% complete</h2></div><StatusBadge status="current" /></div>{data.steps.map((step) => { const done = step.tasks.filter((task) => task.status === "complete").length; const percent = Math.round((done / step.tasks.length) * 100); return <div className="chart-row" key={step.id}><span>{step.number}</span><strong>{step.shortTitle}</strong><div><i style={{ width: `${percent}%` }} /></div><small>{percent}%</small></div>; })}</section>
        <section className="panel gap-list"><div className="panel-heading"><div><p className="eyebrow">PLATFORM BACKLOG INPUT</p><h2>Friction captured</h2></div></div>{data.blockers.map((blocker) => <article key={blocker.id}><span>!</span><div><strong>{blocker.summary}</strong><p>{blocker.category} · {new Date(blocker.createdAt).toLocaleDateString()}</p></div><StatusBadge status={blocker.status === "open" ? "blocked" : "complete"} /></article>)}<button onClick={exportSummary}>Export experiment summary ↗</button></section>
      </div>
      <p className="measurement-note">These are experiment measurements, not claimed outcomes. DayOne only promotes a result after a repeatable pilot.</p>
    </div>
  );
}

function GuidePanel({ messages, busy, overlay, onAsk, onClose, endRef }: { messages: GuideMessage[]; busy: boolean; overlay: boolean; onAsk: (question: string) => void; onClose: () => void; endRef: React.RefObject<HTMLDivElement | null> }) {
  const [question, setQuestion] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    if (overlay) focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (!overlay || event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]; const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    if (overlay) document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (overlay) { document.body.style.overflow = ""; previousFocus?.focus(); }
    };
  }, [onClose, overlay]);
  function submit(event: FormEvent) { event.preventDefault(); const value = question; setQuestion(""); onAsk(value); }
  return (
    <aside ref={panelRef} className="guide-panel" id="dayone-guide" role="dialog" aria-modal={overlay} aria-label="DayOne Guide">
      <header className="guide-header"><div><span>✦</span><strong>DayOne Guide</strong><small>Context from your repository</small></div><button onClick={onClose} aria-label="Close Guide">×</button></header>
      <div className="guide-messages" aria-live="polite" aria-relevant="additions">
        {messages.map((message) => <article className={`guide-message ${message.role}`} key={message.id}>{message.role === "guide" && <span className="guide-avatar">✦</span>}<div><p>{message.text}</p>{message.sources?.length ? <div className="source-list"><span>SOURCES</span>{message.sources.map((source) => <a href={source.href ?? "https://github.com/ianjuantw/dayone"} target="_blank" rel="noreferrer" key={`${source.label}-${source.section}`}>{source.label}<small>{source.section}</small></a>)}</div> : null}</div></article>)}
        {busy && <div className="guide-typing"><i /><i /><i /></div>}
        <div ref={endRef} />
      </div>
      <div className="guide-suggestions"><button onClick={() => onAsk("How does this repository fit the system?")}>How does this repo fit the system?</button><button onClick={() => onAsk("What will my first merge request be?")}>What will my first MR be?</button></div>
      <form className="ask-box" onSubmit={submit}><label htmlFor="guide-question" className="sr-only">Ask about this onboarding step</label><textarea id="guide-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about this step…" rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (question.trim()) { setQuestion(""); onAsk(question); } } }} /><button disabled={!question.trim() || busy} aria-label="Send question">↑</button></form>
      <p className="guide-note">Answers show their source · Commands never run without you.</p>
    </aside>
  );
}

function ModalShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    const focusable = () => Array.from(modal?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]; const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", handleKey); document.body.style.overflow = ""; previousFocus?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop"><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><p className="eyebrow">{eyebrow}</p><h2 id="modal-title">{title}</h2></div><button onClick={onClose} aria-label="Close dialog">×</button></header>{children}</section></div>;
}

function PlanModal({ data, onClose, onSubmit }: { data: BootstrapData; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell title="Your onboarding plan" eyebrow="PROFILE & TARGET" onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><div className="form-grid"><label>Role<input name="role" defaultValue={data.profile.role} /></label><label>Team<input name="team" defaultValue={data.profile.team} /></label><label>Repository<input name="repository" defaultValue={data.repository.name} readOnly={data.mode === "connected"} aria-describedby={data.mode === "connected" ? "repository-scope" : undefined} /></label><label>Onboarding buddy<input name="buddy" defaultValue={data.profile.buddy} /></label></div>{data.mode === "connected" && <p className="form-help" id="repository-scope">This pilot is scoped to one connected repository.</p>}<label>First MR target<input type="date" name="target" defaultValue={data.profile.targetDate} /></label><footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">Save plan</button></footer></form></ModalShell>;
}

function BlockerModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell title="Capture onboarding friction" eyebrow="PLATFORM SIGNAL" onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><label>Where did the friction occur?<select name="category" defaultValue="environment"><option value="access">Access or permission</option><option value="environment">Local environment</option><option value="documentation">Documentation</option><option value="architecture">System knowledge</option><option value="mentoring">Needs human context</option></select></label><label>What happened?<textarea name="summary" rows={4} placeholder="I tried… I expected… Instead…" required /></label><p className="form-help">This captures a journey event and candidate backlog item; it does not block a task or notify anyone automatically.</p><footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">Capture friction</button></footer></form></ModalShell>;
}

function ImportModal({ value, error, setValue, allowExample, onClose, onSubmit }: { value: string; error: string; setValue: (value: string) => void; allowExample: boolean; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  const example = JSON.stringify({ schemaVersion: 1, tool: { name: "dayone", version: "0.1.0" }, generatedAt: new Date().toISOString(), project: { name: "dayone", repository: "ianjuantw/dayone", repositoryHost: "github.com", path: "dayone" }, summary: { status: "warn", counts: { pass: 5, warn: 3, fail: 0 }, exitCode: 0 }, checks: [{ id: "node-version", title: "Node.js", message: "Node.js 22.13.0 satisfies the project requirement.", status: "pass" }, { id: "node-version-file", title: ".nvmrc", message: "No .nvmrc; package engines remain authoritative.", status: "warn" }, { id: "package-manager", title: "Package manager", message: "npm lockfile is consistent.", status: "pass" }, { id: "git", title: "Git", message: "github.com/ianjuantw/dayone on main.", status: "pass" }, { id: "dependencies", title: "Dependencies", message: "node_modules is present.", status: "pass" }, { id: "environment", title: "Environment", message: "No required environment template detected.", status: "warn" }, { id: "docker", title: "Docker", message: "Docker is not required by this repository.", status: "warn" }, { id: "local-health", title: "Local app health", message: "Loopback DayOne health signature returned HTTP 200.", status: "pass" }] }, null, 2);
  const placeholder = allowExample ? example : '{\n  "schemaVersion": 1,\n  "tool": { "name": "dayone", "version": "…" },\n  "checks": [ … ]\n}';
  return <ModalShell title="Import a doctor result" eyebrow="ENVIRONMENT EVIDENCE" onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><p className="modal-copy">Start the app, then run <code>node cli/dayone.mjs --health-url http://localhost:3000/api/health --json</code> in your repository and paste the result below.</p><label>Doctor JSON<textarea className="json-input" rows={11} value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} aria-invalid={Boolean(error)} aria-describedby={error ? "doctor-import-error" : undefined} /></label>{error && <p className="form-error" id="doctor-import-error" role="alert">{error}</p>}{allowExample && <button type="button" className="text-action" onClick={() => setValue(example)}>Load a demo report</button>}<footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">Import run</button></footer></form></ModalShell>;
}
