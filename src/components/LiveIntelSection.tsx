import { useEffect, useState } from 'react'
import type { LiveIntelPayload } from '../../shared/live-intel'
import type { LiveIntelState } from '../lib/live-intel'
import { emptyFeedMessage } from '../lib/live-intel'
import { intelAnnouncement } from '../lib/intel-announcement'
import { formatTimestamp } from '../lib/timestamps'
import { createVisibleInterval } from '../lib/visible-interval'

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
  const matchingKev = allKev.filter((item) => `${item.id} ${item.title} ${item.vendor} ${item.product}`.toLocaleLowerCase().includes(search))
  const matchingNews = allNews.filter((item) => `${item.title} ${item.author}`.toLocaleLowerCase().includes(search))
  const kevItems = expanded || search ? matchingKev : matchingKev.slice(0, 5)
  const newsItems = expanded || search ? matchingNews : matchingNews.slice(0, 5)
  const sourceCount = liveIntel?.sources.filter((source) => source.status === 'ok').length ?? 0
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
        <p className="quote">Real advisories. Original discussion records. Clear source health, without the noise.</p>
      </div>

      <div className="intel-toolbar">
        <div className="intel-search">
          <label htmlFor="intel-search">Search this snapshot</label>
          <input id="intel-search" type="search" maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="CVE, vendor, headline or author…" autoComplete="off" />
        </div>
        <p className="intel-results" role="status">{search ? `${matchingKev.length + matchingNews.length} matching records` : `${allKev.length + allNews.length} records in this snapshot`}</p>
        {query && <button className="button button-secondary slim" type="button" onClick={() => setQuery('')}>Clear search</button>}
        {!search && (allKev.length > 5 || allNews.length > 5) && <button className="button button-secondary slim" type="button" aria-expanded={expanded} aria-controls="kev-records news-records" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show latest 5 per feed' : 'Show all records'}</button>}
      </div>
      <p className="sr-only" id="intel-announcement" role="status" aria-live="polite" aria-atomic="true">{intelAnnouncement(state)}</p>

      <div className="live-intel-grid reveal delay-1" aria-busy={state.isRefreshing}>
        <article className="panel live-status-panel">
          <div className="panel-heading">
            <div><div className="panel-title">Connection & refresh</div><small>Public intelligence only</small></div>
            <span className={`live-status-badge ${!state.isOnline ? 'offline' : state.status}`}>{!state.isOnline ? 'Offline' : state.isRefreshing ? 'Refreshing' : labels[state.status]}</span>
          </div>
          {statusMessage && <p className="feed-notice">{statusMessage}</p>}
          <dl className="automation-list">
            <div><dt>Next check</dt><dd><NextCheck state={state} /></dd></div>
            <div><dt>Last checked</dt><dd>{state.lastCheckedAt ? formatTimestamp(state.lastCheckedAt) : 'Waiting for first check'}</dd></div>
            <div><dt>Snapshot generated</dt><dd>{liveIntel ? formatTimestamp(liveIntel.generatedAt) : 'Waiting for first sync'}</dd></div>
            <div><dt>{state.error ? 'Previously healthy sources' : 'Healthy sources'}</dt><dd>{sourceCount}/{liveIntel?.sources.length ?? 2}<small>Source availability, not a security assessment</small></dd></div>
          </dl>
          <button className="button button-primary live-refresh" type="button" onClick={onRefresh} disabled={state.isRefreshing || !state.isOnline}><span>{state.isRefreshing ? 'Refreshing…' : 'Refresh sources'}</span><span className="button-glyph" aria-hidden="true">↻</span></button>
          <p className="refresh-explainer">Automatic checks run {Math.round(state.pollAfterMs / 1000)} seconds after each response. Refresh uses a shared 60-second cache; unchanged records do not mean the feed is broken.</p>
        </article>

        <article className="panel osint-feed-panel">
          <div className="panel-heading"><div><div className="panel-title">Exploited vulnerabilities</div><small>CISA · Known Exploited Vulnerabilities</small></div><data value={kevItems.length}>{String(kevItems.length).padStart(2, '0')}</data></div>
          <div className="osint-list" id="kev-records">
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
        </article>

        <article className="panel osint-feed-panel">
          <div className="panel-heading"><div><div className="panel-title">Cyber news pulse</div><small>Hacker News · community discussion</small></div><data value={newsItems.length}>{String(newsItems.length).padStart(2, '0')}</data></div>
          <div className="osint-list" id="news-records">
            {newsItems.length ? newsItems.map((item) => (
              <a href={item.url} key={item.id} rel="noreferrer" target="_blank">
                <div className="feed-meta"><strong>Discussion</strong><span>Published {new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                <p>{item.title}</p>
                <small>By {item.author} · {item.points} points</small>
                <em>Open discussion record <span aria-hidden="true">↗</span><span className="sr-only">(opens in a new tab)</span></em>
              </a>
            )) : <p className="empty-feed">{search && allNews.length ? 'No discussions match this search.' : emptyFeedMessage('cyber news', liveIntel?.sources[1]?.status, state.isRefreshing, Boolean(state.error))}</p>}
          </div>
        </article>

        <article className="panel source-health-panel">
          <div><div className="panel-title">Source health</div><p className="source-caption">Checked independently</p></div>
          {(liveIntel?.sources ?? []).map((source) => (
            <div className="source-row" key={source.name}>
              <span className={state.error ? 'stale' : source.status}>{state.error ? 'unverified' : source.status === 'ok' ? 'Available' : source.status}</span>
              <strong>{source.name}</strong>
              <small>{source.message ?? `${source.count} records received`}{source.lastSuccessAt && ` · Last successful refresh: ${formatTimestamp(source.lastSuccessAt)}`}</small>
            </div>
          ))}
          {!liveIntel && <p className="empty-feed">{state.isRefreshing ? 'Connecting to public sources.' : 'Source health is unavailable until a request succeeds.'}</p>}
        </article>
      </div>
      <div className="data-boundary"><span>How live is live?</span><p>These feeds are periodically checked, not streamed. Upstream publication and search indexing can lag. Checks pause when this tab is hidden or offline and resume when you return. No private network traffic is collected.</p></div>
    </section>
  )
}
