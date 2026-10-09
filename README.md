# Cyber Intelligence Lab

A defensive security lab built with React, TypeScript, and Vite. Investigate authorized log exports, browse public security advisories and practise with clearly labelled simulated incidents. Core log analysis uses deterministic rules, not a paid AI API.

## What is real, and what is simulated?

- **Public intelligence:** CISA Known Exploited Vulnerabilities records and Microsoft MSRC updates, plus separately labelled, unverified Hacker News community context. Source health and stale records are visible.
- **Local evidence:** import JSON, NDJSON, CSV or Windows event XML in the browser, normalize supported records, review rule-linked timelines and export redacted reports. User-provided exports are not independently authenticated. The optional Python/SQLite tool saves a private local investigation.
- **Simulated operations:** randomized synthetic incidents, an illustrative map, and an opt-in replay. Activity and queue rows open the corresponding investigation.
- **Incident investigation:** linked risk scores, timelines, indicators, response checklists, and forensic artifacts. Copy a clearly labelled exercise brief.
- **Case studies:** practice scenarios and example outcomes, not records of real security operations.

The app does not automatically collect device logs, scan systems, monitor private traffic, confirm attacks or execute commands. No AI model or containment service is connected. Rule matches are candidates for review, not proof of compromise. Public advisories are not evidence of an attack on your systems; check the original sources before acting on them.

For investigation, start with an authorized export—not public advisories alone.
See the [local log workflow](docs/log-investigation.md) for supported formats,
Windows export instructions, private SQLite storage and read-only SQL queries.
The [real-incident boundaries](docs/real-incident-workflow.md) explain optional
future integrations and attribution limits. A VPN exit address is an observed
connection address, not proof of a person's identity or original IP.

## Try a local investigation

1. Start the app using the instructions below and choose **Investigate local logs**.
2. Choose **Load suspicious sample** to review three deterministic candidate
   findings, then compare with **Load benign sample**. Both datasets are synthetic.
3. Import an authorized export with **Import log file**. Supported records are
   Windows Security `4624`/`4625` and Sysmon `1`/`3`; Sysmon `3` is context only.
   Binary `.evtx` is not supported. Imports are limited to **5 MiB / 10,000 records**.
4. Select a finding to inspect its chronological evidence, rule explanation,
   benign alternatives and suggested checks. Record your own review disposition.
5. Export **redacted Markdown or JSON**. Host, account and address values become
   aliases; filenames, source IDs, process paths and command lines are omitted.
   Timestamps remain. Review the result before sharing—it is pseudonymized, not
   guaranteed anonymous.

The browser never uploads imported records or saves them to browser storage.
Clear the dataset or reload to discard the view; original files and downloaded
reports remain on your computer. Public feeds still make their separate fixed
requests. No paid LLM API, account, API key or AI tokens are required.

For persistence, use the optional **Python 3.12+ standard-library CLI** under
`tools/loglab`. It normalizes JSON/NDJSON/CSV into a local SQLite database and
retains import provenance, analysis runs and supporting evidence. This database
contains sensitive values, even when a report is redacted. It is separate from
the website’s tab-memory dataset. No Python installation is needed for the website.

## Run locally

Use **Node.js 24 or later** and npm. The runtime and unit tests use Node's native TypeScript support.

For a new checkout:

```sh
git clone https://github.com/furqanfsl/Cyber-Intelligence-Lab.git
cd Cyber-Intelligence-Lab
```

Run the following commands from that project folder. The launcher installs the
locked dependencies when needed; only reuse a preview from the same checkout.

**On Windows, double-click `start.bat` in the project folder.** It installs missing or
changed locked dependencies, starts the development server, and opens the browser.
Keep its window open while using the app. If this project's preview is already
running, the launcher opens it instead of starting a duplicate server.

Alternatively, run this from the project folder and keep the terminal open:

```sh
npm run dev
```

Open the local address printed in the terminal in your browser.
The command uses the same dependency checks as `start.bat`; the first run needs
internet access to install packages.

This runs the app on your own computer, not a public demo. Keep the server
running while using it; opening a browser address does not start the process.

### VS Code: Go Live

This is a React/TypeScript app, not a static HTML page. Live Server alone cannot
compile `src/main.tsx` or provide the live intelligence API; serving the project
folder directly cannot start the app correctly.

1. Open this project folder in VS Code and trust it if you trust its contents.
   Run **Tasks: Manage Automatic Tasks** from the Command Palette and allow
   automatic tasks for this folder. Reopen the folder to start the included
   **Start Cyber Intelligence Lab** task automatically. You only need to allow
   this once. Alternatively, press **Ctrl+Shift+B**, run `npm run dev`, or use
   `start.bat` whenever you want to start the app.
2. Click **Go Live**. Its startup page (port `5500`) checks for the lab preview
   on port `5173`, then opens it. Start the preview from this project folder.
   If the server is stopped, it shows start instructions instead of a raw
   `ECONNREFUSED` error. Start the app, then choose **Retry connection** if needed.
3. **After updating from the old proxy settings:** click **Port: 5500** to stop
   Live Server, then click **Go Live** again so it reads the new settings.

Go Live serves a small startup page; it does not compile or launch the app by
itself. Port 5500 is available only while the Live Server extension is running.
Once the app opens on port 5173, only the development server needs to stay running.
For the simplest preview, use `start.bat`; Live Server is optional.

### If the interface cannot open

If the browser reports that it cannot connect to port 5173, start `start.bat` or
`npm run dev` and wait for the ready message. If port 5173 is occupied by an
unrelated app, stop that app or free the port and try again. The launcher does not
silently switch ports or stop other processes.

The launcher checks an opaque workspace marker before reusing a preview. An old
server or another checkout of the lab on port 5173 must be stopped in its own
terminal before starting this project. If locked dependencies changed while the
preview was running, stop it with **Ctrl+C** and run the launcher again.

If setup was interrupted and the launcher reports a **startup lock**, close this
project's startup terminals first. Remove only the exact temporary lock file
named in that message, then retry. The launcher does not automatically delete a
potentially active lock or run two dependency installations at once.

A lightweight startup screen appears before React loads. If the application
module fails, or startup takes longer than eight seconds, it offers **Reload lab**
instead of leaving an empty page. A slow load can still finish normally; the
screen does not reload automatically. Keep the development server running.

A React render failure has a separate recovery screen with an explicit reload
action; reloading resets the current demo session. These safeguards cannot fix
every failure: if the server cannot deliver the HTML at all, the browser
shows its own connection error. They do not replace a working server or correct
application code, and do not intercept every asynchronous or event-handler error.

## Build and run

```sh
npm run build
npm start
```

After the server starts, open the local address printed in the terminal (default
port `3000`). This command does not publish the app.
It serves `dist/` and provides `/api/live-intel`. See [deployment](docs/deployment.md) for environment settings and hosting requirements. Uploading `dist/` alone to a static host will not provide the API. `npm run preview` is only a local build preview.

## Verify changes

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` runs lint, strict type checking, unit/integration tests, and a production build. Browser checks run at desktop and mobile sizes with mocked public-source responses; they do not depend on external services. See the [testing guide](docs/testing.md) for individual commands and local Edge support.

### Keep the launch instructions working

After **every product update**, start the app using the instructions above, run
the local smoke check in a second terminal, and open the development address
printed in the terminal in a browser:

```sh
npm run verify:local
```

When checking Go Live, start the Live Server extension too, then run:

```sh
npm run verify:local -- --go-live
```

The smoke check tests the running development page, transformed entry module,
fonts, and API; `--go-live` also checks the startup page. It does not start either
server or replace the browser tests. Check Go Live both with Vite stopped
(instructions appear) and running (the app opens). Keep the URLs and commands in
this README aligned with the code, and update the dated record below with the
actual results. Do not mark unchecked paths as passing.

**Latest launch verification — 2026-10-09 (local log investigation release):**

- **Passed:** documented `npm run dev` refused to reuse a preview with changed
  locked dependencies. After stopping only this checkout's server, it installed
  the updated lock with `npm ci`, started port 5173 and a second invocation reused
  it without a duplicate process. `npm run verify:local` passed.
  Actual Edge rendered the updated React interface
  at 1440, 390 and 320px without page errors or document overflow. All three
  public sources were healthy at the final check; availability can change.
- **Passed:** `npm run check` (277 unit/integration checks, lint, strict types,
  coverage gates and build), 316 desktop/mobile production-path Edge browser
  checks, and 49 Python/SQLite checks using Python 3.12.13. These include actual
  cross-engine rule comparisons, bounded imports, failure recovery, redacted
  downloads, retained evidence and transactional rollback. The transitive
  development dependency `source-map-js` was patched to 1.2.2; full and
  production-only dependency audits both reported zero vulnerabilities.
  No direct JavaScript dependency was added.
- **Inspected:** saved before/after desktop/mobile screenshots for empty,
  suspicious, benign, process-evidence, file-error, public-feed-error and report
  states, plus doubled-text checks. Fixed narrow navigation clipping/touch
  widths, table readability/scroll guidance and severity-label wrapping.
- **Actual Go Live limitation:** `npm run verify:local -- --go-live` passed its
  development-server checks but failed because port 5500 was not listening.
  The installed Live Server extension could not be started through the available
  editor controls. Its restart, stopped-server entry and running-server handoff
  remain unverified; passing fixture tests are not an actual extension test.
- **Not exercised:** actual private Windows event channels, Sysmon installation,
  native Linux/macOS desktop operation, interactive `start.bat` and VS Code
  automatic-task approval. The exporter was validated with isolated synthetic
  PowerShell mocks, never real log collection. No model, automatic collector or
  public deployment was added. This record covers local verification; hosted
  results are recorded by the repository's GitHub Actions workflow.

**Previous documentation verification — 2026-10-08:**

`npm run dev` and `npm run verify:local` passed. The address printed in the
terminal rendered the dashboard at 1440, 390, and 320px without page errors or
page-wide overflow; all three public sources responded at the time of checking.
The Live Server extension and interactive `start.bat` were not retested. No app
behavior changed in this documentation review, and no public deployment was made.

**Previous full launch verification — 2026-10-05:**

- **Passed:** `npm run dev` installed locked dependencies, started port 5173,
  and a second invocation reused this checkout without starting a duplicate.
  `npm run verify:local` passed. Edge rendered the README's development link at
  1440, 390 and 320px without page errors or horizontal overflow; the live API
  returned 8 CISA, 12 community and 8 Microsoft records, with all sources healthy
  at the final check. Availability can change; one earlier Microsoft refresh was
  correctly labelled stale.
- **Passed:** `npm run check` (242 unit/integration checks, lint, strict types,
  coverage gates and build), plus 240 desktop/mobile browser checks. Inspected
  before/after launcher and dashboard screenshots, including stopped-server
  guidance. Mocked Go Live checks cover handoff, retry and restored-page behavior.
- **Not verified:** the actual Live Server extension was not listening on port
  5500. `npm run verify:local -- --go-live` therefore failed with instructions to
  start/restart the extension; actual stopped-server guidance and handoff still
  need that manual check. Routed browser fixtures are not an extension test.
  Interactive `start.bat` double-click and VS Code automatic-task approval were
  not exercised; their shared Node launcher was tested.

This records a test run, not a guarantee that a local server remains running
after its terminal or computer is closed. No public deployment was performed.

## How live intelligence works

The server requests only fixed CISA, Microsoft MSRC and Hacker News URLs over HTTPS with normal certificate validation and no redirects. A shared 60-second cache and in-flight request deduplication reduce upstream traffic. Requests have time and response-size limits. Each source retains its last successful results when refreshes fail; the response and UI label degraded data rather than presenting it as fresh.

These public endpoints require no account or API key. HTTPS establishes the source connection; record validation checks structure, dates, IDs and canonical links. Neither independently proves every claim. Official publisher records are distinct from community posts, and none implies a detected attack on your systems. The interface's **How sources are validated** disclosure links directly to the source feeds.

The client validates responses, prevents overlapping refreshes, and retries failures. It pauses checks while hidden or offline and checks again on return. Last checked, snapshot generation time and the next-check countdown distinguish browser activity from upstream publication dates. **Refresh sources** checks the server cache; it does not bypass upstream rate protection. Search the current snapshot or expand each feed beyond its latest five records. See [live-data freshness and limitations](docs/live-data.md) and the [API contract](docs/api.md).

## Project layout

```text
src/                  React dashboard, local log rules/reports, polling hook
shared/               API types
server/               Public-source transport, parsing, cache, HTTP middleware
runtime/              Production static and API server
scripts/              Development launcher and local smoke checks
tools/loglab/         Optional offline Python/SQLite investigation CLI and tests
preview/              Dependency-free Go Live startup page
tests/                Unit, integration, and browser regressions
docs/                 Deployment, testing, and architecture notes
```

The dark analyst workspace uses labelled severity colours, keyboard-operable controls and self-hosted OFL-licensed fonts; source links and acknowledgements are in [public/fonts/SOURCES.md](public/fonts/SOURCES.md). Generated art-direction references live in [docs/design-reference](docs/design-reference), outside the production asset directory.

The public feeds share one active source panel, with CISA, Microsoft and Community
tabs. CISA opens by default; community reports stay separately labelled and hidden
until selected. Search covers the whole snapshot and each tab shows its matching
count. Source status, timing and validation details are available on demand.
Expanded records scroll within the active panel on larger screens and use natural
page scrolling on mobile. The former learning/skills section has been removed;
the workspace ends with its case studies and a concise footer.
The hero's **Motion on/off** control manages the decorative scanner and fades;
device reduced-motion settings always take priority. See the [interface design
notes](docs/interface-design.md) for inspiration, interaction details and limits.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) for focused changes and review checks, and [SECURITY.md](SECURITY.md) for reporting a vulnerability. Do not include credentials, private incident data, or real targets in demo fixtures.

### Investigating demo incidents

Select a queue or Latest demo activity row to open evidence and response side by side. Close investigation (or Escape) returns to your previous position. Reviewing pauses replay; Resume simulation continues it. New scenario set, Reset demo or reload creates fresh, internally consistent teaching scenarios. Public intelligence feeds remain separate and unchanged.

The **Logs** navigation item opens a separate local-evidence workflow. Its sample
records, imported events, analyst review and reports never change the simulation
queue or public-source snapshot. Three fixed rules do not replace a SIEM/EDR or
establish that an unmatched system is safe.
