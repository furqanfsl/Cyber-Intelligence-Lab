## What changed and why?

Describe the behavior being fixed or added and how a reviewer can reproduce it.
Keep unrelated refactors, formatting churn, and change/revert commits out of the PR.

## Verification

List commands run and their results. Explain skipped or failing checks.

- [ ] `npm run check` passes (lint, types, coverage-gated tests, and build).
- [ ] Regression tests cover the changed behavior and relevant failure paths.
- [ ] `npm run test:e2e` passes when browser behavior is affected.

## Visual changes (or “not applicable”)

Attach before/after desktop and mobile screenshots for visible changes. Note
keyboard navigation, focus visibility, overflow, and reduced-motion checks.

## Boundaries and risks

- [ ] Simulated incidents remain clearly distinct from live public-source data.
- [ ] Changes preserve source allowlists, safe links, request limits, and honest
      stale/error states, or explain an intentional contract change.
- [ ] No credentials, private telemetry, generated test artifacts, or unrelated
      local files are included.

Mention deployment/configuration changes, remaining limitations, and any rollback
steps. Mark checks that do not apply and explain why.
