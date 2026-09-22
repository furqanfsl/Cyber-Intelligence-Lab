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

Mocked tests do not prove upstream availability. For a live smoke check, start the app and inspect `/api/live-intel` plus the source-health panel. Do not turn external-service availability into a flaky CI requirement.

Failure screenshots and traces are written to `test-results/`. CI retains failed browser artifacts for seven days. These generated files are ignored by Git.
