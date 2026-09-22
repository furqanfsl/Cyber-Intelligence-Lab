# Contributing

## Before making a change

1. Use Node.js 24+ and install the locked dependencies with `npm ci`.
2. Describe the bug or improvement and how to verify it.
3. Keep each commit focused on a real change. Avoid generated churn, unrelated reformatting, and empty commits.

## Checks

Run `npm run check` and `npm run test:e2e` before opening a pull request. Install Chromium once with `npx playwright install chromium`. Add regression coverage for changed behavior; see [testing](docs/testing.md).

For visible changes, inspect desktop and narrow mobile views, keyboard focus, reduced-motion behavior, contrast, and error states. Keep the current visual direction unless the change specifically calls for a redesign.

## Boundaries

- Keep simulated incidents clearly separate from real public-source records.
- Use reserved documentation IP addresses and `.example` domains for fixtures.
- Never commit API keys, local `.env` files, private incident details, or session notes.
- Do not add arbitrary-URL fetching or active scanning to the public-source endpoint.
- Keep provider calls bounded and preserve source attribution and honest stale/error labels.
- Changes to `shared/live-intel.ts` need matching server, client validation, and tests.

Use a concise commit subject such as `fix: retain source records during refresh failures`. Explain non-obvious tradeoffs in the body or associated pull request.
