# Contributing

## Before making a change

1. Use Node.js 24+ and install the locked dependencies with `npm ci`.
2. Describe the bug or improvement and how to verify it.
3. Keep each commit focused on a real change. Avoid generated churn, unrelated reformatting, and empty commits.

## Checks

Run `npm run check` and `npm run test:e2e` before opening a pull request. Install Chromium once with `npx playwright install chromium`. Add regression coverage for changed behavior; see [testing](docs/testing.md).

For visible changes, inspect desktop and narrow mobile views, keyboard focus, reduced-motion behavior, contrast, and error states. Keep the current visual direction unless the change specifically calls for a redesign.

## After every product update

- Follow the current README startup instructions. Start `npm run dev` or
  `start.bat`, then run `npm run verify:local` in another terminal.
- Open the development address printed by the README's launch command in a browser and confirm the dashboard renders,
  not just an HTTP success response. Verify fonts and the live-intelligence API.
- For startup or Go Live changes, restart Live Server to load workspace settings,
  run `npm run verify:local -- --go-live`, and check both stopped-server guidance
  and successful handoff to the running app.
- Keep README commands, clickable URLs, prerequisites, and troubleshooting in
  sync with the implementation. Update its dated launch-verification record with
  what actually passed and any untested or failed paths. A local link cannot
  start a stopped server; do not promise it will work without one.

## Boundaries

- Keep simulated incidents clearly separate from real public-source records.
- Keep imported user evidence separate from both. Parse locally, validate
  atomically, bound input size/count, treat all fields as untrusted text, and
  never send records to feeds or a model. Redacted exports must use an allowlist.
- Keep real endpoint collection explicit and read-only. Opening a page must not
  start it. Preserve same-origin loopback guards, no-CORS/no-store responses,
  fixed helper arguments, time/byte/count limits and Stop/shutdown cleanup.
  Use synthetic provider and PowerShell mocks in automated tests, never genuine
  private Windows logs. Actual local collection needs authorization and must
  not publish source records or personal screenshots.
- Changes to `shared/endpoint.ts` require matching collector, monitor, strict
  client validation and tests. Keep Defender findings distinct from candidate
  rules; missing coverage and failed reads must not become a clean-PC result.
- Run the optional offline CLI tests with Python 3.12+ after changing
  `tools/loglab`. Keep its event/rule semantics consistent with browser rules.
- Use reserved documentation IP addresses and `.example` domains for fixtures.
- Never commit API keys, local `.env` files, private incident details, or session notes.
- Do not add arbitrary-URL fetching or active scanning to the public-source endpoint.
- Keep provider calls bounded and preserve source attribution and honest stale/error labels.
- Changes to `shared/live-intel.ts` need matching server, client validation, and tests.

Use a concise commit subject such as `fix: retain source records during refresh failures`. Explain non-obvious tradeoffs in the body or associated pull request.
