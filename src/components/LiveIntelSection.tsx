import { useEffect, useState } from 'react'
import type { LiveIntelPayload } from '../../shared/live-intel'
import { CISA_NAME, MSRC_NAME } from '../../shared/live-intel'
import type { LiveIntelState } from '../lib/live-intel'
import { emptyFeedMessage } from '../lib/live-intel'
import { intelAnnouncement } from '../lib/intel-announcement'
import { formatTimestamp } from '../lib/timestamps'
import { createVisibleInterval } from '../lib/visible-interval'
import './LiveIntelSection.css'

function NextCheck({ state }: { state: LiveIntelState }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!state.nextCheckAt) return
    return createVisibleInterval(() => setNow(Date.now()), 1000, document)
  }, [state.nextCheckAt])
  if (!state.isOnline) return <>Paused while offline</>
  if (state.isRefreshing) return <>Checking sources now</>
  if (!state.nextCheckAt) return <>Resumes when this tab is visible</>
  const seconds = Math.min(Math.round(state.pollAfterMs / 1000), Math.max(0, Math.ceil((Date.parse(state.nextCheckAt) - now) / 1000)))
  return <><span className="countdown">{seconds > 0 ? `In ${seconds}s` : 'Check due'}</span><small>While this tab is visible</small></>
}

export function LiveIntelSection({ liveIntel, state, onRefresh }: {
  liveIntel: LiveIntelPayload | null
  state: LiveIntelState
  onRefresh: () => void
}) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const search = query.trim().toLocaleLowerCase()
  const allKev = liveIntel?.kev ?? []
  const allNews = liveIntel?.news ?? []
  const allAdvisories = liveIntel?.advisories ?? []
  const matchingKev = allKev.filter((item) => `${item.id} ${item.title} ${item.vendor} ${item.product}`.toLocaleLowerCase().includes(search))
  const matchingNews = allNews.filter((item) => `${item.title} ${item.author}`.toLocaleLowerCase().includes(search))
  const matchingAdvisories = allAdvisories.filter((item) => `${item.id} ${item.title} Microsoft MSRC`.toLocaleLowerCase().includes(search))
  const kevItems = expanded || search ? matchingKev : matchingKev.slice(0, 5)
  const newsItems = expanded || search ? matchingNews : matchingNews.slice(0, 5)
  const advisoryItems = expanded || search ? matchingAdvisories : matchingAdvisories.slice(0, 5)
  const sourceCount = liveIntel?.sources.filter((source) => source.status === 'ok').length ?? 0
  const displaySources = liveIntel ? [liveIntel.sources[0], liveIntel.sources[2], liveIntel.sources[1]].filter((source) => source !== undefined) : []
  const labels = { connecting: 'Connecting', live: 'Sources current', partial: 'Partial sync', stale: 'Stale data', error: 'Source error' }
  const statusMessage = state.error ?? (state.status === 'partial'
    ? 'Some sources could not refresh. Check source health before using these records.'
    : state.status === 'stale' ? 'Showing previously retrieved records. They may be out of date.'
    : state.status === 'error' ? 'No reliable source data is available. An automatic retry is scheduled.' : '')

  return (
    <section className="live-intel-section" id="live-intel">
      <div className="section-header reveal">
        <span>01.</span>
        <div><p className="kicker">Live intelligence / public sources</p><h2>Know what changed.{' '}<br />Go straight to the source.</h2></div>
        <p className="quote">Official CISA and Microsoft records, with community discussion kept separate. Check the publisher, publication date and source health.</p>
      </div>

      <article className="panel live-status-panel" aria-busy={state.isRefreshing}>
        <div className="connection-topline">
          <div className="panel-heading">
            <div><div className="panel-title">Connection & refresh</div><small>Public-source monitor</small></div>
            <span className={`live-status-badge ${!state.isOnline ? 'offline' : state.status}`}>{!state.isOnline ? 'Offline' : state.isRefreshing ? 'Refreshing' : labels[state.status]}</span>
          </div>
          <button className="button button-primary live-refresh" type="button" onClick={onRefresh} disabled={state.isRefreshing || !state.isOnline}><span>{state.isRefreshing ? 'Refreshing…' : 'Refresh sources'}</span><span className="button-glyph" aria-hidden="true">↻</span></button>
        </div>
        {statusMessage && <p className="feed-notice">{statusMessage}</p>}
        <dl className="automation-list">
          <div><dt>Next check</dt><dd><NextCheck state={state} /></dd></div>
          <div><dt>Last checked</dt><dd>{state.lastCheckedAt ? formatTimestamp(state.lastCheckedAt) : 'Waiting for first check'}</dd></div>
          <div><dt>Snapshot generated</dt><dd>{liveIntel ? formatTimestamp(liveIntel.generatedAt) : 'Waiting for first sync'}</dd></div>
          <div><dt>{state.error ? 'Previously healthy sources' : 'Healthy sources'}</dt><dd>{sourceCount}/{liveIntel?.sources.length ?? 3}<small>Source availability, not a security assessment</small></dd></div>
        </dl>
        <p className="refresh-explainer">Automatic checks run {Math.round(state.pollAfterMs / 1000)} seconds after each response. A shared 60-second cache limits repeated requests; unchanged records are expected.</p>
      </article>

      <div className="intel-toolbar">
        <div className="intel-search">
          <label htmlFor="intel-search">Search this snapshot</label>
          <input id="intel-search" type="search" maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="CVE, vendor, headline or author…" autoComplete="off" />
        </div>
        <p className="intel-results" role="status">{search ? `${matchingKev.length + matchingNews.length + matchingAdvisories.length} matching records` : `${allKev.length + allNews.length + allAdvisories.length} records in this snapshot`}</p>
        {query && <button className="button button-secondary slim" type="button" onClick={() => setQuery('')}>Clear search</button>}
        {!search && (allKev.length > 5 || allNews.length > 5 || allAdvisories.length > 5) && <button className="button button-secondary slim" type="button" aria-expanded={expanded} aria-controls="kev-records advisory-records news-records" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show latest 5 per feed' : 'Show all records'}</button>}
      </div>
      <p className="sr-only" id="intel-announcement" role="status" aria-live="polite" aria-atomic="true">{intelAnnouncement(state)}</p>

      <div className={`live-intel-grid${expanded && !search ? ' is-expanded' : ''}`} aria-busy={state.isRefreshing}>
        <article className="panel osint-feed-panel" aria-labelledby="kev-feed-title">
          <div className="panel-heading"><div><small className="feed-channel">Official / CISA</small><h3 className="panel-title" id="kev-feed-title">Exploited vulnerabilities</h3><small>Known Exploited Vulnerabilities catalog</small></div><data value={kevItems.length}><span className="sr-only">Displayed records: </span>{String(kevItems.length).padStart(2, '0')}</data></div>
          <div className="osint-list" id="kev-records" role="region" aria-label="CISA records" tabIndex={expanded && !search ? 0 : undefined}>
            {kevItems.length ? kevItems.map((item) => (
              <a href={item.url} key={item.id} rel="noreferrer" target="_blank">
                <div className="feed-meta"><strong>{item.id}</strong><span>Added {item.dateAdded}</span></div>
                <p>{item.title}</p>
                <small>{item.vendor} / {item.product}</small>
                <small>Known ransomware use: {item.ransomwareUse}</small>
                <em>Open CISA record <span aria-hidden="true">↗</span><span className="sr-only">(opens in a new tab)</span></em>
              </a>
            )) : <p className="empty-feed">{search && allKev.length ? 'No vulnerabilities match this search.' : emptyFeedMessage('CISA', liveIntel?.sources[0]?.status, state.isRefreshing, Boolean(state.error))}</p>}
          </div>
          <div className="feed-footer"><span>{kevItems.length} of {matchingKev.length} {search ? 'matching ' : ''}records</span><span>Official government catalog</span></div>
        </article>

        <article className="panel osint-feed-panel" aria-labelledby="advisory-feed-title">
          <div className="panel-heading"><div><small className="feed-channel">Official / Microsoft MSRC</small><h3 className="panel-title" id="advisory-feed-title">Security updates</h3><small>Publisher release notes · sorted by revision</small></div><data value={advisoryItems.length}><span className="sr-only">Displayed records: </span>{String(advisoryItems.length).padStart(2, '0')}</data></div>
          <div className="osint-list" id="advisory-records" role="region" aria-label="Microsoft security updates" tabIndex={expanded && !search ? 0 : undefined}>
            {advisoryItems.length ? advisoryItems.map((item) => (
              <a href={item.url} key={item.id} rel="noreferrer" target="_blank">
                <div className="feed-meta"><strong>{item.id}</strong><span>Updated {new Date(item.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                <p>{item.title}</p>
                <small>Microsoft Security Response Center</small>
                <small>First released {new Date(item.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</small>
                <em>Open Microsoft advisory <span aria-hidden="true">↗</span><span className="sr-only">(opens in a new tab)</span></em>
              </a>
            )) : <p className="empty-feed">{search && allAdvisories.length ? 'No advisories match this search.' : emptyFeedMessage('Microsoft', liveIntel?.sources[2]?.status, state.isRefreshing, Boolean(state.error))}</p>}
          </div>
          <div className="feed-footer"><span>{advisoryItems.length} of {matchingAdvisories.length} {search ? 'matching ' : ''}records</span><span>Official vendor advisories</span></div>
        </article>

        <article className="panel osint-feed-panel community-feed" aria-labelledby="news-feed-title">
          <div className="panel-heading"><div><small className="feed-channel">Community / Hacker News</small><h3 className="panel-title" id="news-feed-title">Community context</h3><small>Community reports · not independently verified</small></div><data value={newsItems.length}><span className="sr-only">Displayed records: </span>{String(newsItems.length).padStart(2, '0')}</data></div>
          <div className="osint-list" id="news-records" role="region" aria-label="Cyber news records" tabIndex={expanded && !search ? 0 : undefined}>
            {newsItems.length ? newsItems.map((item) => (
              <a href={item.url} key={item.id} rel="noreferrer" target="_blank">
                <div className="feed-meta"><strong>Discussion</strong><span>Published {new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                <p>{item.title}</p>
                <small>By {item.author} · {item.points} points</small>
                <em>Open discussion record <span aria-hidden="true">↗</span><span className="sr-only">(opens in a new tab)</span></em>
              </a>
            )) : <p className="empty-feed">{search && allNews.length ? 'No discussions match this search.' : emptyFeedMessage('cyber news', liveIntel?.sources[1]?.status, state.isRefreshing, Boolean(state.error))}</p>}
          </div>
          <div className="feed-footer"><span>{newsItems.length} of {matchingNews.length} {search ? 'matching ' : ''}records</span><span>Unverified community reports</span></div>
        </article>
      </div>
      {expanded && !search && <p className="feed-scroll-hint">All records are available. Scroll within each feed to browse its full snapshot.</p>}

        <article className="panel source-health-panel">
          <div className="source-health-heading"><div className="panel-title">Source health</div><p className="source-caption">Connection and record checks, not independent fact-checking</p></div>
          {displaySources.map((source) => (
            <div className="source-row" key={source.name}>
              <span className={state.error ? 'stale' : source.status}>{state.error ? 'unverified' : source.status === 'ok' ? 'Available' : source.status}</span>
              <strong>{source.name}</strong>
              <small className="source-kind">{source.name === CISA_NAME ? 'Official government catalog' : source.name === MSRC_NAME ? 'Official vendor advisories' : 'Community reports · unverified'}</small>
              <small>{source.message ?? `${source.count} records received`}{source.lastSuccessAt && ` · Last successful refresh: ${formatTimestamp(source.lastSuccessAt)}`}</small>
            </div>
          ))}
          {!liveIntel && <p className="empty-feed">{state.isRefreshing ? 'Connecting to public sources.' : 'Source health is unavailable until a request succeeds.'}</p>}
        </article>
      <details className="source-assurance">
        <summary>How sources are validated</summary>
        <div className="source-assurance-body">
          <div><h3>Publisher connections</h3><p>The server requests fixed HTTPS endpoints with certificate validation and rejects redirects. These are public feeds: no API keys or account authentication are used.</p><p className="source-links"><a href="https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json" target="_blank" rel="noreferrer">CISA source feed<span className="sr-only"> (opens in a new tab)</span></a><a href="https://api.msrc.microsoft.com/cvrf/v3.0/updates" target="_blank" rel="noreferrer">Microsoft source feed<span className="sr-only"> (opens in a new tab)</span></a><a href="https://hn.algolia.com/api" target="_blank" rel="noreferrer">HN search API<span className="sr-only"> (opens in a new tab)</span></a></p></div>
          <div><h3>What validation means</h3><p>Record IDs, dates, links and payload structure are checked. Failed refreshes are labelled; retained records are not presented as fresh. HTTPS and format checks do not independently verify every claim or authenticate individual reports.</p><p>Official records describe publisher findings. Community search results may be unrelated or unverified. Neither proves that your systems are compromised.</p></div>
        </div>
      </details>
      <div className="data-boundary"><span>How live is live?</span><p>These feeds are periodically checked, not streamed. Publication, indexing and caching can delay updates. Checks pause while this tab is hidden or offline. The map and incident scenarios remain simulated: this app does not detect attacks across the internet or monitor your devices.</p></div>
    </section>
  )
}
