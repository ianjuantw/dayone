# Environment doctor CLI

The DayOne doctor checks whether a local checkout is ready for development. It uses only Node.js built-ins and never installs, modifies, or uploads anything.

## Run it

From this repository:

```bash
node cli/dayone.mjs
node cli/dayone.mjs /path/to/another/project
node cli/dayone.mjs --json
node cli/dayone.mjs --health-url http://localhost:3000/api/health
```

This repository also exposes the human-readable doctor through its package script:

```bash
npm run doctor
```

## Checks

The report covers:

- the running Node.js version against `engines.node` and `.nvmrc`;
- the declared or lockfile-inferred package manager and its availability;
- Git repository access, the current branch (including detached HEAD), and a safely normalized `owner/repository` from a `github.com` HTTPS, SSH, or SCP-style `origin`;
- installed runtime and development dependencies;
- required keys from `.env.example`, `.env.sample`, `.env.template`, and their named variants;
- Docker CLI and daemon availability, with Docker treated as blocking only when the project contains a Dockerfile or Compose file;
- an optional loopback-only local app endpoint, which passes only on a `2xx` response with the DayOne JSON signature within three seconds.

The local app check is strictly opt-in through `--health-url` or `DAYONE_HEALTH_URL`. It accepts `localhost`, subdomains of `.localhost`, `127.0.0.0/8`, and `::1` only; any other host fails before a network request is made. A loopback response must be `2xx` JSON containing the identifying field/value pairs `{"service":"dayone-web","status":"ok"}`; additional fields are allowed. The response body is streamed under the same three-second timeout and rejected after 16 KiB. When no URL is set, the report contains no `local-health` check. Consumers should count only an explicit `local-health` result with `status: "pass"` as the first successful local run.

```bash
DAYONE_HEALTH_URL=http://localhost:3000/api/health node cli/dayone.mjs --json
```

Warnings do not block work. Failures use exit code `1`. Invalid arguments or an inability to start the doctor use exit code `2`.

## Import a report in DayOne

The only supported delivery flow is an authenticated browser import. The DayOne API relies on the browser's Sign in with ChatGPT identity, so the CLI intentionally has no HTTP send, API URL, or token options.

```bash
node cli/dayone.mjs \
  --health-url http://localhost:3000/api/health \
  --json > dayone-doctor.json
```

Open DayOne while signed in, go to **Run locally**, choose **Import result**, and paste the contents of `dayone-doctor.json`. The browser then submits the report with its authenticated session.

Environment variable **names** and missing-key names can appear in a report. Their values, file contents, and the machine hostname are never collected. Git remote credentials, query parameters, and raw tokens are never emitted; only a strict `github.com` origin is reduced to its final `owner/repository` path. Other Git hosts are not accepted as release identity. If no safe GitHub origin exists, the Git check warns and both repository fields are `null`. Human output can show the local project path for diagnostics. JSON output is prepared for browser import: project and Git paths are reduced to the project directory name, and the health endpoint address is replaced with `<redacted>`.

## JSON contract

Reports include a versioned top-level schema, CLI metadata, project name and path, timestamp, summary, and ordered checks:

```json
{
  "schemaVersion": 1,
  "tool": { "name": "dayone", "version": "0.1.0" },
  "generatedAt": "2026-08-06T00:00:00.000Z",
  "project": {
    "name": "dayone",
    "path": "dayone",
    "repository": "ianjuantw/dayone",
    "repositoryHost": "github.com"
  },
  "summary": {
    "status": "warn",
    "counts": { "pass": 5, "warn": 2, "fail": 0 },
    "exitCode": 0
  },
  "checks": [
    {
      "id": "node-version",
      "title": "Node.js",
      "status": "pass",
      "message": "Node.js v22.13.0 satisfies >=22.13.0."
    }
  ]
}
```

When configured, the health result is appended as a regular versioned check:

```json
{
  "id": "local-health",
  "title": "Local app",
  "status": "pass",
  "message": "Local DayOne health endpoint returned HTTP 200 with a valid signature.",
  "details": {
    "url": "<redacted>",
    "statusCode": 200,
    "timeoutMs": 3000,
    "bodyLimitBytes": 16384,
    "signatureValid": true
  }
}
```

## Test it

The CLI tests are independent of the app build:

```bash
node --test tests/dayone-cli.test.mjs
```
