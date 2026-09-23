# Cyber Intelligence Lab

A defensive cybersecurity learning portfolio built with React, TypeScript, and Vite. Explore simulated incident workflows alongside a real public-source intelligence feed.

## What is real, and what is simulated?

| Area | Data and capability |
| --- | --- |
| Live intelligence | Official CISA Known Exploited Vulnerabilities records and Microsoft MSRC security updates, alongside clearly labelled, unverified Hacker News community context. Source health and stale records are labelled. |
| Operations console | Randomized synthetic incidents, an illustrative map, and queue summaries. Activity and queue rows open evidence and response together; replay is opt-in. |
| Incident response | Five linked learning scenarios: selecting an incident updates its risk, timeline, indicators, actions and forensic artifacts. Copy a clearly labelled exercise brief. No AI model, endpoint action, or containment service is connected. |
| Case studies | Practice scenarios and example outcomes, not claims of real security operations. |

The app does not scan systems, inspect private traffic, detect real attacks, or execute exploits. Public-source records can be incomplete or outdated; verify them at their linked source before using them.

## Run locally

Use **Node.js 24 or later** and npm. The runtime and unit tests use Node's native TypeScript support.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/**. Keep the terminal running while checking the app.
Windows users can double-click **`start.bat`** instead: it installs dependencies
if needed, starts Vite and opens the browser automatically. After pulling dependency
changes, run `npm ci` again. If this project's preview is already running, the
launcher reopens it instead of starting a duplicate server.

### VS Code: Go Live

This is a React/TypeScript app, not a static HTML page. Live Server alone cannot
compile `src/main.tsx` or provide the live intelligence API; serving the project
folder directly cannot start the app correctly.

1. Start the app with `npm run dev` (or **Ctrl+Shift+B** to run the included
   **Start Cyber Intelligence Lab** task after installing dependencies).
2. Click **Go Live**. The workspace settings forward Live Server on
   **http://127.0.0.1:5500/** to Vite on **http://127.0.0.1:5173/**, including
   JavaScript, styles, fonts and `/api/live-intel`.
3. If Live Server was already running when these settings changed, click
   **Port: 5500** to stop it, then **Go Live** again. Refresh the browser tab.

Both servers must stay running when using port 5500. For the simplest preview,
use `start.bat` or open port 5173 directly; Live Server is not required.
Vite uses a fixed port and reports an error instead of silently switching to a
different port. Stop a duplicate preview before starting another.

### If the interface cannot open

A lightweight startup screen appears before React loads. If the application
module fails, or startup takes longer than eight seconds, it offers **Reload lab**
instead of leaving an empty page. A slow load can still finish normally; the
screen does not reload automatically. On local Go Live port 5500 only, **Open Vite
preview** offers the direct port 5173 alternative. Keep `npm run dev` running.

A React render failure has a separate recovery screen with an explicit reload
action; reloading resets the current demo session. These safeguards cannot fix
every failure: if the server or proxy cannot deliver the HTML at all, the browser
shows its own connection error. They do not replace a working server or correct
application code, and do not intercept every asynchronous or event-handler error.

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

The server requests only fixed CISA, Microsoft MSRC and Hacker News URLs over HTTPS with normal certificate validation and no redirects. A shared 60-second cache and in-flight request deduplication reduce upstream traffic. Requests have time and response-size limits. Each source retains its last successful results when refreshes fail; the response and UI label degraded data rather than presenting it as fresh.

These public endpoints require no account or API key. HTTPS establishes the source connection; record validation checks structure, dates, IDs and canonical links. Neither independently proves every claim. Official publisher records are distinct from community posts, and none implies a detected attack on your systems. The interface's **How sources are validated** disclosure links directly to the source feeds.

The client validates responses, prevents overlapping refreshes, and retries failures. It pauses checks while hidden or offline and checks again on return. Last checked, snapshot generation time and the next-check countdown distinguish browser activity from upstream publication dates. **Refresh sources** checks the server cache; it does not bypass upstream rate protection. Search the current snapshot or expand each feed beyond its latest five records. See [live-data freshness and limitations](docs/live-data.md) and the [API contract](docs/api.md).

## Project layout

```text
src/                  React dashboard, polling hook, client validation
shared/               API types
server/               Public-source transport, parsing, cache, HTTP middleware
runtime/              Production static and API server
tests/                Unit, integration, and browser regressions
docs/                 Deployment, testing, and architecture notes
```

The dark analyst workspace uses labelled severity colours, keyboard-operable controls and self-hosted OFL-licensed fonts; source links and acknowledgements are in [public/fonts/SOURCES.md](public/fonts/SOURCES.md). Generated art-direction references live in [docs/design-reference](docs/design-reference), outside the production asset directory.

The public feeds use a static connection strip and aligned source panels. Expanded
snapshots scroll within each feed on larger screens and stack naturally on mobile.
The hero's **Motion on/off** control manages the decorative scanner and fades;
device reduced-motion settings always take priority. See the [interface design
notes](docs/interface-design.md) for inspiration, interaction details and limits.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) for focused changes and review checks, and [SECURITY.md](SECURITY.md) for reporting a vulnerability. Do not include credentials, private incident data, or real targets in demo fixtures.

### Investigating demo incidents

Select a queue or Latest demo activity row to open evidence and response side by side. Close investigation (or Escape) returns to your previous position. Reviewing pauses replay; Resume simulation continues it. New scenario set, Reset demo or reload creates fresh, internally consistent teaching scenarios. Public intelligence feeds remain separate and unchanged.
