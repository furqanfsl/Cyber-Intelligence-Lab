# Testing

## Commands

| Command | Purpose |
| --- | --- |
| `npm run lint` | React, TypeScript, and correctness lint rules |
| `npm run typecheck` | Strict checking of application, server, runtime, and test code |
| `npm test` | Node test-runner unit and HTTP integration tests |
| `npm run build` | Production type check and Vite bundle |
| `npm run check` | All of the above without browser tests |
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

- Source parsers, transport limits, cache timing, last-known-good retention, and middleware are checked with controlled inputs.
- Production HTTP tests use temporary static files and ephemeral ports.
- Browser tests mock `/api/live-intel` for deterministic success, malformed data, partial failure, and stale-data scenarios.
- Interaction checks cover keyboard tabs, severity filtering, clipboard success/failure, simulation controls, and narrow viewport overflow.

Mocked tests do not prove upstream availability. For a live smoke check, start the app and inspect `/api/live-intel` plus the source-health panel. Do not turn external-service availability into a flaky CI requirement.

Failure screenshots and traces are written to `test-results/`. CI retains failed browser artifacts for seven days. These generated files are ignored by Git.
