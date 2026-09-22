# Cyber Intelligence Lab

A defensive cybersecurity learning portfolio built with React, TypeScript, and Vite. Explore simulated incident workflows alongside a real public-source intelligence feed.

## What is real, and what is simulated?

| Area | Data and capability |
| --- | --- |
| Live intelligence | Public CISA Known Exploited Vulnerabilities records and cybersecurity stories from Hacker News Algolia. Source health and stale records are labelled. |
| Operations console | Illustrative map, actor rankings, packet stream, and incidents. The event counter runs only when you start the simulation. |
| Incident response | Static learning examples, sample artifacts, and a copyable demo brief. No AI model, endpoint action, or containment service is connected. |
| Case studies | Practice scenarios and example outcomes, not claims of real security operations. |

The app does not scan systems, inspect private traffic, detect real attacks, or execute exploits. Public-source records can be incomplete or outdated; verify them at their linked source before using them.

## Run locally

Use **Node.js 24 or later** and npm. The runtime and unit tests use Node's native TypeScript support.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Windows users can also run `start.bat`.

## Build and run

```sh
npm run build
npm start
```

The production server defaults to `http://127.0.0.1:3000`, serves `dist/`, and provides `/api/live-intel`. See [deployment](docs/deployment.md) for environment settings and hosting requirements. Uploading `dist/` alone to a static host will not provide the API. `npm run preview` is only a local build preview.

## Verify changes

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` runs lint, strict type checking, unit/integration tests, and a production build. Browser checks run at desktop and mobile sizes with mocked public-source responses; they do not depend on external services. See the [testing guide](docs/testing.md) for individual commands and local Edge support.

## How live intelligence works

The server requests only fixed CISA and Hacker News URLs. A shared 60-second cache and in-flight request deduplication reduce upstream traffic. Requests have time and response-size limits. Each source retains its last successful results when refreshes fail; the response and UI label degraded data rather than presenting it as fresh.

The client validates responses, prevents overlapping refreshes, and retries failures. **Refresh sources** checks the server cache; it does not bypass upstream rate protection. See the [API contract](docs/api.md) for status and timing details.

## Project layout

```text
src/                  React dashboard, polling hook, client validation
shared/               API types
server/               Public-source transport, parsing, cache, HTTP middleware
runtime/              Production static and API server
tests/                Unit, integration, and browser regressions
docs/                 Deployment, testing, and architecture notes
```

The existing dark tactical visual style is retained. Generated art-direction references live in [docs/design-reference](docs/design-reference), outside the production asset directory.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) for focused changes and review checks, and [SECURITY.md](SECURITY.md) for reporting a vulnerability. Do not include credentials, private incident data, or real targets in demo fixtures.
