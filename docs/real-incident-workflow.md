# Real incident analysis: scope and implementation path

Cyber Intelligence Lab now supports browser-local authorized log imports,
deterministic candidate rules, evidence timelines and redacted reports, plus an
optional offline Python/SQLite workflow. See the [implemented log workflow](log-investigation.md)
for supported inputs, rules and limits. It has no connected AI model, endpoint
sensor or SIEM integration. Public vulnerability records do not establish that
an attack occurred against a particular system.

The phases below describe the design boundary and future integrations; they
do not promise continuous collection, attacker identification or automated
response. Local import and rule-based triage are implemented; AI and connectors
remain optional future work requiring separate approval.

## What evidence can establish

Authorized firewall, web-server, authentication and endpoint logs can support
incident triage. For example, Microsoft's `DeviceNetworkEvents` records network
connections and associated process details, but requires deployed Defender for
Endpoint telemetry. [Microsoft's schema reference](https://learn.microsoft.com/en-us/defender-xdr/advanced-hunting-devicenetworkevents-table)

An observed IP is a connection address, not a person's identity. Traffic routed
through a VPN normally presents the VPN server's address to the destination;
destination logs alone cannot reliably reveal the original device's address.
AI cannot reconstruct missing evidence. [Cloudflare's VPN explanation](https://developers.cloudflare.com/learning-paths/replace-vpn/concepts/vpn-overview/)

Keep the directly observed peer address separate from addresses claimed in
forwarding headers. Accept a proxy-reported client address only when the
deployment's trusted proxy chain is explicitly configured and verified. A
header supplied by an arbitrary client is not proof of origin.
[NGINX's trusted-address configuration](https://nginx.org/en/docs/http/ngx_http_realip_module.html)

Correlations across timestamps, sessions, devices and accounts produce evidence
and hypotheses—not guaranteed attribution. Shared addresses, clock differences
and compromised accounts can mislead. Preserve source identifiers and timestamp
zones, distinguish observations from interpretations, and show uncertainty.

## Phased delivery

### 1. Agree the authorized input

Choose one log/export format and confirm permission to analyze it. An existing
SIEM or EDR export is preferable to inventing a new collector. Agree necessary
fields, timezone handling, sensitive-data treatment and retention before adding
an integration. No access to third-party systems or private traffic is implied.

### 2. Build local-first triage

Start with a bounded JSON or CSV import processed in browser memory. Enforce
file-size, record-count and field-length limits; validate records and safely
render their text without executing embedded content. Do not persist imported
records or send them externally by default. Provide an explicit clear action.

Use deterministic rules to group potentially suspicious events and expose the
supporting records. Report observed addresses, rule explanations and unknowns.
Any export must be deliberate and redacted; real logs must never enter the
public repository. Logs can contain credentials and personal information.
[OWASP's logging safeguards](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

### 3. Offer optional AI assistance

Only after choosing a provider, credentials, cost limits and data-handling
policy should an actual model integration be considered. Obtain explicit
approval before sending redacted incident evidence to that provider. No real
incident data is being sent to an AI provider by this proposal.

Require schema-validated, evidence-linked output that separates observations,
hypotheses and suggested next steps. Reject invented evidence references or
addresses. Treat log contents as untrusted data: attackers can place instructions
inside logs, and prompt-injection defenses are not a complete guarantee. Give
the model no command execution, arbitrary network access or containment tools.
[OWASP's prompt-injection guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

### 4. Consider read-only connectors

After validating local triage, a separately approved SIEM/EDR connector could
use least-privilege access, bounded queries, protected credentials and an agreed
retention policy. Keep private telemetry separate from public feeds and demo
scenarios.

## Operational boundary

An analyst reviews findings and approves any response through their existing
authorized tools. This application must not automatically block addresses,
isolate devices, scan outside systems or attempt VPN deanonymization. A useful
outcome is a traceable incident brief—not a promise to identify every attacker.
