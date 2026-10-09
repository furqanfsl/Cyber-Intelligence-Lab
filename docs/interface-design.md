# Analyst workspace: layout and motion

The interface borrows information-design patterns from public security products,
not their monitoring capabilities:

- [Cloudflare Radar](https://radar.cloudflare.com/security/application-layer):
  explicitly scoped data, clear source context and concise panel headings.
- [Elastic Security overview](https://www.elastic.co/docs/solutions/security/dashboards/overview-dashboard):
  aligned investigation panels and source-grouped record counts.
- [Kaspersky Cybermap](https://cybermap.kaspersky.com/):
  a contained visualization with separate controls and clear data-source context.

These references informed the design; no third-party UI assets or product code
were copied into the application. The app reads official CISA and Microsoft MSRC
records alongside unverified Hacker News community context. Its incident scenarios
and topology remain explicitly illustrative.

### Additional reference: God's Eye View

[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) was reviewed as an
additional reference for layered public-data exploration and explicit distinctions
between observed, simulated and estimated data. Its keyless starting path is a
useful direction for this lab's no-paid-AI workflow. No code, media, globe, voice
service or provider credentials were imported from that project. This lab keeps
its focus on local log evidence and reviewable candidate rules, not global
surveillance or unsupported monitoring claims.

## Layout

### Focused navigation

The former single scrolling dashboard is split into five bookmarkable views:
Overview, PC, Logs, Live intel and Training. Hash navigation needs no
new router dependency or server-side path rewriting. Existing section links
remain valid, including `#response` inside Training. Browser history, reload,
keyboard navigation and a helpful unknown-destination state are part of the
navigation contract. The redundant static Cases view and invented outcome
metrics were removed; an old `#cases` bookmark opens interactive Training.

Overview is a compact task chooser, not a map or a wall of demo statistics.
Its primary actions open PC and Logs; two secondary links open Live intel and
Training. One concise footer note preserves local/opt-in/privacy boundaries
without a repeated brand block or prominent Back-to-top button. Short pages
keep this footer at the window's bottom; long pages use ordinary flow. Other
views retain a quiet current-view Back-to-top link and relevant scope note.
Each view shares one content-width and gutter system. In particular, PC and
Logs no longer use different 1800/1600px outer frames or create stair-stepped
borders. Main headings, content and footer edges align across views.

Views mount when first visited. Previously visited views remain mounted but
hidden and inert, preserving imported tab-memory investigations without placing
their controls in the focus order. Navigating away never starts or stops the
local collector. Leaving Training pauses replay and closes an open practice
dialog; focus must not return to an opener in a hidden view.

The connection and refresh controls occupy a compact, static full-width strip.
They deliberately do not stick to the viewport. One active source panel replaces
the simultaneous three-column feed layout. CISA opens by default; Microsoft and
Community remain available through labelled tabs with record counts. Left/Right,
Home and End move focus and selection; the active tab alone is in the Tab order.
Community records retain their unverified label rather than blending with official
advisories. Static practice-case summaries have been removed. Each view has a concise footer,
not a learning/skills matrix.

Search still covers every source. Tabs show matching counts, and an empty active
source explains when matches exist in another tab. Switching sources neither
fetches data nor starts the simulated replay. Each feed remembers its own expanded
state. Above 1100px, **Show all records** gives the active feed a keyboard-focusable
scroll region. At 1100px and below, records use normal page scrolling. Search results
always use natural content height; an empty search is not a blank scroll box.
All record text remains available rather than being line-clamped.

Official publisher labels and the community feed's explicit unverified label
distinguish authority without relying on colour. Microsoft records show both
first publication and latest revision dates: an older release can be revised today.
**Source status & timing** folds verbose refresh timing, cache explanations and
source health out of the default view. Offline, stale and failure notices remain
visible even when it is closed. Source health follows the tab order. A nested,
keyboard-operable source-validation disclosure explains HTTPS, field validation
and the limits of these checks; a short read-only/no-device-monitoring boundary
remains visible outside the disclosure.

## Motion

- Training's **Motion on/off** control changes decorative motion, not the separate
  incident simulation. The browser stores the preference locally as `cil-motion`.
  If storage is unavailable, the control still works for the current session.
- The operating system's reduced-motion preference takes priority over a saved
  preference. Changing that setting while the app is open is supported.
- Panels reveal once with a short opacity transition. Parent grids do not hide
  their children behind another animation, and keyboard focus reveals content
  immediately. Content does not repeatedly disappear while scrolling.
- Incident and artifact changes use a short 180ms fade. The decorative scanner
  remains inside an unused diagram corner, away from labels and controls.
- The source strip's thin checking light appears only during a real pending
  request. It does not represent progress, incoming attacks or observed traffic.
- Motion off disables transitions and decorative animations. Hidden tabs pause
  animations; existing polling and simulation visibility controls remain intact.

Regression checks cover alignment, scrolling, keyboard navigation, normal/reduced
motion, preference persistence, blocked storage, hidden tabs and narrow screens.

## Simulation feedback

The map replay is opt-in and never changes the real public-source feeds. **Start
simulation** immediately adds the first seven synthetic events, then adds a batch
every 2.6 seconds while the tab is visible. A prominent running/paused status,
session counter, active region and the three latest batches explain what changed.
Regional totals reconcile with the demo total. Each batch creates one randomized incident and increments the corresponding region. The fixed 9,503-event baseline is illustrative, not live activity.

**Pause simulation** preserves the session. **Resume simulation** continues from
that point without adding an extra immediate batch. **Reset demo** stops the replay
and generates a fresh five-incident session. **New scenario set** also works before
starting. Reloading creates a fresh session. Hidden tabs pause generation rather
than accumulating a backlog. None of these controls generate real security alerts.

Mint highlights and brief arrival fades supplement, rather than replace, text and
counts. Turning motion off or enabling reduced motion keeps the replay usable
without decorative animation. Screen readers receive lifecycle announcements,
not a repeated announcement for every batch.

## Randomized investigations

Each session has a browser-generated seed and five vetted scenario families. Assets,
reserved IPs and .example domains, filenames, evidence IDs, risk scores, observation
windows, summaries and review actions vary together. A generated incident owns its
complete dossier; map activity, the queue, clipboard brief and investigation view
all use that same object. This is template-based synthetic data, not AI analysis or
a live detector. Contextual observations in a dossier are independent of the seven
illustrative map events added per batch.

Activity rows and queue rows open a focused two-pane investigation: evidence on the
left, response on the right. Desktop panes are independently scrollable; narrow
screens stack them in one scroll region. A dark backdrop keeps the underlying page
out of the way. Escape, the backdrop or Close investigation returns to the opener
and preserves the page position. Replay pauses while reviewing and resumes only
when requested. Short fades respect Motion off and reduced-motion preferences.

Only the latest three generated entries, five initial entries and an older selected
entry (if needed) are retained in the queue, so it never grows past nine rows. New
batches do not replace the selected dossier. Focusing the activity or queue pauses
replay so moving rows cannot steal keyboard focus. Queue coverage and network
evidence now follow these real in-memory fixtures instead of unrelated fixed stats.

## Real endpoint workspace

The Overview action and **PC** navigation open a dedicated real own-PC view,
separate from imported logs, public advisories and practice scenarios. It contains no sample
data. Solid dark surfaces and restrained colour keep actual state and controls
readable. Collection starts only after authorization and an explicit Start.
Stop clears bounded server history; closing a browser tab does not stop it.

Source coverage and the last successful collector check precede the finding
queue. Counts distinguish Defender reports, deterministic candidate patterns
and current protection-setting concerns, never a "safe PC" score. Unavailable,
stale or unverified states remain explicit. A failed reconnect does not claim
that collection stopped and offers a local-terminal fallback.

Desktop groups a paginated review queue and chronological evidence; mobile
stacks them in reading order. Filters, search, manual review and status labels
use text and semantic state in addition to colour. Private event fields and
command lines require explicit disclosure. No process text is executed.
Action guidance directs the analyst to their existing Windows Security tools;
no destructive cleanup is performed by this app. Generic tab notifications
require a separate user gesture and never expose private identifiers.

Before/after desktop/mobile, source gaps, Defender/candidate evidence, failed
connection, resolution guidance and doubled-text views were captured and
inspected against layout, typography, colour, materials, writing and keyboard
accessibility. These checks are not an accessibility certification or an EDR
readiness claim. See [endpoint monitoring](endpoint-monitor.md) for exact limits.

## Imported log investigations

**Logs** and **Investigate local logs** open a dedicated import workspace.
It uses the existing solid dark surfaces, self-hosted typography and restrained
semantic colours. An empty state offers explicitly synthetic suspicious and
benign examples; imported exports carry an unverified user-provided label.
Source feeds and replay controls never operate on the imported records.

File format/size guidance, local-only handling and visible error recovery sit
beside the file input. Imports validate atomically and replacement resets filters,
selection and manual review. A failed import leaves the previous dataset intact.
All event strings are rendered as untrusted text; command lines require an
explicit disclosure and are never decoded or executed.

Desktop uses a candidate list and evidence pane. On narrow screens they stack
in reading order. Candidate lists and event tables are paginated rather than
mounting thousands of controls. The table has its own keyboard-focusable scroll
region and a visible sideways-scroll hint on mobile, never page-wide overflow.
All five navigation destinations remain available on narrow screens without shrinking the
existing labels. Selection and severity use text plus pressed state, not colour
alone. Analyst review is explicitly manual, not an automated verdict.

Redacted Markdown/JSON exports use an allowlist: aliases replace hosts, accounts
and addresses; command lines, process paths, source IDs and filenames are omitted.
Exact UTC timestamps remain and the UI asks the user to review before sharing.
Rules, false-positive explanations, data-quality notices and the optional
Python/SQLite path are available progressively without obscuring the core task.
