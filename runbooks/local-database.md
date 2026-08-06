# Local data runbook

DayOne persists connected journeys in Cloudflare D1. This repository does not require Docker or a standalone local database service.

## Local preview

1. Run `npm run dev`.
2. Request `GET /api/health` to confirm the local Worker-compatible app is responding.
3. The runtime baseline in `db/initialize.ts` creates fresh local/preview tables when a D1 binding is available.
4. Production schema evolution uses `drizzle/0000_dayone_init.sql`.

The environment doctor may report Docker as a non-blocking warning when no Docker requirement is detected. Do not install or start Docker solely to complete this project’s onboarding journey.
