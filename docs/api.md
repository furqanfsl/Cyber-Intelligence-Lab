# Live intelligence API

`GET /api/live-intel` returns a public-source snapshot. `HEAD` has the same status and headers without a response body. Query strings do not bypass caching. Other methods return `405` with `Allow: GET, HEAD`; similarly named and nested paths do not match this endpoint.

The same middleware is used by Vite development, local preview, and the production Node server.

## Response

The TypeScript contract is [shared/live-intel.ts](../shared/live-intel.ts).

| Field | Meaning |
| --- | --- |
| `generatedAt` | Time the aggregate snapshot was assembled, **not** a guarantee that every source is current |
| `pollAfterMs` | Suggested client interval; currently 60,000 ms |
| `cacheTtlMs` | Server cache duration after a completed refresh; currently 60,000 ms |
| `sources` | Source name, health, returned record count, optional last-success time and explanatory message |
| `kev` | Up to eight validated, most recently added CISA records |
| `news` | Up to twelve globally sorted, deduplicated Hacker News stories |
| `advisories` | Up to eight official Microsoft MSRC release summaries, sorted by most recent revision |

Source health is `ok`, `stale` (retained source results after a failed refresh), or `error`. A news source can contain available results even when some search queries fail; its message explains partial failure. Inspect health rather than assuming a nonempty array is fresh. The UI defaults to five records per feed and offers expansion and snapshot search.

Source order in the API is CISA, Hacker News, Microsoft MSRC. The interface places the two official feeds first. `advisories` is required, including when empty; its records contain `id`, `title`, `publishedAt`, `updatedAt` and a canonical `url`. Deploy the frontend and API together: older two-source payloads fail the current client's validation rather than being mislabelled as complete.

## Failure and caching behavior

Provider failures are represented in the snapshot with HTTP `200`; last-known-good data is preserved in process memory. An unexpected service-level failure returns `503` with a generic error object. No upstream exception details are exposed.

Responses use `Cache-Control: no-store` because the API manages its own shared cache. Concurrent refreshes reuse one in-flight operation. Each upstream request is limited to nine seconds and five MiB, uses a fixed allowlisted URL, and rejects redirects. Restarting the process clears its cache and retained records.

The client clamps successful polling hints to 30–300 seconds, times requests out after 20 seconds, and retries failures after 90 seconds. A failed client refresh retains the previous snapshot with a stale label. Manual refresh shares any active request and does not force an upstream refresh before cache expiry.

## Sources

- [CISA Known Exploited Vulnerabilities catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)
- [Hacker News search API](https://hn.algolia.com/api)
- [Microsoft Security Updates API](https://github.com/microsoft/MSRC-Microsoft-Security-Updates-API)

CISA links open catalog search records; Microsoft links open Security Update Guide release notes; news links open Hacker News discussion records. Links open in a new tab. Titles and descriptions are untrusted text, not HTML. Source health measures retrieval and parse success, not factual verification or cryptographic signatures on individual records.
