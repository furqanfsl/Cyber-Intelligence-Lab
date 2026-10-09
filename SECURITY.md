# Security

This is a single-device defensive analyst application with an opt-in Windows collector and separate practice scenarios, not a production EDR or managed response system. Only the latest `main` branch is maintained.

## Report a vulnerability

Do not put credentials, private data, or working exploits in a public issue. Use the repository's **Security → Report a vulnerability** option if it is available. If it is not, contact the maintainer through their GitHub profile before sharing sensitive details. No response-time guarantee is offered.

Include the affected commit, a minimal reproduction using synthetic data, expected and actual behavior, and the potential impact. Test only your own local instance; do not probe upstream CISA or Hacker News infrastructure on this project's behalf.

## Deployment boundaries

- `/api/live-intel` exposes only fixed public-source records and requires no user credentials. There is no arbitrary-URL proxy or active network scanning.
- The separate `/api/endpoint/*` API exposes private local records only through guarded loopback requests. It requires an in-memory session token for status and same-origin validated POSTs for Start/Stop. It does not provide per-user accounts or enterprise authentication.
- Local collection is explicit, read-only and bounded. No arbitrary command, scan, quarantine, deletion, protection-setting change, service installation or remote device control is available. Stop clears the monitor's memory, not Windows logs.
- Non-loopback deployment disables PC monitoring. Never forward private endpoint routes through a public proxy, tunnel or port-forward. Loopback guards do not defend against malware or another process already running as the same Windows account.
- Use a reverse proxy with HTTPS and appropriate traffic limits for internet-facing deployments.
- Keep Node.js and locked dependencies maintained. Run `npm audit` when changing dependencies.
- A vulnerability record or news result is not a diagnosis of a user's system. Confirm applicability with the source and your own authorized security process.
