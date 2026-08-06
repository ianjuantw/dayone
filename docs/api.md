# DayOne API

All routes require the Sites-provided ChatGPT user headers. Successful state
reads and writes return `Cache-Control: private, no-store`; errors use
`{ "error": { "code": "…", "message": "…" } }`.

## Canonical snapshot

`GET /api/bootstrap` and `GET /api/journey` return the connected snapshot:

```json
{
  "schemaVersion": 1,
  "mode": "connected",
  "journey": {},
  "profile": {},
  "steps": [],
  "doctorRuns": [],
  "blockers": [],
  "metrics": {},
  "services": [],
  "sources": []
}
```

Every state-changing route returns this same snapshot so the client can replace
its state atomically.

## Writes

- `PATCH /api/tasks/:id` — `{ "status": "ready|done|blocked" }`. Locked
  tasks are rejected with `409 conflict`.
- `PATCH /api/profile` — saves `displayName`, `role`, `team`, `buddyName`, or
  `buddyEmail`.
- `PATCH /api/journey` — saves `branch` or `targetDate`; repository scope is locked to `ianjuantw/dayone`.
- `POST /api/blockers` — reports `{ taskId?, category, summary, detail? }`.
- `PATCH /api/blockers/:id` — resolves or dismisses a blocker.
- `POST /api/doctor-runs` — records normalized doctor checks. CLI
  `pass|warn|fail` and UI `passed|warning|blocked` statuses are accepted.
  Warnings remain visible evidence but are non-blocking; only explicit failures
  prevent a required setup task from completing.
  Repeated imports are deduplicated by an idempotency header, `runId`, or the
  CLI report's `generatedAt + project.name` identity.
- `POST /api/merge-request` — records a syntactically valid, repository-scoped
  `https://github.com/ianjuantw/dayone/pull/:number` URL with a first-write-wins
  server timestamp. Repeating the same URL is idempotent; replacing it is rejected.
  This endpoint does not query GitHub to assert that the pull request exists or
  is reviewable.
- `POST /api/guide` — answers `{ question, context? }` using traceable sources.

## Focused reads

- `GET /api/metrics`
- `GET /api/blockers`
- `GET /api/guide/sources?topic=environment`

Task statuses are `ready`, `done`, and `blocked`. Step statuses are `active`,
`complete`, `blocked`, and `locked`. The server owns all step transitions.
`metrics.gapsFound` is the cumulative number of recorded friction events;
resolving one only changes `metrics.openBlockers`.
