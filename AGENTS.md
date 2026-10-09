# Project instructions

## Continuity

- Read `memory.md` at the start of a session; create it if absent. Keep local
  session notes there and update it after changes. Do not commit session notes.
- Preserve the existing dashboard and real-feed/simulation boundaries unless the
  user requests changes. See README and CONTRIBUTING for project conventions.

## Launch verification after every product update

- Treat working local startup and accurate README instructions as part of the
  change, not optional follow-up work.
- Start the app using a documented path (`npm run dev` or `start.bat`), run
  `npm run verify:local`, and open the README's development link in a browser.
  An HTTP response alone does not prove React rendered successfully.
- For startup, port, dependency, VS Code, or Go Live changes, also verify the
  stopped-server entry page and successful running-server handoff. Restart Live
  Server after workspace setting changes and run
  `npm run verify:local -- --go-live` while the extension is running.
- Keep README commands, clickable addresses, prerequisites, and troubleshooting
  synchronized with the implementation. Update its dated launch-verification
  record after every product update with actual results and any limitations.
  Never claim a check passed without running it.
- Explain that localhost links require a running server; do not imply that a
  README link launches a process or is a public deployment. Do not silently
  change ports, kill unrelated processes, or publish without authorization.
- Run the relevant automated regression checks. For visible changes, save and
  inspect before/after desktop and mobile screenshots, including error states,
  and review layout, typography, color, materials, writing, and accessibility.
