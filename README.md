# DayOne

Context-aware developer onboarding, from access and machine setup to a first pull request.

DayOne replaces a static onboarding checklist with a verifiable journey. The web app keeps durable progress in Cloudflare D1, the companion doctor inspects the developer's real checkout, and every remediation answer points back to a repository source or runbook.

## Product flow

1. **Get access** — confirm repository, team, credentials, and buddy context.
2. **Run locally** — execute the doctor in the actual checkout, optionally verify the running app, and import its versioned JSON through the signed-in DayOne browser UI.
3. **Know the system** — follow a sourced request flow and learn service ownership.
4. **Make a change** — complete a low-risk issue with branch and test evidence.
5. **Ship first MR** — submit a repository-scoped pull request link and return onboarding friction to the platform backlog.
6. **Improve** — measure time to first successful local run, time to first MR, human interruptions, and gaps discovered.

Locked steps cannot be completed out of order. Failed automated checks require a fresh passing doctor run; the browser never claims to inspect the local machine itself.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

The app exposes `GET /api/health` for the optional local-run check. The doctor accepts only loopback URLs and verifies the DayOne JSON health signature. Run it from another terminal using the URL printed by the development server:

```bash
node cli/dayone.mjs \
  --health-url http://localhost:3000/api/health \
  --json > dayone-doctor.json
```

Open **Run locally → Import result** in DayOne and paste the contents of `dayone-doctor.json`. This authenticated browser import is the only supported delivery flow; the CLI never calls the DayOne API directly.

Release evidence includes `repositoryHost: "github.com"` and a credential-free `owner/repository` only when the checkout's `origin` is a strict GitHub HTTPS or SSH remote. Missing or non-GitHub origins remain warnings and are never presented as target-repository proof.

See [the environment doctor guide](docs/environment-doctor.md) for checks, privacy behavior, browser import, and exit codes.

## Connected and demo modes

- With a valid Sites / Sign in with ChatGPT identity and the `DB` D1 binding, API routes create or restore a user-owned journey and return `mode: "connected"` snapshots.
- Without that identity, the interface is an explicitly labelled demo and offers a sign-in path. Demo actions never masquerade as persisted state.

The database schema is defined in [db/schema.ts](db/schema.ts), initialized for local previews by [db/initialize.ts](db/initialize.ts), and versioned in [drizzle/0000_dayone_init.sql](drizzle/0000_dayone_init.sql).

## API surface

- `GET /api/bootstrap` — canonical profile, journey, steps, doctor history, blockers, metrics, services, and sources
- `PATCH /api/profile` — role, team, and onboarding buddy
- `GET|PATCH /api/journey` — repository branch and target date
- `PATCH /api/tasks/:id` — guarded task transitions
- `POST /api/doctor-runs` — authenticated browser import of versioned CLI evidence and idempotent reconciliation
- `GET|POST /api/blockers` — friction and human escalation
- `POST /api/guide` — deterministic contextual answer with source records
- `POST /api/merge-request` — repository-scoped first pull request link milestone
- `GET /api/metrics` — BOOT / MR1 / HELP / GAP experiment measurements

All user-owned API routes verify the server-provided authenticated-user headers. Client-supplied user IDs are ignored.

## Verify

```bash
npm run typecheck
npm run lint
npm test
```

The full test command builds the Cloudflare-compatible vinext output and runs the rendered-app, CLI, and API contract tests.

## Source context

- [Request flow](docs/architecture/request-flow.md)
- [Developer access](docs/onboarding/access.md)
- [Service ownership](docs/onboarding/ownership.md)
- [First change brief](docs/onboarding/first-change.md)
- [Local database runbook](runbooks/local-database.md)

Built with React 19, vinext, Drizzle ORM, Cloudflare D1, and Cloudflare Worker-compatible ESM output.
