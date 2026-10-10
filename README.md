# Cyber Intelligence Lab

A local-first security analyst workspace built with React, TypeScript, and Vite. Monitor real Microsoft Defender detections and available Windows security logs on your own PC, investigate authorized exports, and review the evidence before responding. No paid AI API or tokens are required.

## What is real, and what is simulated?

- **Public intelligence:** CISA Known Exploited Vulnerabilities records and Microsoft MSRC updates, plus separately labelled, unverified Hacker News community context. Source health and stale records are visible.
- **Own-PC monitoring:** after explicit consent and Start, a read-only Windows collector checks real Defender status and recent detection/action records, plus accessible Security logon events and optional existing Sysmon process events. Findings distinguish Defender-reported detections from deterministic rule matches. Missing permissions, stale data and query limits remain visible.
- **Local evidence:** import JSON, NDJSON, CSV or Windows event XML in the browser, normalize supported records, review rule-linked timelines and export redacted reports. User-provided exports are not independently authenticated. The optional Python/SQLite tool saves a private local investigation.
- **Simulated operations:** randomized synthetic incidents, an illustrative map, and an opt-in replay. Activity and queue rows open the corresponding investigation.
- **Incident investigation:** linked risk scores, timelines, indicators, response checklists, and forensic artifacts. Copy a clearly labelled exercise brief.

Opening the page does not start collection. The monitor runs only after Start, while this app's local server runs on the Windows PC being monitored. It invokes one fixed read-only PowerShell helper; it cannot accept arbitrary commands, scan, quarantine, delete files, change settings or inspect visitors to a public website. No AI model or containment service is connected. Rule matches are candidates for review, not proof of compromise. Public advisories are not evidence of an attack on your systems.

For investigation, start with actual local records or an authorized export—not public advisories alone.
See [endpoint monitoring](guides/endpoint-monitor.md) for collection, permissions,
notifications, privacy and coverage limits.
See the [local log workflow](guides/log-investigation.md) for supported formats,
Windows export instructions, private SQLite storage and read-only SQL queries.
The [real-incident boundaries](guides/real-incident-workflow.md) explain optional
future integrations and attribution limits. A VPN exit address is an observed
connection address, not proof of a person's identity or original IP.

## Choose a workspace

The app has five focused views instead of one long dashboard:

- **Overview** (`#overview`): choose the task you want to do.
- **PC** (`#endpoint`): real, opt-in monitoring of the local Windows computer.
- **Logs** (`#investigation`): import, analyze and report on an authorized export.
- **Live intel** (`#live-intel`): public advisories and separately labelled community context.
- **Training** (`#operations`): synthetic incidents, replay, evidence and response practice.

Only the selected workspace is visible. Browser Back/Forward and bookmarks work;
older section fragments, including `#response`, still open the relevant view.
The redundant static Cases section has been removed; an old `#cases` bookmark
opens the interactive Training workspace instead.
The local server must remain running—these fragments do not start or publish it.

Switching workspaces keeps this tab's imported investigation and visited views
in memory. It does not upload or save private records. Reload or **Clear local dataset**
discards imported records. Leaving Training pauses its replay. Leaving PC does
**not** stop an explicitly started collector; return to PC and choose **Stop and
clear monitoring**, or stop the local server. Notification settings remain
tab-only, and the usual open-tab delivery limitations still apply.

## Monitor your Windows PC

1. Start the app below on the Windows PC you own or are authorized to monitor.
   Use the existing Windows PowerShell and Microsoft Defender installation;
   readable, enabled event channels are needed for their respective coverage.
2. Choose **Monitor this PC** (or **PC** in navigation), read the notice and tick
   the authorization checkbox. Choose **Start monitoring this PC**.
3. Check the protection status, last successful check and source coverage. The
   collector checks every **30 seconds** after the previous check finishes.
   Security-log permissions vary; optional Sysmon must already be installed.
   Nothing requests elevation, installs a service or changes audit settings.
4. Select a finding for its chronological evidence, explanation, possible benign
   alternatives and next steps. Defender reports its own detections; the app's
   three transparent rules flag supported log patterns for review.
5. Resolve genuine Defender findings through **Windows Security → Virus & threat
   protection → Protection history**, following the recorded recommendation and
   your organization's policy. The app offers guidance, not automatic cleanup.
   A recorded action or your manual review does not prove a threat is resolved.
6. Optionally enable generic tab notifications. Keep the tab open for them;
   notifications are not an always-on Windows alert service.
7. Choose **Stop and clear monitoring** when finished. Closing the browser alone
   does **not** stop collection. Stopping this project's server with **Ctrl+C**
   also stops it. No background service is installed.

Each check queries the latest **15 minutes**, not all historical or currently
active threats. In-memory history is capped at **one hour**, **2,000 supported
events**, **200 Defender events**, **200 findings** and **2 MiB** of retained record
data. Query truncation and unreadable sources create gaps. Zero findings does
**not** prove a clean PC. This single-device analyst tool complements antivirus;
it is not an enterprise EDR, a fleet service or a new antivirus engine.

Private records stay in the local server and browser memory; they are not sent
to GitHub, public feeds or an AI provider. Stop clears the server history, not
the original Windows logs. Defender's own cloud settings are independent of
this app. A remotely hosted copy cannot access your PC without a local companion.

## Investigate an exported log

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
compile `app/main.tsx` or provide the live intelligence API; serving the project
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

If the previous interface remains after updating the source, reload the browser
tab. If it still looks outdated, stop this project's preview in its own terminal
with **Ctrl+C**, run `npm run dev` again, and reopen the printed address.

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
It serves `dist/`, provides `/api/live-intel`, and enables guarded `/api/endpoint/*` routes only for a local Windows instance. A deliberate non-loopback bind disables PC collection. See [deployment](guides/deployment.md) for environment settings and hosting requirements. Uploading `dist/` alone to a static host will not provide either backend. `npm run preview` is only a local build preview.

## Verify changes

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` runs lint, strict type checking, unit/integration tests, and a production build. Browser checks use mocked public-source and endpoint responses at desktop and mobile sizes; they neither depend on external services nor collect the test machine's private logs. See the [testing guide](guides/testing.md) for individual commands, collector mocks and local Edge support.

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

**Latest launch verification — 2026-10-10 (interaction audit and clearer folders):**

- **Passed:** documented `npm run dev` restarted this checkout after the folder
  moves; `npm run verify:local` passed. Edge rendered all five views at
  1440/390/320px with no page errors or page-wide overflow. All three public
  sources were healthy when checked. No real collector was started.
- **Passed:** `npm run check` with lint, strict types, coverage-gated
  **362 unit/integration checks** and a production build; **418 production
  desktop/mobile browser checks**; and **49 Python/SQLite checks** with existing
  Python 3.12.13. The browser suite was rerun after the folder moves.
- **Inspected:** before/after desktop/mobile, errors and the Training dialog.
  Audited launchers, navigation/history, filters, paging, reviews, imports,
  downloads, replay, keyboard controls, clipboard and mocked PC recovery and
  notification branches. Fixed two response links that intercepted modified
  clicks. Ordinary click/Enter still opens the selected investigation.
- **Links:** 31 current public destinations returned HTTP 200 in browser checks;
  30 showed the expected content. Microsoft's `2024-May` release page instead
  showed “Mariner Release Notes”, unlike its updates feed. This publisher-side
  mismatch remains unresolved; upstream availability and content can change.
  Browser tests separately check exact URLs and isolated new tabs.
- **Folders:** moved `src`, `server`, `runtime`, `shared` and `docs` to the clearer
  names explained below. Updated imports, scripts, coverage paths, documentation
  links and isolated-deployment fixtures; dependency versions are unchanged.
- **Not verified:** genuine Windows collection/detection, Sysmon, native OS
  notification delivery, interactive file chooser/`start.bat`, extension restart
  or VS Code task approval. Live Server was not running on port 5500, so its
  actual stopped-server guidance and handoff were not retested. Its settings and
  startup page were unchanged; routed checks are not an extension test.
  No public deployment was made. Hosted checks are recorded in GitHub Actions.

**Previous launch verification — 2026-10-09 (Cases removal and footer cleanup):**

- **Passed:** documented `npm run dev` reused this checkout. When its preview
  retained an outdated module, stopping only this project's terminal and running
  the same command restarted port 5173 with the updated interface.
  `npm run verify:local` and `npm run verify:local -- --go-live` passed.
- **Passed:** Edge rendered all five views at desktop and 390/320px mobile
  sizes without page errors or page-wide overflow. The actual Live Server page
  on port 5500 showed stopped-server guidance at 1440/390px, then handed off to
  the running app; an old `#cases` bookmark correctly opened Training.
  All three public sources were healthy when checked.
- **Passed:** `npm run check` with **359 unit/integration checks**, lint, strict
  types, coverage gates and a production build; **384 production desktop/mobile
  browser checks**; and **49 Python/SQLite checks** with existing Python 3.12.13.
  Endpoint browser fixtures are mocked and never read real PC logs.
- **Inspected:** before/after desktop/mobile, error and doubled-text screenshots.
  Removed static Cases content and its invented metrics, simplified Overview,
  aligned the compact footer, and fixed enlarged Training status/detail labels.
  Imported-state retention, opt-in monitoring boundaries, history, focus and
  quiet current-view return links passed their regressions.
- **Not retested:** genuine Windows collection, Sysmon, native notifications,
  interactive `start.bat`, extension restart, VS Code task approval or native
  Linux/macOS desktop operation. Actual collection stayed off. No backend,
  dependency, startup, port or workspace-setting implementation changed, and
  no public app deployment was made. Hosted checks are recorded in GitHub Actions.

**Previous focused workspace navigation verification — 2026-10-09:**

- **Passed:** documented `npm run dev` reused this checkout on port 5173.
  `npm run verify:local` and `npm run verify:local -- --go-live` passed.
  Edge rendered all six views at 1853/1440px and 390/320px without page errors
  or page-wide overflow. All three public sources were healthy when checked.
  The actual Live Server page on port 5500 handed off to the running React app
  and retained the Logs bookmark fragment.
- **Passed:** `npm run check` with **358 unit/integration checks**, lint, strict
  types, coverage gates and a production build; **382 production desktop/mobile
  browser checks**; and **49 Python/SQLite checks** with existing Python 3.12.13.
  Browser fixtures mock endpoint requests and never collect real PC logs.
- **Inspected:** saved before/after desktop/mobile, error and doubled-text
  screenshots. Unified the mismatched page frames, removed repeated introductions,
  and fixed enlarged-text map collisions and split priority labels. History,
  deep links, keyboard focus, retained imported records and Training pause
  were checked; navigation neither starts nor stops monitoring.
- **Not retested:** genuine Windows collection, native notifications,
  stopped-server Go Live guidance, extension restart, interactive `start.bat`,
  VS Code task approval or native Linux/macOS desktop operation. No startup,
  port, dependency or workspace-setting changes were made in this UI update.
  The collector remained stopped during actual browser checks. No public app
  deployment was made; hosted checks are recorded separately in GitHub Actions.

**Previous real endpoint monitoring release verification — 2026-10-09:**

- **Passed:** documented `npm run dev` reused this checkout correctly. After
  stopping only the verified project-owned launcher for the stopped-server test,
  the same command restarted port 5173. `npm run verify:local` and
  `npm run verify:local -- --go-live` passed; all three public sources were
  healthy at the check, not an availability guarantee.
- **Actual Windows check:** the browser explicitly started the collector,
  retrieved real Defender status, observed another successful automatic poll,
  and stopped/cleared the retained history. The current process could not read
  the Security log; that gap was displayed accurately. No malware was planted
  and no real threat-trigger or remediation test was performed. Zero returned
  findings is not a clean-PC guarantee. Real records and screenshots were not
  published.
- **Passed:** `npm run check` (352 unit/integration tests, strict lint/types,
  coverage gates and build), 348 desktop/mobile production-path Edge browser
  checks, and 49 Python/SQLite checks. Browser tests mock private collection;
  PowerShell helper tests use synthetic cmdlets. Full and production-only npm
  audits reported zero vulnerabilities. No dependency was added or changed.
- **Actual Go Live:** the installed extension served its independent startup
  page. With Vite stopped, instructions rendered; after documented startup, the
  same page handed off to the real React app with its section link preserved.
  Saved desktop/mobile captures at 1440, 390 and 320px showed no page errors or
  document overflow. No substitute server or routed fixture was used for this
  check. Extension restart was not retested; its settings were not changed.
- **Inspected:** before/after hero and endpoint controls, coverage gaps,
  Defender/candidate evidence, private disclosures, failed connection, response
  guidance and doubled-text views. Layout, typography, colour, materials,
  writing and keyboard/accessibility checks found no blocking issue in these
  tested views; this is not an accessibility certification.
- **Not exercised:** genuine malware detection, native OS notification delivery,
  elevated Security-log access, Sysmon installation, native Linux/macOS desktop
  operation, interactive `start.bat` or VS Code automatic-task approval.
  No scan, containment, Windows service, paid AI integration or public hosting
  was added. Hosted results are recorded separately in GitHub Actions.

**Previous local log investigation release verification — 2026-10-09:**

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

The client validates responses, prevents overlapping refreshes, and retries failures. It pauses checks while hidden or offline and checks again on return. Last checked, snapshot generation time and the next-check countdown distinguish browser activity from upstream publication dates. **Refresh sources** checks the server cache; it does not bypass upstream rate protection. Search the current snapshot or expand each feed beyond its latest five records. See [live-data freshness and limitations](guides/live-data.md) and the [API contract](guides/api.md).

## Project layout

- **`app`** (formerly `src`): the website's pages, buttons, styling and browser-side analysis.
- **`backend`** (formerly `server`): public feeds, the read-only PC collector and API security checks.
- **`app-server`** (formerly `runtime`): serves the built website and its APIs when you run `npm start`.
- **`shared-types`** (formerly `shared`): the data formats agreed between the website and backend.
- **`guides`** (formerly `docs`): instructions for monitoring, investigation, testing and deployment.
- **`scripts`**: project launchers, verification commands and fixed Windows helpers.
- **`tools/loglab`**: the optional offline Python/SQLite investigation tool.
- **`preview`**: the small Go Live connection/startup page, not the full app.
- **`public`**: files served directly, such as fonts and icons.
- **`tests`**: automated checks for the website and backend.

The standard filenames stay unchanged so their tools can find them:
`package.json` lists npm commands and dependencies; `package-lock.json` locks
dependency versions; `index.html` is the web entry page; `vite.config.ts` configures
the development/build tool; `tsconfig*.json` configures TypeScript; and
`playwright.config.ts` configures browser tests. `start.bat` remains the Windows
launcher. `README.md`, `CONTRIBUTING.md` and `SECURITY.md` are the usual project,
contribution and security documents.

`node_modules`, `dist`, `playwright-report` and `test-results` are generated by
installation, builds or tests; they are not where you edit the website.
`.github` contains GitHub automation and `.vscode` contains editor settings.
The local, uncommitted `memory.md` is continuity notes, not product data.
The workspace folder itself remains `First_Project`; changing its location
would disrupt an open editor or running terminal.

The dark analyst workspace uses labelled severity colours, keyboard-operable controls and self-hosted OFL-licensed fonts; source links and acknowledgements are in [public/fonts/SOURCES.md](public/fonts/SOURCES.md). Generated art-direction references live in [guides/design-reference](guides/design-reference), outside the production asset directory.

The public feeds share one active source panel, with CISA, Microsoft and Community
tabs. CISA opens by default; community reports stay separately labelled and hidden
until selected. Search covers the whole snapshot and each tab shows its matching
count. Source status, timing and validation details are available on demand.
Expanded records scroll within the active panel on larger screens and use natural
page scrolling on mobile. The former learning/skills section has been removed;
static case studies and their invented outcome metrics have also been removed.
Each workspace ends with a concise scope note. Short views keep this footer at
the bottom of the window; longer views use normal page flow. **Back to top** is a
quiet text link on the tool views, not a primary action on Overview.
Training's **Motion on/off** control manages the decorative scanner and fades;
device reduced-motion settings always take priority. See the [interface design
notes](guides/interface-design.md) for inspiration, interaction details and limits.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) for focused changes and review checks, and [SECURITY.md](SECURITY.md) for reporting a vulnerability. Do not include credentials, private incident data, or real targets in demo fixtures.

### Investigating demo incidents

Select a queue or Latest demo activity row to open evidence and response side by side. Close investigation (or Escape) returns to your previous position. Reviewing pauses replay; Resume simulation continues it. New scenario set, Reset demo or reload creates fresh, internally consistent teaching scenarios. Public intelligence feeds remain separate and unchanged.

The **PC** navigation item opens real own-PC monitoring; **Logs** or **Investigate
local logs** opens the separate export-based view. The latter's sample
records, imported events, analyst review and reports never change the simulation
queue or public-source snapshot. Three fixed rules do not replace a SIEM/EDR or
establish that an unmatched system is safe.
