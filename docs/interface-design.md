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

## Layout

The connection and refresh controls occupy a static, full-width instrument strip.
They deliberately do not stick to the viewport. The three source panels have equal
widths, aligned headings, equal record rows in the default five-record view, and
aligned footer edges. Source health sits outside the feed grid, so no
sticky control can travel underneath it.

Above 1100px, **Show all records** gives each feed a keyboard-focusable
scroll region. This avoids an uneven page when the official feeds return eight
records and news returns twelve. At 1100px and below, panels stack with normal page scrolling. Search
results always use natural content height; an empty search is not a blank scroll
box. All record text remains available rather than being line-clamped.

Official publisher labels and the community feed's explicit unverified label
distinguish authority without relying on colour. Microsoft records show both
first publication and latest revision dates: an older release can be revised today.
Source health follows the same display order. A keyboard-operable source-validation
disclosure explains HTTPS, field validation and the limits of these checks.

## Motion

- The hero's **Motion on/off** control changes decorative motion, not the separate
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
