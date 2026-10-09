# Testing

## Commands

| Command | Purpose |
| --- | --- |
| `npm run lint` | React, TypeScript, and correctness lint rules |
| `npm run typecheck` | Strict checking of application, server, runtime, and test code |
| `npm test` | Node test-runner unit and HTTP integration tests |
| `npm run test:coverage` | The same tests with native Node coverage reporting and minimum thresholds |
| `npm run build` | Production type check and Vite bundle |
| `npm run check` | Lint, type checking, coverage-gated tests, and production build |
| `npm run test:e2e` | Playwright desktop and mobile browser checks |
| `npm run verify:local` | Running development page, checkout marker, transformed module, fonts and API contract |
| `npm run verify:local -- --go-live` | The same smoke check plus the actual Live Server startup page and assets on port 5500 |

Tests use Node.js 24+ with native TypeScript stripping. Type stripping does **not** replace type checking; run both `typecheck` and `test`.

## Browser setup

```sh
npx playwright install chromium
npm run test:e2e
```

On Windows, an installed Microsoft Edge can be used instead:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e
```

Playwright builds the app and starts the production server on `127.0.0.1:4175`. It reuses an existing server locally; stop unrelated servers on that port if the tests connect to the wrong application. CI always starts a fresh server.

## Coverage boundaries

`npm run test:coverage` uses Node's built-in coverage support; no coverage package
or external service is required. It prints per-file results and uncovered line
numbers to the terminal. Aggregate minimums are **90% lines, 85% branches, and
85% functions**. A missed threshold exits unsuccessfully, so `npm run check` and
the existing CI workflow enforce the same gate without running unit tests twice.

The initial measured baseline on 22 September 2026, using Node 24.14.0 and 81
passing tests, was **96.01% lines, 94.88% branches, and 92.94% functions**. Treat
that as a dated measurement, not a promise about future runs. The lower gates
leave room for useful changes while flagging meaningful losses of coverage.

The report includes loaded TypeScript modules in `server/`, `runtime/`, and
`src/lib/`. Test bodies are excluded. Native coverage measures code actually
loaded by these tests: an unimported module will not automatically appear as
uncovered. Review new modules and add tests for them explicitly. This is **not a
whole-application coverage percentage**: React components and hooks, CSS, and
browser behavior require the separate browser checks below. Aim for meaningful
failure-path assertions, not an arbitrary 100% score or extra tests that assert
nothing.

See [Node's test coverage documentation](https://nodejs.org/api/test.html#collecting-code-coverage)
for the native runner's limitations.

- Source parsers, transport limits, cache timing, last-known-good retention, and middleware are checked with controlled inputs.
- Production HTTP tests use temporary static files and ephemeral ports.
- Browser tests mock `/api/live-intel` for deterministic success, malformed data, partial failure, and stale-data scenarios.
- Interaction checks cover keyboard tabs, severity filtering, clipboard success/failure, simulation controls, and narrow viewport overflow.
- Scenario checks verify that each incident changes the entire dossier, including all four artifact tabs, rather than only the title.
- Connectivity checks cover offline retention, one reconnect request, advancing last-check timestamps with cached snapshots, countdowns and automatically updated source records.
- Feed tools cover snapshot search, no-match recovery, expanded records, self-hosted fonts, active navigation and coherent simulation totals.

Mocked tests do not prove upstream availability. For a live smoke check, start the app and inspect `/api/live-intel` plus the source-health panel. Do not turn external-service availability into a flaky CI requirement.

Start `npm run dev` before `verify:local`; the verifier does not launch servers or
prove React rendered. Open the development address printed by the launcher in a
browser too. For `--go-live`, restart the VS Code Live Server extension after
settings changes. Check its entry page with Vite stopped, then start Vite and
confirm the browser opens the dashboard. A substitute static server or routed
browser fixture does not verify the actual extension.

## Workspace navigation

Navigation checks cover one visible workspace, direct and legacy fragments,
browser Back/Forward, reload, unknown destinations, current-page labels and
focus. Visited hidden views must be inert, retain tab-memory investigations,
and never trigger Start/Stop collection. Leaving Training must pause replay
and close a practice dialog without focusing its hidden opener. UI fixtures
use synthetic imported records and mocked endpoint responses, not real PC logs.

Visual review compares consistent heading/content/footer gutters, desktop and
320/390px mobile navigation, error states and doubled text. Hidden component
CSS must not override the wrapper's `hidden` state or extend page height.

## Own-PC collector tests

`tests/server/endpoint-provider.test.ts` checks the fixed executable/script,
allowlisted arguments, cancellation/deadlines, UTF-8 and response limits,
strict normalization and source-count consistency. The PowerShell tests inject
synthetic `Get-MpComputerStatus` and `Get-WinEvent` functions; they never query
the machine's private logs. Monitor tests use a clock and mocked provider for
polling, source failures, deduplication, Defender action correlation, candidate
rules, bounded retention and Stop/shutdown clearing.

Private HTTP tests cover exact loopback Host/port, same-origin controls, session
tokens, no CORS, methods, malformed/duplicate JSON, body limits, total request
deadlines, disabled public binding and integration before public-route guards.
`tests/e2e/endpoint-monitor.spec.ts` mocks both public intelligence and private
endpoint responses. It checks consent-only Start, source gaps, stale/error
recovery, escaped private details, manual review and generic notification
behavior at desktop/mobile sizes. It does not request genuine OS notification
permission or prove detection of malware on the test computer.

For an **authorized actual Windows smoke test**, use the documented local
launcher and browser. Start explicitly, inspect last successful check and
coverage, wait for the next collector timestamp, then Stop and confirm the
private view cleared. Report denied/missing sources accurately. Do not plant
malware, change security settings, install sensors, elevate or publish personal
logs as part of routine testing. A successful collector read does not prove
that every threat would be detected. See [monitoring limits](endpoint-monitor.md).

## Local log investigation

`tests/client/log-analysis.test.mjs` exercises bounded atomic JSON/NDJSON/CSV
parsing, deduplication, timestamps, rule thresholds, exact identity correlation
and benign cases. Native XML parsing is browser-only and is exercised by
`tests/e2e/log-investigation.spec.ts`, including malformed XML and DTD rejection.
Redaction tests verify allowlisted outputs omit arbitrary source identifiers,
paths, commands, free text and filenames while retaining evidence references.

Browser regressions cover imports without network uploads, candidate/evidence
selection, false-positive guidance, search, severity filtering, pagination,
analyst review, actual downloaded reports, explicit synthetic provenance,
clear/reload behavior and narrow-screen layout. Imported files are never genuine
personal logs in automated tests; fixtures are explicitly synthetic.

For the optional Python/SQLite tool, run from the repository root with Python
3.12 or later:

```sh
python -m unittest tools.loglab.test_loglab -v
```

On Windows, `py -3.12` can replace `python` when the Python launcher is installed.
The tests use temporary SQLite databases and include cross-engine comparison
with the TypeScript rules using Node 24+. They do not read Windows event channels,
install Sysmon or change audit settings. The PowerShell exporter is a manual,
authorized action; syntax/fixture validation alone does not prove permission or
availability of a user's actual Security or Sysmon channel.

Launcher tests inject installs and browser opening rather than running `npm ci`
or opening real windows. They cover workspace identity, dependency fingerprints,
bounded HTTP inspection, conflicts, failure paths and lock ownership. The Go
Live suite covers stopped/ready guidance, bounded retry, nonlocal-origin refusal,
no-JavaScript instructions and restored-page lifecycle cancellation. Synthetic
`pagehide`/`pageshow` tests check handler behavior, not a guarantee that every
browser will place the page in its back-forward cache.

Failure screenshots and traces are written to `test-results/`. CI retains failed browser artifacts for seven days. These generated files are ignored by Git.

## Visual and accessibility review

The 22 September 2026 workspace review inspected desktop and mobile renders at
320, 390, 768, 1280 and 1440 pixels. Buttons, severity words, focus states,
readability, clipping, sticky navigation and selected-scenario content were
checked alongside the automated suite (162 unit/integration tests and 104
desktop/mobile browser checks at that review).

A separate temporary axe-core 4.13 scan used WCAG 2 A/AA and 2.1 A/AA rules on
1440px and 390px views, with both ransomware and cloud scenarios selected. It
reported no automated violations; this is not an accessibility certification.
Manual review also checked labels over moving map paths, reduced motion and
forced colours, which automated contrast checks could not fully resolve.
