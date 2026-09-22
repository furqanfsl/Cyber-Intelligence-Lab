# Security

This is a defensive learning application, not a production detection or response system. Only the latest `main` branch is maintained.

## Report a vulnerability

Do not put credentials, private data, or working exploits in a public issue. Use the repository's **Security → Report a vulnerability** option if it is available. If it is not, contact the maintainer through their GitHub profile before sharing sensitive details. No response-time guarantee is offered.

Include the affected commit, a minimal reproduction using synthetic data, expected and actual behavior, and the potential impact. Test only your own local instance; do not probe upstream CISA or Hacker News infrastructure on this project's behalf.

## Deployment boundaries

- The API requires no user credentials and exposes only public-source records.
- The source list is fixed. There is no user-supplied URL proxy, active scanning, or endpoint-control capability.
- Use a reverse proxy with HTTPS and appropriate traffic limits for internet-facing deployments.
- Keep Node.js and locked dependencies maintained. Run `npm audit` when changing dependencies.
- A vulnerability record or news result is not a diagnosis of a user's system. Confirm applicability with the source and your own authorized security process.
