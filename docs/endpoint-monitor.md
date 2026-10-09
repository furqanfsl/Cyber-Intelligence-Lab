# Local endpoint monitoring

The endpoint workspace reads real Windows security records from the computer
running this app. It is separate from public security news, imported datasets
and synthetic practice scenarios. No paid AI API is needed: Microsoft Defender
provides its own detections, and transparent rules identify supported suspicious
log patterns for an analyst to review.

A public website cannot silently inspect a visitor's computer. This feature
requires the app's local Node server on the Windows computer being monitored.
Opening a remotely hosted copy does not connect that copy to your PC.

## Start and stop deliberately

1. Run `start.bat` or `npm run dev` from this project's folder. Keep that server
   running and open the address printed in its terminal.
2. Open the endpoint workspace and read its collection notice. It describes
   private records, required permissions and the limited coverage.
3. Start monitoring only a computer you are authorized to monitor. Starting is
   an explicit action; opening the page or checking availability does not collect
   logs.
4. Inspect source health before interpreting findings. A denied, unavailable or
   missing source is a coverage gap, not evidence that the PC is safe.
5. Review each finding's source, time, explanation and supporting evidence.
   Distinguish a Defender-reported detection from a rule-generated candidate.
6. Check the original record or Windows Security before responding. Use your
   normal authorized security tools; this app does not remove files, quarantine
   threats, isolate a device or change protection settings.
7. After taking action, review fresh source records. An analyst's acknowledgement
   alone does not prove that the underlying threat was resolved.
8. Stop monitoring when finished. Stopping clears the monitor's in-memory
   private history. It does not erase Windows event logs or any original files.

Monitoring belongs to the running local server, not to one browser tab. Closing
or reloading the browser does **not** stop a started monitor. Choose Stop in the
workspace, or stop this project's server with **Ctrl+C**. Stopping the server
ends its collection; no Windows service or scheduled task is installed.

The monitor checks every **30 seconds** after the previous collection finishes.
Each check queries a recent **15-minute** window; already-seen normalized
records are deduplicated. Server-retained history is limited to **60 minutes**, with
caps of **2,000 supported log events**, **200 Defender events** and **200
findings**. These are bounded snapshots, not a complete historical archive.
Records outside the queried window or beyond a source's limit can be missed.
Sleep, a stopped server, inaccessible logs or collector failures create gaps.

Each query returns at most **250 Security records**, **250 Sysmon records**
when requested, and **200 Defender records**. Source health reports truncation
and records that could not be normalized. The retained event-data budget is
**2 MiB**. The fixed local helper has a **15-second deadline** and a **5 MiB**
combined response limit; it is not allowed to run an arbitrary command from the
browser.

The browser displays an in-memory copy of the last snapshot. If its connection
fails, that older copy can remain visible, labelled as unverified, until a
successful refresh or reload. Stop clears this tab after the server confirms
the operation; other tabs receive the change on their next successful refresh.
Closing or reloading a tab discards its own view, not Windows' original records.

## What the sources can tell you

### Microsoft Defender Antivirus

The collector reads the existing Defender status and Operational event channel.
It does not implement a new antivirus engine or start a scan. Defender's own
protection must already be installed and functioning. Its independent cloud
protection settings are not controlled by this app.

Defender event `1116` reports malware or potentially unwanted software detected
by Defender. Event `1117` reports an action, but an **Allow** or **No action**
outcome does not mean the threat was remediated. Events `1118` and `1119` report
action failures. Review the recorded action and Windows Security rather than
assuming that any later event means the device is clean.
[Microsoft's event reference](https://learn.microsoft.com/en-us/defender-endpoint/troubleshoot-microsoft-defender-antivirus)

Detection-to-action correlation requires the same non-empty recorded Detection
ID. An action must be no earlier than the latest retained detection. Displayed
proof is bounded to the first and latest detection plus the latest eligible
action, rather than every event in the channel. A standalone action or failure
can refer to a detection outside the query or retained window; it is not by
itself a newly detected threat.

Current protection status is obtained separately with `Get-MpComputerStatus`.
An older disabled-protection event is not by itself proof that protection is
still disabled. Likewise, enabled protection is not proof that there are no
undetected threats.
[Microsoft's status command](https://learn.microsoft.com/en-us/powershell/module/defender/get-mpcomputerstatus)

Defender configuration changes can occur during normal administration and
updates. Treat a change as context to review, not an automatic malware verdict.

### Windows Security and optional existing Sysmon

Windows Security logon records `4624`/`4625` and optional Sysmon process-create
records `1` can produce the same transparent candidate rules used by the
[log investigation workspace](log-investigation.md).
Repeated failed logons, a successful logon after failures and an encoded
PowerShell launch can have legitimate explanations. Findings describe the
observed pattern, not an identified attacker.

Sysmon is optional and must already be installed and accessible if selected.
The app does not install it, alter audit policies or elevate privileges. A
missing process channel means that those process rules have no live coverage.
This live collector does not read Sysmon network event `3`, capture packets or
implement a network intrusion detector. The separate file importer accepts
Sysmon `3` as context only.

Windows decides which channels the current account can read. Access can be
denied even when the app launches correctly. Respect organization policy; do
not bypass event-log permissions or enable monitoring on someone else's device.
[Microsoft's event-log command](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.diagnostics/get-winevent)

## Notifications are optional

The dashboard shows findings without needing operating-system notification
permission. Browser notifications require a separate user action and a browser
that supports them. A blocked permission or notification failure must not stop
the local monitor or hide its in-page findings.

Keep the browser tab open to receive browser-delivered notifications. A closed
tab cannot issue them; background throttling, device sleep, operating-system
settings and the browser can delay or suppress delivery. This is not an
always-on Windows notification service or a guaranteed emergency-alert channel.
Notification messages should not expose account names, file paths, commands or
observed addresses on a shared or locked screen.
[Browser notification behavior](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API)

## Private data and the local API

The typed snapshot contract is [`shared/endpoint.ts`](../shared/endpoint.ts).

| Route | Method | Fixed input |
| --- | --- | --- |
| `/api/endpoint/session` | `GET` | Availability and a process-local session token; no collection |
| `/api/endpoint/status` | `GET` | Current bounded snapshot; no collection starts |
| `/api/endpoint/start` | `POST` | `{ "includeSysmon": false }` or `true` |
| `/api/endpoint/stop` | `POST` | `{}`; abort collection and clear monitor history |

All routes require `X-Cyber-Lab-Endpoint-Client: 1`. Status, Start and Stop also
require `X-Cyber-Lab-Endpoint-Token` from the session response. POSTs require the
exact local Origin and JSON content type. These controls are not user accounts;
only the same local app instance should access them. The browser refuses private
requests on nonliteral loopback hostnames. Unsupported or disabled instances do
not collect logs. Do not publish a real session token or a status response.

Collection is read-only and private snapshots are held in the local server's
memory. The monitor does not write them to a database, browser storage, GitHub,
public feeds or an AI provider. Public feed requests remain a separate feature.
This does not make the entire app network-free, or change Defender's own
Microsoft-cloud settings.

Real records can contain account names, host names, addresses, process paths
and command lines. Review them locally and do not commit them, copy them into
issues or include them in public screenshots. Stopping clears the monitor's
memory; Windows still retains its original records. The separate Python/SQLite
import workflow has different persistence behavior and is not automatically
connected to this monitor.

The private API accepts only guarded local requests. It checks loopback
connections and the exact local host and port, rejects other sites and requires
an in-memory token for access to private status. Start and Stop additionally
require a same-origin POST with a small, validated JSON body. Private responses
are not CORS-enabled and are marked `no-store`. There is no arbitrary command,
remote computer, filename, scan or remediation parameter.

Control bodies are capped at **1 KiB** and must finish within **five seconds**.
Only a boolean `includeSysmon` option is accepted for Start; Stop accepts no
options. Unexpected or duplicate keys, query parameters, non-JSON content and
invalid UTF-8 are rejected before any monitor operation.

Remote hosting and non-loopback listening disable collection. Do not expose the
monitor through a public proxy, tunnel or port-forward. Requests carrying
`Forwarded`, `Via`, `X-Forwarded-*` or common proxy client-address headers are
rejected, even if a proxy rewrites the host and connection to look local. This
is defense in depth, **not proxy authentication**: a headerless forwarder cannot
be distinguished from a direct local connection by these checks. Never forward
private `/api/endpoint/*` routes, and do not treat a loopback backend behind a
public proxy as a private deployment.

Local access controls are not protection against malware or another authorized
process already running as your Windows account. A compromised endpoint can
tamper with its records and this process; the app is not an independent forensic
attestation.

## Analysis value and limits

Useful analysis starts with coverage: which channels are accessible, which
records were actually returned, and when the last successful collection
finished. Then review the finding's rule or vendor source, related events,
chronological evidence and plausible benign alternatives. A lack of findings
means only that the bounded retrieved records produced none of the supported
findings; it does **not** mean a threat-free computer.

This is a single-device analyst tool, not a replacement for antivirus, managed
EDR or a company's SIEM. Fleet enrollment, centralized access control,
tamper-resistant agents, long-term evidence retention, organization-wide
correlation, remote containment and audited remediation are not implemented.
Those require separate infrastructure, permissions and security review.
Public advisories can provide context but are not evidence that your PC was
attacked. An observed IP is not proof of a person's identity or original VPN IP.

See [real-incident boundaries](real-incident-workflow.md) for the distinction
between observed records, interpretations and future integrations.
