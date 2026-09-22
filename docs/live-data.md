# What the live feed does

The live intelligence section reads public sources. It is not a network sensor,
SIEM integration, vulnerability scanner, or instant view of the internet. The
attack counter, map, packet stream, incident exercises, forensic examples and
response checklists elsewhere in the dashboard are simulations.

## Source scope

| Source | Request and selection | What a record means |
| --- | --- | --- |
| CISA KEV | Read the official JSON catalog; validate, sort by date added, deduplicate CVE IDs, return up to eight records | A catalog entry for a known exploited vulnerability, not evidence of exploitation in this application's environment |
| Hacker News search | Three Algolia `search_by_date` story searches: `cybersecurity`, `ransomware`, and `vulnerability`; up to six results each, merged into at most twelve unique stories | A matching public community discussion, not a verified incident or comprehensive news coverage |

The interface shows a subset of the API records. CISA links open an official
catalog search for the CVE; news links open the Hacker News discussion, not the
third-party article. Source sites can change availability, delete records or
rate-limit requests independently of this app.

CISA explains that catalog updates typically occur during US Eastern weekday
business hours when entries change. Polling more frequently does not make CISA
publish more frequently. See the [official KEV data repository](https://github.com/cisagov/kev-data#update-schedule)
and [Hacker News search API](https://hn.algolia.com/api).

## Time labels are deliberately different

- **Last checked:** when the browser completed its latest API attempt. A cached
  response or unsuccessful attempt can still update this time; inspect the
  accompanying status.
- **Snapshot generated:** the backend's `generatedAt`, when it assembled that
  snapshot. It is not the publication time of every record.
- **Last successful refresh:** source-specific `lastSuccessAt`. For news, this
  tracks the last refresh in which all three searches succeeded. It can remain
  old or be absent during partial results.
- **Added / published:** CISA's catalog-addition date or the story's submission
  time. An older record can remain the newest matching source result.
- **Next check:** the browser's scheduled attempt, not a promise that new source
  content will exist then. Browser scheduling, suspension and network conditions
  can delay it.

## Refresh and latency boundaries

The visible, online dashboard normally schedules its next request **60 seconds
after the previous request finishes**. Hidden tabs pause checks; returning to
the tab or reconnecting schedules a fresh attempt. Manual refresh shares an
already-running request.

The server also maintains a **60-second shared cache**, starting when a refresh
completes. Manual requests and query parameters do not bypass it. Refreshes
happen on demand: there is no separate background collection job while nobody
is requesting the API. Concurrent requests share the same upstream work.

These intervals are not an end-to-end delivery guarantee. With different
clients checking at different times, a source change can wait for both cache
expiry and a later browser poll, approaching two minutes before network and
upstream publication/indexing delays are included. A hidden/offline tab or
source outage can extend the delay indefinitely. This is periodically checked
public intelligence, not second-by-second monitoring.

The backend starts its four upstream requests in parallel. Each has a
9-second abort deadline and a 5 MiB response limit. The browser has a 20-second
request timeout and schedules a 90-second retry after transport, HTTP or
validation failures. Timers are protective limits, not real-time scheduling
guarantees. A valid API snapshot with partial source errors still uses its
normal polling hint.

## Outages and deployment

Failed sources retain their last successful records in server memory and show
`stale` or `error` status. A failed news search does not discard the other two
searches. The browser also retains an available prior snapshot when a request
fails. These are in-memory fallbacks, not a persistent offline database; a
server restart or page reload can remove them.

Source failures can appear in an HTTP `200` snapshot because the API itself
responded successfully. Inspect `sources`, not only the HTTP status or a nonempty
array. Unexpected service errors return a generic `503`. `/healthz` tests
process readiness independently of upstream availability.

Development, preview and the production Node server use the same source
middleware. A static-only deployment does not run the API. Follow the
[deployment guide](deployment.md) and [API contract](api.md); use the production
server behind an appropriate HTTPS ingress for public hosting.

## Dated verification sample

At **2026-09-22 03:32 UTC**, a real-source smoke check observed:

- CISA catalog version `2026.09.21`, released
  `2026-09-21T18:46:35.0873Z`, containing 1,717 entries. The newest addition date
  was 21 September.
- Six results from each Hacker News query; the newest matching story was
  submitted at `2026-09-21T17:26:11Z`.
- An aggregate of eight CISA records and twelve news records, both sources
  healthy, accepted by the frontend's runtime validator.
- Individual source requests completed in approximately 203-295 ms in this
  single local sample. A repeated service request reused the same cached
  snapshot. These measurements are not a service-level commitment.

The link check confirmed the newest CISA record and multiple Hacker News
discussions loaded with `GET`. Hacker News rejected `HEAD` checks with `405`
and rate-limited several subsequent checks with `429`; neither response alone
means the record URL is a `404`. Avoid using aggressive link crawls as an
availability monitor.

The audit's 88 backend and production-runtime tests also passed without using
external feeds. No backend behavior change was needed for this review.
