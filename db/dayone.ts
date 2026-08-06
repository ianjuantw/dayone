import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "./index";
import { ensureDatabase } from "./initialize";
import {
  DAYONE_PROJECT,
  DEFAULT_GUIDE_SOURCES,
  DEFAULT_SERVICES,
  DEFAULT_STEPS,
  DEFAULT_TASKS,
} from "./seed";
import {
  blockers,
  doctorRuns,
  guideSources,
  journeys,
  journeySteps,
  journeyTasks,
  profiles,
  services,
  type Journey,
} from "./schema";

export type DayOneIdentity = {
  userId: string;
  email: string;
  displayName: string;
};

export type TaskStatus = "ready" | "done" | "blocked";
export type DoctorStatus = "healthy" | "blocked" | "error";

export type DoctorCheck = {
  id: string;
  title: string;
  taskId?: string;
  slug?: string;
  status: TaskStatus;
  evidenceStatus?: "passed" | "warning" | "blocked";
  detail?: string;
};

export class DayOneDataError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "conflict"
      | "locked"
      | "invalid_reference",
    message: string,
  ) {
    super(message);
    this.name = "DayOneDataError";
  }
}

let staticSeed: Promise<void> | undefined;

export async function getBootstrap(identity: DayOneIdentity) {
  const journey = await ensureUserJourney(identity);
  return readJourney(identity.userId, journey);
}

export async function getJourney(identity: DayOneIdentity) {
  const journey = await ensureUserJourney(identity);
  return readJourney(identity.userId, journey);
}

export async function updateTask(
  identity: DayOneIdentity,
  taskId: string,
  status: TaskStatus,
) {
  const journey = await ensureUserJourney(identity);
  const db = getDb();
  const [task] = await db
    .select()
    .from(journeyTasks)
    .where(
      and(eq(journeyTasks.id, taskId), eq(journeyTasks.journeyId, journey.id)),
    )
    .limit(1);

  if (!task) {
    throw new DayOneDataError("not_found", "Task not found in this journey.");
  }

  assertManualTaskTransition(task.slug, status);

  const [step] = await db
    .select({ status: journeySteps.status })
    .from(journeySteps)
    .where(eq(journeySteps.id, task.stepId))
    .limit(1);
  if (step?.status === "locked") {
    throw new DayOneDataError(
      "conflict",
      "Complete the active step before updating a locked task.",
    );
  }

  await db
    .update(journeyTasks)
    .set({
      status,
      completedAt: status === "done" ? sql`CURRENT_TIMESTAMP` : null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(journeyTasks.id, task.id));

  if (status === "done") {
    await db
      .update(blockers)
      .set({
        status: "resolved",
        resolution: "Resolved when the linked task was updated.",
        resolvedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(blockers.journeyId, journey.id),
          eq(blockers.taskId, task.id),
          eq(blockers.status, "open"),
        ),
      );
  }

  await reconcileJourney(journey.id);
  return snapshotFor(identity.userId, journey.id);
}

export async function updateProfile(
  identity: DayOneIdentity,
  input: {
    displayName?: string;
    role?: string;
    team?: string;
    buddyName?: string;
    buddyEmail?: string | null;
  },
) {
  const journey = await ensureUserJourney(identity);
  const values = {
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.team !== undefined ? { team: input.team } : {}),
    ...(input.buddyName !== undefined ? { buddyName: input.buddyName } : {}),
    ...(input.buddyEmail !== undefined ? { buddyEmail: input.buddyEmail } : {}),
    updatedAt: sql`CURRENT_TIMESTAMP`,
  };
  await getDb().update(profiles).set(values).where(eq(profiles.id, identity.userId));
  return snapshotFor(identity.userId, journey.id);
}

export async function updateJourneyPlan(
  identity: DayOneIdentity,
  input: {
    branch?: string;
    targetDate?: string | null;
  },
) {
  const journey = await ensureUserJourney(identity);
  await getDb()
    .update(journeys)
    .set({
      ...(input.branch !== undefined ? { branch: input.branch } : {}),
      ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(journeys.id, journey.id));
  return snapshotFor(identity.userId, journey.id);
}

export async function recordFirstMergeRequest(
  identity: DayOneIdentity,
  url: string,
) {
  const journey = await ensureUserJourney(identity);
  const db = getDb();
  if (journey.firstMrUrl) {
    if (journey.firstMrUrl === url) {
      return completeFirstMergeRequestTask(identity.userId, journey.id);
    }
    throw new DayOneDataError(
      "conflict",
      "The first merge request is already recorded for this journey.",
    );
  }
  const [shipStep] = await db
    .select({ status: journeySteps.status })
    .from(journeySteps)
    .where(
      and(
        eq(journeySteps.journeyId, journey.id),
        eq(journeySteps.slug, "ship-first-mr"),
      ),
    )
    .limit(1);
  if (shipStep?.status === "locked") {
    throw new DayOneDataError(
      "locked",
      "Complete the active journey steps before recording the first merge request.",
    );
  }
  if (shipStep?.status !== "active") {
    throw new DayOneDataError(
      "conflict",
      "The first merge request can only be recorded while its journey step is active.",
    );
  }
  const [recorded] = await db
    .update(journeys)
    .set({
      firstMrUrl: url,
      firstMrRecordedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(journeys.id, journey.id), isNull(journeys.firstMrUrl)))
    .returning({ id: journeys.id });

  if (!recorded) {
    const [existing] = await db
      .select({ url: journeys.firstMrUrl })
      .from(journeys)
      .where(eq(journeys.id, journey.id))
      .limit(1);
    if (existing?.url === url) {
      return completeFirstMergeRequestTask(identity.userId, journey.id);
    }
    throw new DayOneDataError(
      "conflict",
      "The first merge request is already recorded for this journey.",
    );
  }

  return completeFirstMergeRequestTask(identity.userId, journey.id);
}

async function completeFirstMergeRequestTask(profileId: string, journeyId: string) {
  const db = getDb();
  // A canonical, repository-scoped GitHub URL is the submitted milestone evidence.
  await db
    .update(journeyTasks)
    .set({
      status: "done",
      completedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(journeyTasks.journeyId, journeyId),
        eq(journeyTasks.slug, "open-merge-request"),
      ),
    );
  await reconcileJourney(journeyId);
  return snapshotFor(profileId, journeyId);
}

export async function reportBlocker(
  identity: DayOneIdentity,
  input: {
    taskId?: string;
    category: string;
    summary: string;
    detail?: string;
  },
) {
  const journey = await ensureUserJourney(identity);
  const db = getDb();
  let linkedStepLocked = false;

  if (input.taskId) {
    const [task] = await db
      .select({ id: journeyTasks.id, stepId: journeyTasks.stepId })
      .from(journeyTasks)
      .where(
        and(
          eq(journeyTasks.id, input.taskId),
          eq(journeyTasks.journeyId, journey.id),
        ),
      )
      .limit(1);
    if (!task) {
      throw new DayOneDataError(
        "invalid_reference",
        "The linked task does not belong to this journey.",
      );
    }
    const [taskStep] = await db
      .select({ status: journeySteps.status })
      .from(journeySteps)
      .where(eq(journeySteps.id, task.stepId))
      .limit(1);
    linkedStepLocked = taskStep?.status === "locked";
  }

  const blockerId = crypto.randomUUID();
  await db
    .insert(blockers)
    .values({
      id: blockerId,
      journeyId: journey.id,
      taskId: input.taskId ?? null,
      category: input.category,
      summary: input.summary,
      detail: input.detail ?? "",
    })
    .run();

  if (input.taskId && !linkedStepLocked) {
    await db
      .update(journeyTasks)
      .set({ status: "blocked", completedAt: null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(journeyTasks.id, input.taskId));
  }

  await reconcileJourney(journey.id);
  return snapshotFor(identity.userId, journey.id);
}

export async function listBlockers(identity: DayOneIdentity) {
  const journey = await ensureUserJourney(identity);
  const rows = await getDb()
    .select()
    .from(blockers)
    .where(eq(blockers.journeyId, journey.id))
    .orderBy(desc(blockers.createdAt))
    .limit(50);
  return { blockers: rows };
}

export async function resolveBlocker(
  identity: DayOneIdentity,
  blockerId: string,
  input: {
    status: "resolved" | "dismissed";
    resolution?: string;
    taskStatus?: "ready" | "done";
  },
) {
  const journey = await ensureUserJourney(identity);
  const db = getDb();
  const [blocker] = await db
    .select()
    .from(blockers)
    .where(and(eq(blockers.id, blockerId), eq(blockers.journeyId, journey.id)))
    .limit(1);
  if (!blocker) {
    throw new DayOneDataError("not_found", "Blocker not found in this journey.");
  }

  if (blocker.taskId && input.taskStatus) {
    const [linkedTask] = await db
      .select({ slug: journeyTasks.slug, stepId: journeyTasks.stepId })
      .from(journeyTasks)
      .where(
        and(
          eq(journeyTasks.id, blocker.taskId),
          eq(journeyTasks.journeyId, journey.id),
        ),
      )
      .limit(1);
    if (!linkedTask) {
      throw new DayOneDataError("invalid_reference", "The linked task no longer exists.");
    }
    const [linkedStep] = await db
      .select({ status: journeySteps.status })
      .from(journeySteps)
      .where(eq(journeySteps.id, linkedTask.stepId))
      .limit(1);
    if (linkedStep?.status === "locked") {
      throw new DayOneDataError(
        "locked",
        "Complete the active step before changing a linked task.",
      );
    }
    assertManualTaskTransition(linkedTask.slug, input.taskStatus);
  }

  const [updated] = await db
    .update(blockers)
    .set({
      status: input.status,
      resolution: input.resolution ?? null,
      resolvedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(blockers.id, blocker.id))
    .returning();

  if (blocker.taskId && input.taskStatus) {
    await db
      .update(journeyTasks)
      .set({
        status: input.taskStatus,
        completedAt: input.taskStatus === "done" ? sql`CURRENT_TIMESTAMP` : null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(journeyTasks.id, blocker.taskId),
          eq(journeyTasks.journeyId, journey.id),
        ),
      );
  }

  await reconcileJourney(journey.id);
  void updated;
  return snapshotFor(identity.userId, journey.id);
}

export async function recordDoctorRun(
  identity: DayOneIdentity,
  input: {
    idempotencyKey: string;
    status?: DoctorStatus;
    durationMs?: number;
    checks: DoctorCheck[];
  },
) {
  const journey = await ensureUserJourney(identity);
  const db = getDb();
  const [existingRun] = await db
    .select({ id: doctorRuns.id })
    .from(doctorRuns)
    .where(
      and(
        eq(doctorRuns.journeyId, journey.id),
        eq(doctorRuns.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existingRun) {
    return snapshotFor(identity.userId, journey.id);
  }

  const ownedTasks = await db
    .select()
    .from(journeyTasks)
    .where(eq(journeyTasks.journeyId, journey.id));
  const ownedSteps = await db
    .select({ id: journeySteps.id, slug: journeySteps.slug, status: journeySteps.status })
    .from(journeySteps)
    .where(eq(journeySteps.journeyId, journey.id));
  const stepStatus = new Map(ownedSteps.map((step) => [step.id, step.status]));
  if (ownedSteps.find((step) => step.slug === "run-locally")?.status === "locked") {
    throw new DayOneDataError(
      "locked",
      "Complete the access checklist before importing environment evidence.",
    );
  }
  const byId = new Map(ownedTasks.map((task) => [task.id, task]));
  const bySlug = new Map(ownedTasks.map((task) => [task.slug, task]));
  const grouped = new Map<
    string,
    { task: (typeof ownedTasks)[number]; checks: DoctorCheck[] }
  >();

  for (const check of input.checks) {
    const task =
      (check.taskId ? byId.get(check.taskId) : undefined) ??
      (check.slug ? bySlug.get(check.slug) : undefined);
    if (!task) continue;

    const group = grouped.get(task.id) ?? { task, checks: [] };
    group.checks.push(check);
    grouped.set(task.id, group);
  }

  const passedChecks = input.checks.filter((check) =>
    check.evidenceStatus
      ? check.evidenceStatus === "passed"
      : check.status === "done",
  ).length;
  const blockedChecks = input.checks.filter(
    (check) => check.status === "blocked",
  ).length;
  const derivedStatus: DoctorStatus =
    blockedChecks > 0 ? "blocked" : "healthy";
  const status = input.status === "error" ? "error" : derivedStatus;
  const mutations: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    db.insert(doctorRuns).values({
      id: crypto.randomUUID(),
      journeyId: journey.id,
      idempotencyKey: input.idempotencyKey,
      status,
      totalChecks: input.checks.length,
      passedChecks,
      blockedChecks,
      durationMs: input.durationMs ?? null,
      resultsJson: JSON.stringify(input.checks),
    }),
  ];

  for (const { task, checks } of grouped.values()) {
    // Doctor evidence for future steps is retained in the run, but it cannot
    // bypass journey prerequisites by mutating a locked task.
    if (stepStatus.get(task.stepId) === "locked") continue;
    const status = aggregateTaskStatus(checks.map((check) => check.status));
    const detail = checks
      .map((check) => check.detail?.trim())
      .filter((value): value is string => Boolean(value))
      .join(" · ")
      .slice(0, 1000);

    mutations.push(
      db
        .update(journeyTasks)
        .set({
          status,
          detail: detail || task.detail,
          completedAt: status === "done" ? sql`CURRENT_TIMESTAMP` : null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(journeyTasks.id, task.id)),
    );

    if (status === "done") {
      mutations.push(
        db
          .update(blockers)
          .set({
            status: "resolved",
            resolution: "Cleared by a successful environment doctor run.",
            resolvedAt: sql`CURRENT_TIMESTAMP`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(
            and(eq(blockers.taskId, task.id), eq(blockers.status, "open")),
          ),
      );
    }
  }

  try {
    // D1 batches are transactional, so the evidence record, task transitions,
    // and blocker resolutions either all persist or all roll back together.
    await db.batch(mutations);
  } catch (error) {
    // A concurrent retry can win the unique idempotency key after our initial
    // lookup. In that case the other request is the canonical successful run.
    const [concurrentRun] = await db
      .select({ id: doctorRuns.id })
      .from(doctorRuns)
      .where(
        and(
          eq(doctorRuns.journeyId, journey.id),
          eq(doctorRuns.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (concurrentRun) {
      await reconcileJourney(journey.id);
      return snapshotFor(identity.userId, journey.id);
    }
    throw error;
  }
  await reconcileJourney(journey.id);
  return snapshotFor(identity.userId, journey.id);
}

export async function getMetrics(identity: DayOneIdentity) {
  const journey = await ensureUserJourney(identity);
  return { metrics: await getMetricsForJourney(journey.id) };
}

export async function getGuideSources(
  identity: DayOneIdentity,
  topic?: string,
) {
  const journey = await ensureUserJourney(identity);
  const rows = await readGuideSources(journey.projectKey, topic);
  return { sources: rows.map(serializeSource) };
}

export async function answerGuideQuestion(
  identity: DayOneIdentity,
  question: string,
  context?: string,
) {
  const journey = await ensureUserJourney(identity);
  const [profile] = await getDb()
    .select({ buddyName: profiles.buddyName, team: profiles.team })
    .from(profiles)
    .where(eq(profiles.id, identity.userId))
    .limit(1);
  const topic = classifyQuestion(question, context);
  let sourceRows = await readGuideSources(journey.projectKey, topic);
  if (sourceRows.length === 0) {
    sourceRows = await readGuideSources(journey.projectKey);
  }

  const answers: Record<string, string> = {
    environment:
      "Run the doctor in this checkout and start with any explicit failure. Warnings remain visible but do not block progression. This repository does not require Docker; import a fresh report after fixing a failed check.",
    architecture:
      "The browser calls a vinext API route, Sites supplies authenticated-user headers, db/dayone.ts enforces journey transitions, and Drizzle persists the canonical snapshot in Cloudflare D1.",
    people:
      `DayOne records escalation context but does not notify anyone. Share the failed check and what you tried manually with ${profile?.buddyName || "your chosen reviewer"} or the ${profile?.team || "repository"} maintainer.`,
    delivery:
      "Make one evidence-based clarification in docs/environment-doctor.md, run the doctor tests and lint, then submit the repository-scoped pull request link and request review.",
    access:
      "Confirm repository access, GitHub authentication, the support path, and your reviewer yourself. DayOne stores acknowledgements but does not query those external systems.",
    onboarding:
      "Work through the active step one task at a time. DayOne unlocks the next step once every required task is done. Evidence-linked blockers gate their task; manually captured friction stays visible without silently changing progress.",
  };

  return {
    answer: answers[topic] ?? answers.onboarding,
    topic,
    sources: sourceRows.slice(0, 3).map(serializeSource),
  };
}

async function ensureUserJourney(identity: DayOneIdentity): Promise<Journey> {
  await ensureDatabase();
  await ensureStaticSeed();
  const db = getDb();

  await db
    .insert(profiles)
    .values({
      id: identity.userId,
      email: identity.email,
      displayName: identity.displayName,
    })
    .onConflictDoUpdate({
      target: profiles.id,
      set: {
        email: identity.email,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    });

  let [journey] = await db
    .select()
    .from(journeys)
    .where(
      and(
        eq(journeys.profileId, identity.userId),
        eq(journeys.projectKey, DAYONE_PROJECT.key),
      ),
    )
    .limit(1);

  if (!journey) {
    const journeyId = crypto.randomUUID();
    await db
      .insert(journeys)
      .values({
        id: journeyId,
        profileId: identity.userId,
        projectKey: DAYONE_PROJECT.key,
        projectName: DAYONE_PROJECT.name,
        repository: DAYONE_PROJECT.repository,
        branch: DAYONE_PROJECT.branch,
        activeStep: "get-access",
        targetDate: nextFriday(),
      })
      .onConflictDoNothing();

    [journey] = await db
      .select()
      .from(journeys)
      .where(
        and(
          eq(journeys.profileId, identity.userId),
          eq(journeys.projectKey, DAYONE_PROJECT.key),
        ),
      )
      .limit(1);
  }

  if (!journey) {
    throw new Error("Unable to create the onboarding journey.");
  }

  await seedJourney(journey);
  await reconcileJourney(journey.id);
  const [current] = await db
    .select()
    .from(journeys)
    .where(eq(journeys.id, journey.id))
    .limit(1);
  return current;
}

async function seedJourney(journey: Journey) {
  const db = getDb();
  const stepValues = DEFAULT_STEPS.map((step, position) => ({
    id: `${journey.id}:${step.slug}`,
    journeyId: journey.id,
    slug: step.slug,
    title: step.title,
    description: step.description,
    status:
      step.slug === "get-access" ? ("active" as const) : ("locked" as const),
    position,
  }));

  await db.insert(journeySteps).values(stepValues).onConflictDoNothing();

  const positions = new Map<string, number>();
  const taskValues = DEFAULT_TASKS.map((task) => {
    const position = positions.get(task.step) ?? 0;
    positions.set(task.step, position + 1);
    return {
      id: `${journey.id}:${task.slug}`,
      journeyId: journey.id,
      stepId: `${journey.id}:${task.step}`,
      slug: task.slug,
      label: task.label,
      detail: task.detail,
      command: "command" in task ? task.command : null,
      status: task.status,
      position,
      completedAt: null,
    };
  });
  // D1 caps bound parameters per prepared statement. Keep bootstrap seeding
  // comfortably below that limit instead of issuing one large multi-row insert.
  for (const batch of chunks(taskValues, 5)) {
    await db.insert(journeyTasks).values(batch).onConflictDoNothing();
  }

}

async function ensureStaticSeed() {
  staticSeed ??= seedStaticData();
  try {
    await staticSeed;
  } catch (error) {
    staticSeed = undefined;
    throw error;
  }
}

async function seedStaticData() {
  const db = getDb();
  await db
    .insert(services)
    .values(
      DEFAULT_SERVICES.map((service, position) => ({
        ...service,
        projectKey: DAYONE_PROJECT.key,
        position,
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(guideSources)
    .values(
      DEFAULT_GUIDE_SOURCES.map((source) => ({
        ...source,
        projectKey: DAYONE_PROJECT.key,
      })),
    )
    .onConflictDoNothing();
}

async function readJourney(profileId: string, journey: Journey) {
  const db = getDb();
  const [profileRows, stepRows, taskRows, blockerRows, doctorRows, serviceRows, sourceRows] =
    await Promise.all([
      db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1),
      db
        .select()
        .from(journeySteps)
        .where(eq(journeySteps.journeyId, journey.id))
        .orderBy(asc(journeySteps.position)),
      db
        .select()
        .from(journeyTasks)
        .where(eq(journeyTasks.journeyId, journey.id))
        .orderBy(asc(journeyTasks.position)),
      db
        .select()
        .from(blockers)
        .where(eq(blockers.journeyId, journey.id))
        .orderBy(desc(blockers.createdAt))
        .limit(100),
      db
        .select()
        .from(doctorRuns)
        .where(eq(doctorRuns.journeyId, journey.id))
        .orderBy(desc(doctorRuns.createdAt))
        .limit(10),
      db
        .select()
        .from(services)
        .where(eq(services.projectKey, journey.projectKey))
        .orderBy(asc(services.position)),
      db
        .select()
        .from(guideSources)
        .where(eq(guideSources.projectKey, journey.projectKey))
        .orderBy(asc(guideSources.priority)),
    ]);

  const tasksByStep = new Map<string, typeof taskRows>();
  for (const task of taskRows) {
    const current = tasksByStep.get(task.stepId) ?? [];
    current.push(task);
    tasksByStep.set(task.stepId, current);
  }

  const profile = profileRows[0];
  return {
    schemaVersion: 1 as const,
    mode: "connected" as const,
    journey: {
      id: journey.id,
      projectKey: journey.projectKey,
      projectName: journey.projectName,
      repository: journey.repository,
      branch: journey.branch,
      activeStep: journey.activeStep,
      status: journey.status,
      startedAt: journey.startedAt,
      targetDate: journey.targetDate,
      firstMrUrl: journey.firstMrUrl,
      firstMrRecordedAt: journey.firstMrRecordedAt,
      completedAt: journey.completedAt,
      updatedAt: journey.updatedAt,
    },
    profile: {
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      role: profile.role,
      team: profile.team,
      buddyName: profile.buddyName,
      buddyEmail: profile.buddyEmail,
    },
    steps: stepRows.map((step) => {
      const tasks = tasksByStep.get(step.id) ?? [];
      return {
        id: step.id,
        slug: step.slug,
        title: step.title,
        description: step.description,
        status: step.status,
        position: step.position,
        completedTasks: tasks.filter((task) => task.status === "done").length,
        totalTasks: tasks.length,
        tasks: tasks.map(serializeTask),
      };
    }),
    doctorRuns: doctorRows.map(serializeDoctorRun),
    blockers: blockerRows,
    metrics: await getMetricsForJourney(journey.id),
    services: serviceRows.map((service) => ({
      id: service.id,
      name: service.name,
      kind: service.kind,
      description: service.description,
      position: service.position,
    })),
    sources: sourceRows.map(serializeSource),
  };
}

async function snapshotFor(profileId: string, journeyId: string) {
  const [journey] = await getDb()
    .select()
    .from(journeys)
    .where(
      and(eq(journeys.id, journeyId), eq(journeys.profileId, profileId)),
    )
    .limit(1);
  if (!journey) {
    throw new DayOneDataError("not_found", "Journey not found.");
  }
  return readJourney(profileId, journey);
}

async function reconcileJourney(journeyId: string) {
  const db = getDb();
  const [steps, tasks] = await Promise.all([
    db
      .select()
      .from(journeySteps)
      .where(eq(journeySteps.journeyId, journeyId))
      .orderBy(asc(journeySteps.position)),
    db.select().from(journeyTasks).where(eq(journeyTasks.journeyId, journeyId)),
  ]);
  if (steps.length === 0) return;

  const byStep = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const current = byStep.get(task.stepId) ?? [];
    current.push(task);
    byStep.set(task.stepId, current);
  }

  const firstIncomplete = steps.findIndex((step) => {
    const required = (byStep.get(step.id) ?? []).filter((task) => task.required);
    return required.length === 0 || required.some((task) => task.status !== "done");
  });

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepTasks = byStep.get(step.id) ?? [];
    let status: "complete" | "active" | "blocked" | "locked";
    if (firstIncomplete === -1 || index < firstIncomplete) {
      status = "complete";
    } else if (index === firstIncomplete) {
      status = stepTasks.some((task) => task.status === "blocked")
        ? "blocked"
        : "active";
    } else {
      status = "locked";
    }

    if (status !== step.status) {
      await db
        .update(journeySteps)
        .set({ status, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(journeySteps.id, step.id));
    }
  }

  const complete = firstIncomplete === -1;
  const activeStep = complete
    ? steps[steps.length - 1].slug
    : steps[firstIncomplete].slug;
  await db
    .update(journeys)
    .set({
      activeStep,
      status: complete ? "complete" : "active",
      completedAt: complete ? sql`COALESCE(${journeys.completedAt}, CURRENT_TIMESTAMP)` : null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(journeys.id, journeyId));
}

async function getMetricsForJourney(journeyId: string) {
  const db = getDb();
  const [
    taskRows,
    openBlockerRows,
    gapCountRows,
    helpRequestRows,
    doctorCountRows,
    latestDoctorRows,
    doctorEvidenceRows,
    journeyTimingRows,
  ] =
    await Promise.all([
      db
        .select({ status: journeyTasks.status })
        .from(journeyTasks)
        .where(eq(journeyTasks.journeyId, journeyId)),
      db
        .select({ id: blockers.id })
        .from(blockers)
        .where(
          and(eq(blockers.journeyId, journeyId), eq(blockers.status, "open")),
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(blockers)
        .where(eq(blockers.journeyId, journeyId)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(blockers)
        .where(
          and(
            eq(blockers.journeyId, journeyId),
            eq(blockers.category, "mentoring"),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(doctorRuns)
        .where(eq(doctorRuns.journeyId, journeyId)),
      db
        .select({ status: doctorRuns.status, createdAt: doctorRuns.createdAt })
        .from(doctorRuns)
        .where(eq(doctorRuns.journeyId, journeyId))
        .orderBy(desc(doctorRuns.createdAt))
        .limit(1),
      db
        .select({
          createdAt: doctorRuns.createdAt,
          resultsJson: doctorRuns.resultsJson,
        })
        .from(doctorRuns)
        .where(eq(doctorRuns.journeyId, journeyId))
        .orderBy(asc(doctorRuns.createdAt))
        .limit(100),
      db
        .select({
          startedAt: journeys.startedAt,
          firstMrRecordedAt: journeys.firstMrRecordedAt,
        })
        .from(journeys)
        .where(eq(journeys.id, journeyId))
        .limit(1),
    ]);
  const completedTasks = taskRows.filter((task) => task.status === "done").length;
  const totalTasks = taskRows.length;
  const timing = journeyTimingRows[0];
  const firstLocalHealthRun = doctorEvidenceRows.find((run) =>
    hasSuccessfulLocalHealth(run.resultsJson),
  );
  return {
    completedTasks,
    totalTasks,
    progressPercent:
      totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100),
    openBlockers: openBlockerRows.length,
    gapsFound: Number(gapCountRows[0]?.count ?? 0),
    helpRequests: Number(helpRequestRows[0]?.count ?? 0),
    doctorRuns: Number(doctorCountRows[0]?.count ?? 0),
    lastDoctorStatus: latestDoctorRows[0]?.status ?? null,
    lastDoctorAt: latestDoctorRows[0]?.createdAt ?? null,
    firstLocalRunMinutes: minutesBetween(
      timing?.startedAt,
      firstLocalHealthRun?.createdAt,
    ),
    firstMrMinutes: minutesBetween(
      timing?.startedAt,
      timing?.firstMrRecordedAt,
    ),
  };
}

async function readGuideSources(projectKey: string, topic?: string) {
  const db = getDb();
  return db
    .select()
    .from(guideSources)
    .where(
      topic
        ? and(eq(guideSources.projectKey, projectKey), eq(guideSources.topic, topic))
        : eq(guideSources.projectKey, projectKey),
    )
    .orderBy(asc(guideSources.priority))
    .limit(20);
}

function serializeTask(task: typeof journeyTasks.$inferSelect) {
  return {
    id: task.id,
    slug: task.slug,
    label: task.label,
    detail: task.detail,
    command: task.command,
    status: task.status,
    position: task.position,
    required: task.required,
    completedAt: task.completedAt,
    updatedAt: task.updatedAt,
  };
}

function serializeDoctorRun(run: typeof doctorRuns.$inferSelect) {
  let checks: unknown[] = [];
  try {
    const parsed = JSON.parse(run.resultsJson) as unknown;
    if (Array.isArray(parsed)) checks = parsed;
  } catch {
    checks = [];
  }
  return {
    id: run.id,
    status: run.status,
    totalChecks: run.totalChecks,
    passedChecks: run.passedChecks,
    blockedChecks: run.blockedChecks,
    durationMs: run.durationMs,
    checks,
    createdAt: run.createdAt,
  };
}

function serializeSource(source: typeof guideSources.$inferSelect) {
  return {
    id: source.id,
    topic: source.topic,
    title: source.title,
    label: source.title,
    type: source.type,
    locator: source.locator,
    section: source.locator,
    excerpt: source.excerpt,
    priority: source.priority,
    updatedAt: source.updatedAt,
  };
}

function classifyQuestion(question: string, context?: string) {
  return classifyQuestionText(question) ?? classifyQuestionText(context ?? "") ?? "onboarding";
}

function classifyQuestionText(input: string) {
  const value = input.toLowerCase();
  if (
    /docker|database|local|install|runtime|secret|environment|dependenc|package|npm|node/.test(
      value,
    )
  ) {
    return "environment";
  }
  if (/merge|\bmr\b|review|ship|branch|pull request/.test(value)) {
    return "delivery";
  }
  if (/who|buddy|help|owner|maya|team/.test(value)) return "people";
  if (/access|credential|permission|channel/.test(value)) return "access";
  if (/architecture|request|gateway|service|system|flow/.test(value)) {
    return "architecture";
  }
  if (/get-access/.test(value)) return "access";
  if (/run-locally/.test(value)) return "environment";
  if (/know-the-system/.test(value)) return "architecture";
  if (/make-a-change|ship-first-mr/.test(value)) return "delivery";
  return undefined;
}

function aggregateTaskStatus(statuses: TaskStatus[]): TaskStatus {
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("ready")) return "ready";
  return "done";
}

const EVIDENCE_CONTROLLED_TASKS = new Set([
  "runtime",
  "dependencies",
  "git",
  "secrets",
  "database",
  "local-health",
  "open-merge-request",
]);

function assertManualTaskTransition(slug: string, status: TaskStatus) {
  if (status !== "done" || !EVIDENCE_CONTROLLED_TASKS.has(slug)) return;
  if (slug === "open-merge-request") {
    throw new DayOneDataError(
      "conflict",
      "Submit the repository-scoped GitHub pull request link to complete this milestone.",
    );
  }
  throw new DayOneDataError(
    "conflict",
    "Import a matching environment doctor report to complete this task.",
  );
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function nextFriday() {
  const now = new Date();
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  let days = (5 - target.getUTCDay() + 7) % 7;
  if (days === 0) days = 7;
  target.setUTCDate(target.getUTCDate() + days);
  return target.toISOString().slice(0, 10);
}

function minutesBetween(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const startMs = parseSqliteTimestamp(start);
  const endMs = parseSqliteTimestamp(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return null;
  }
  return Math.round((endMs - startMs) / 60_000);
}

function parseSqliteTimestamp(value: string) {
  return Date.parse(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value,
  );
}

function hasSuccessfulLocalHealth(resultsJson: string) {
  try {
    const checks = JSON.parse(resultsJson) as unknown;
    return (
      Array.isArray(checks) &&
      checks.some(
        (check) =>
          check &&
          typeof check === "object" &&
          "slug" in check &&
          check.slug === "local-health" &&
          "status" in check &&
          check.status === "done" &&
          "evidenceStatus" in check &&
          check.evidenceStatus === "passed",
      )
    );
  } catch {
    return false;
  }
}
