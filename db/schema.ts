import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("Frontend Engineer"),
  team: text("team").notNull().default("Repository"),
  buddyName: text("buddy_name").notNull().default("Repository maintainer"),
  buddyEmail: text("buddy_email"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const journeys = sqliteTable(
  "journeys",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    projectKey: text("project_key").notNull(),
    projectName: text("project_name").notNull(),
    repository: text("repository").notNull(),
    branch: text("branch").notNull().default("main"),
    activeStep: text("active_step").notNull().default("get-access"),
    status: text("status").notNull().default("active"),
    startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    targetDate: text("target_date"),
    firstMrUrl: text("first_mr_url"),
    firstMrRecordedAt: text("first_mr_recorded_at"),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_journeys_profile_project").on(
      table.profileId,
      table.projectKey,
    ),
    check(
      "journeys_status_check",
      sql`${table.status} IN ('active', 'complete', 'paused')`,
    ),
  ],
);

export const journeySteps = sqliteTable(
  "journey_steps",
  {
    id: text("id").primaryKey(),
    journeyId: text("journey_id")
      .notNull()
      .references(() => journeys.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("locked"),
    position: integer("position").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_journey_steps_journey_slug").on(
      table.journeyId,
      table.slug,
    ),
    index("idx_journey_steps_journey_position").on(
      table.journeyId,
      table.position,
    ),
    check(
      "journey_steps_status_check",
      sql`${table.status} IN ('active', 'complete', 'blocked', 'locked')`,
    ),
  ],
);

export const journeyTasks = sqliteTable(
  "journey_tasks",
  {
    id: text("id").primaryKey(),
    journeyId: text("journey_id")
      .notNull()
      .references(() => journeys.id, { onDelete: "cascade" }),
    stepId: text("step_id")
      .notNull()
      .references(() => journeySteps.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    detail: text("detail").notNull(),
    command: text("command"),
    status: text("status").notNull().default("ready"),
    position: integer("position").notNull(),
    required: integer("required", { mode: "boolean" }).notNull().default(true),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_journey_tasks_journey_slug").on(
      table.journeyId,
      table.slug,
    ),
    index("idx_journey_tasks_step_position").on(table.stepId, table.position),
    index("idx_journey_tasks_journey_status").on(
      table.journeyId,
      table.status,
    ),
    check(
      "journey_tasks_status_check",
      sql`${table.status} IN ('ready', 'done', 'blocked')`,
    ),
  ],
);

export const blockers = sqliteTable(
  "blockers",
  {
    id: text("id").primaryKey(),
    journeyId: text("journey_id")
      .notNull()
      .references(() => journeys.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => journeyTasks.id, {
      onDelete: "set null",
    }),
    category: text("category").notNull().default("environment"),
    summary: text("summary").notNull(),
    detail: text("detail").notNull().default(""),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("idx_blockers_journey_status_created").on(
      table.journeyId,
      table.status,
      table.createdAt,
    ),
    index("idx_blockers_journey_category").on(
      table.journeyId,
      table.category,
    ),
    check(
      "blockers_status_check",
      sql`${table.status} IN ('open', 'resolved', 'dismissed')`,
    ),
  ],
);

export const doctorRuns = sqliteTable(
  "doctor_runs",
  {
    id: text("id").primaryKey(),
    journeyId: text("journey_id")
      .notNull()
      .references(() => journeys.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    totalChecks: integer("total_checks").notNull(),
    passedChecks: integer("passed_checks").notNull(),
    blockedChecks: integer("blocked_checks").notNull(),
    durationMs: integer("duration_ms"),
    resultsJson: text("results_json").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_doctor_runs_journey_created").on(
      table.journeyId,
      table.createdAt,
    ),
    uniqueIndex("idx_doctor_runs_journey_idempotency").on(
      table.journeyId,
      table.idempotencyKey,
    ),
    check(
      "doctor_runs_status_check",
      sql`${table.status} IN ('healthy', 'blocked', 'error')`,
    ),
  ],
);

export const services = sqliteTable(
  "services",
  {
    id: text("id").primaryKey(),
    projectKey: text("project_key").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    uniqueIndex("idx_services_project_name").on(table.projectKey, table.name),
    index("idx_services_project_position").on(
      table.projectKey,
      table.position,
    ),
  ],
);

export const guideSources = sqliteTable(
  "guide_sources",
  {
    id: text("id").primaryKey(),
    projectKey: text("project_key").notNull(),
    topic: text("topic").notNull(),
    title: text("title").notNull(),
    type: text("type").notNull(),
    locator: text("locator").notNull(),
    excerpt: text("excerpt").notNull(),
    priority: integer("priority").notNull().default(100),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_guide_sources_project_topic_priority").on(
      table.projectKey,
      table.topic,
      table.priority,
    ),
    check(
      "guide_sources_type_check",
      sql`${table.type} IN ('repository', 'runbook', 'person', 'architecture')`,
    ),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type Journey = typeof journeys.$inferSelect;
export type JourneyStep = typeof journeySteps.$inferSelect;
export type JourneyTask = typeof journeyTasks.$inferSelect;
export type Blocker = typeof blockers.$inferSelect;
export type DoctorRun = typeof doctorRuns.$inferSelect;
export type GuideSource = typeof guideSources.$inferSelect;
