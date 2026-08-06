# DayOne request flow

This is the request path implemented by this repository. The “Know the system” step uses `GET /api/bootstrap` as the concrete example.

1. **DayOne UI** — `app/page.tsx` requests the canonical journey and renders the response. Client state is optimistic only where the server can still reject the mutation.
2. **vinext API route** — `app/api/bootstrap/route.ts` and the shared API helpers validate the HTTP request and shape errors.
3. **ChatGPT identity** — `app/chatgpt-auth.ts` reads the authenticated-user headers supplied by the Sites runtime. Client-provided user IDs are ignored.
4. **Journey domain service** — `db/dayone.ts` creates the user journey, applies evidence guards, reconciles step order, and calculates metrics.
5. **Cloudflare D1** — Drizzle writes the schema in `db/schema.ts`; the generated migration is `drizzle/0000_dayone_init.sql`.

## Ownership boundary

- Rendering and client normalization: `app/page.tsx`
- HTTP validation and status codes: `app/api/**`
- Identity parsing: `app/chatgpt-auth.ts` and the Sites runtime
- Journey rules and experiment metrics: `db/dayone.ts`
- Persistence and schema evolution: `db/schema.ts`, `db/initialize.ts`, and `drizzle/**`

There is no separate Gateway, Projects API, or async queue in this repository. Any future service must be added to this document only after its implementation exists.
