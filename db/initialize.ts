import { getD1 } from "./index";

// Runtime initialization makes a fresh local/preview D1 usable immediately.
// Deployed schema evolution remains migration-driven; CREATE IF NOT EXISTS is
// intentionally limited to the baseline schema represented by 0000 migration.
const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT DEFAULT 'Frontend Engineer' NOT NULL,
    team TEXT DEFAULT 'Repository' NOT NULL,
    buddy_name TEXT DEFAULT 'Repository maintainer' NOT NULL,
    buddy_email TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS journeys (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL,
    project_key TEXT NOT NULL,
    project_name TEXT NOT NULL,
    repository TEXT NOT NULL,
    branch TEXT DEFAULT 'main' NOT NULL,
    active_step TEXT DEFAULT 'get-access' NOT NULL,
    status TEXT DEFAULT 'active' NOT NULL,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    target_date TEXT,
    first_mr_url TEXT,
    first_mr_recorded_at TEXT,
    completed_at TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON UPDATE no action ON DELETE cascade,
    CONSTRAINT journeys_status_check CHECK (status IN ('active', 'complete', 'paused'))
  )`,
  `CREATE TABLE IF NOT EXISTS journey_steps (
    id TEXT PRIMARY KEY NOT NULL,
    journey_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'locked' NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (journey_id) REFERENCES journeys(id) ON UPDATE no action ON DELETE cascade,
    CONSTRAINT journey_steps_status_check CHECK (status IN ('active', 'complete', 'blocked', 'locked'))
  )`,
  `CREATE TABLE IF NOT EXISTS journey_tasks (
    id TEXT PRIMARY KEY NOT NULL,
    journey_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    label TEXT NOT NULL,
    detail TEXT NOT NULL,
    command TEXT,
    status TEXT DEFAULT 'ready' NOT NULL,
    position INTEGER NOT NULL,
    required INTEGER DEFAULT 1 NOT NULL,
    completed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (journey_id) REFERENCES journeys(id) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (step_id) REFERENCES journey_steps(id) ON UPDATE no action ON DELETE cascade,
    CONSTRAINT journey_tasks_status_check CHECK (status IN ('ready', 'done', 'blocked'))
  )`,
  `CREATE TABLE IF NOT EXISTS blockers (
    id TEXT PRIMARY KEY NOT NULL,
    journey_id TEXT NOT NULL,
    task_id TEXT,
    category TEXT DEFAULT 'environment' NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT DEFAULT '' NOT NULL,
    status TEXT DEFAULT 'open' NOT NULL,
    resolution TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY (journey_id) REFERENCES journeys(id) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (task_id) REFERENCES journey_tasks(id) ON UPDATE no action ON DELETE set null,
    CONSTRAINT blockers_status_check CHECK (status IN ('open', 'resolved', 'dismissed'))
  )`,
  `CREATE TABLE IF NOT EXISTS doctor_runs (
    id TEXT PRIMARY KEY NOT NULL,
    journey_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL,
    total_checks INTEGER NOT NULL,
    passed_checks INTEGER NOT NULL,
    blocked_checks INTEGER NOT NULL,
    duration_ms INTEGER,
    results_json TEXT DEFAULT '[]' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (journey_id) REFERENCES journeys(id) ON UPDATE no action ON DELETE cascade,
    CONSTRAINT doctor_runs_status_check CHECK (status IN ('healthy', 'blocked', 'error'))
  )`,
  `CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY NOT NULL,
    project_key TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    description TEXT NOT NULL,
    position INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS guide_sources (
    id TEXT PRIMARY KEY NOT NULL,
    project_key TEXT NOT NULL,
    topic TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    locator TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    priority INTEGER DEFAULT 100 NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT guide_sources_type_check CHECK (type IN ('repository', 'runbook', 'person', 'architecture'))
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_journeys_profile_project ON journeys (profile_id, project_key)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_journey_steps_journey_slug ON journey_steps (journey_id, slug)",
  "CREATE INDEX IF NOT EXISTS idx_journey_steps_journey_position ON journey_steps (journey_id, position)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_journey_tasks_journey_slug ON journey_tasks (journey_id, slug)",
  "CREATE INDEX IF NOT EXISTS idx_journey_tasks_step_position ON journey_tasks (step_id, position)",
  "CREATE INDEX IF NOT EXISTS idx_journey_tasks_journey_status ON journey_tasks (journey_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_blockers_journey_status_created ON blockers (journey_id, status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_blockers_journey_category ON blockers (journey_id, category)",
  "CREATE INDEX IF NOT EXISTS idx_doctor_runs_journey_created ON doctor_runs (journey_id, created_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_runs_journey_idempotency ON doctor_runs (journey_id, idempotency_key)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_services_project_name ON services (project_key, name)",
  "CREATE INDEX IF NOT EXISTS idx_services_project_position ON services (project_key, position)",
  "CREATE INDEX IF NOT EXISTS idx_guide_sources_project_topic_priority ON guide_sources (project_key, topic, priority)",
] as const;

let initialization: Promise<void> | undefined;

export async function ensureDatabase(): Promise<void> {
  initialization ??= initialize();

  try {
    await initialization;
  } catch (error) {
    initialization = undefined;
    throw error;
  }
}

async function initialize(): Promise<void> {
  const d1 = getD1();
  await d1.prepare("PRAGMA foreign_keys = ON").run();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
  await d1.prepare("PRAGMA optimize").run();
}
