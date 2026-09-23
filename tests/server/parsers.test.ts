import assert from 'node:assert/strict'
import test from 'node:test'
import { cisaCatalogSearchUrl, mergeNews, parseAdvisories, parseKev, parseNews } from '../../server/parsers.ts'
import { advisoryRecord, kevRecord, newsRecord } from './fixtures.ts'

test('CISA rejects malformed envelopes rather than reporting a healthy empty source', () => {
  for (const value of [null, [], true, 'html', {}, { vulnerabilities: {} }]) {
    assert.throws(() => parseKev(value), /Invalid CISA response/)
  }
  assert.deepEqual(parseKev({ vulnerabilities: [] }), [])
})

test('CISA drops invalid rows and safely defaults optional fields', () => {
  const [item] = parseKev({ vulnerabilities: [null, 42, kevRecord({ cveID: 'unsafe' }), kevRecord({
    cveID: ' cve-2026-12345 ', vulnerabilityName: '', shortDescription: '  Verified description  ',
    vendorProject: {}, product: null, dueDate: '2026-02-30', knownRansomwareCampaignUse: 5,
  })] })
  assert.equal(item.id, 'CVE-2026-12345')
  assert.equal(item.title, 'Verified description')
  assert.equal(item.vendor, 'Unknown vendor')
  assert.equal(item.product, 'Unknown product')
  assert.equal(item.dueDate, 'Unknown')
  assert.equal(item.ransomwareUse, 'Unknown')
})

test('CISA requires real calendar dates and stable CVE identifiers', () => {
  for (const dateAdded of ['2026-02-29', '2026-13-01', 'yesterday', '', undefined]) {
    assert.throws(() => parseKev({ vulnerabilities: [kevRecord({ dateAdded })] }), /No valid CISA records/)
  }
  for (const cveID of [undefined, 'CVE-2026-123', 'javascript:alert(1)', 'CVE-2026-12345&x=1']) {
    assert.throws(() => parseKev({ vulnerabilities: [kevRecord({ cveID })] }), /No valid CISA records/)
  }
  assert.equal(parseKev({ vulnerabilities: [kevRecord({ dateAdded: '2024-02-29' })] })[0].dateAdded, '2024-02-29')
})

test('CISA sorts, deduplicates and caps without changing upstream records', () => {
  const records = Array.from({ length: 10 }, (_, index) => kevRecord({ cveID: `CVE-2026-${1000 + index}`, dateAdded: `2026-09-${10 + index}` }))
  const original = structuredClone(records)
  const result = parseKev({ vulnerabilities: [...records, records[9]] })
  assert.equal(result.length, 8)
  assert.equal(result[0].id, 'CVE-2026-1009')
  assert.equal(new Set(result.map((item) => item.id)).size, 8)
  assert.deepEqual(records, original)
})

test('CISA links use a stable official catalog search, not untrusted notes', () => {
  const [item] = parseKev({ vulnerabilities: [kevRecord({ notes: 'javascript:alert(1)' })] })
  const url = new URL(item.url)
  assert.equal(url.origin, 'https://www.cisa.gov')
  assert.equal(url.searchParams.get('search_api_fulltext'), item.id)
  assert.equal(cisaCatalogSearchUrl(item.id), item.url)
})

test('news rejects malformed envelopes and wholly invalid rows', () => {
  for (const value of [null, [], true, {}, { hits: 'not an array' }]) {
    assert.throws(() => parseNews(value), /Invalid news response/)
  }
  assert.throws(() => parseNews({ hits: [null, {}, 7] }), /No valid news records/)
  assert.deepEqual(parseNews({ hits: [] }), [])
})

test('news accepts only stable positive numeric record IDs', () => {
  for (const objectID of [undefined, 123, '', '0', '-1', '1&x=2', '01', '1'.repeat(21)]) {
    assert.throws(() => parseNews({ hits: [newsRecord({ objectID })] }), /No valid news records/)
  }
  assert.equal(parseNews({ hits: [newsRecord({ objectID: ' 12345 ' })] })[0].id, '12345')
})

test('news uses text fallbacks and ignores unsafe upstream URLs', () => {
  const [item] = parseNews({ hits: [newsRecord({ title: '', story_title: ' Fallback title ', author: {}, url: 'javascript:alert(1)' })] })
  assert.equal(item.title, 'Fallback title')
  assert.equal(item.author, 'unknown')
  assert.equal(item.url, 'https://news.ycombinator.com/item?id=12345')
})

test('news validates timestamp dates and normalizes timezone offsets', () => {
  for (const created_at of [undefined, 'yesterday', '2026-02-30T12:00:00Z', '2026-09-20T12:00:00', '2026-09-20T99:00:00Z']) {
    assert.throws(() => parseNews({ hits: [newsRecord({ created_at })] }), /No valid news records/)
  }
  const [item] = parseNews({ hits: [newsRecord({ created_at: '2026-09-20T12:30:00+01:00' })] })
  assert.equal(item.createdAt, '2026-09-20T11:30:00.000Z')
})

test('news timestamps reject clock rollover while retaining valid subsecond and offset precision', () => {
  for (const created_at of ['2026-09-20T24:00:00Z', '2026-09-20T12:60:00Z', '2026-09-20T12:00:60Z', '2026-09-20T12:00Z', '2026-09-20T12:00:00+24:00']) {
    assert.throws(() => parseNews({ hits: [newsRecord({ created_at })] }), /No valid news records/)
  }
  const [item] = parseNews({ hits: [newsRecord({ created_at: '2026-09-20T00:30:00.123456+01:00' })] })
  assert.equal(item.createdAt, '2026-09-19T23:30:00.123Z')
})

test('news requires a nonempty title and normalizes invalid point counts', () => {
  assert.throws(() => parseNews({ hits: [newsRecord({ title: ' ' })] }), /No valid news records/)
  for (const points of ['42', -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, {}]) {
    assert.equal(parseNews({ hits: [newsRecord({ points })] })[0].points, 0)
  }
  assert.equal(parseNews({ hits: [newsRecord({ title: 'x'.repeat(2_000) })] })[0].title.length, 1_000)
})

test('display text truncation preserves full Unicode code points at the limit', () => {
  const title = `${'x'.repeat(999)}\ud83d\udd10tail`
  const expected = `${'x'.repeat(999)}\ud83d\udd10`
  const [news] = parseNews({ hits: [newsRecord({ title })] })
  const [kev] = parseKev({ vulnerabilities: [kevRecord({ vulnerabilityName: title, vendorProject: '\ud83d\udd10'.repeat(1_001) })] })
  assert.equal(news.title, expected)
  assert.equal(kev.title, expected)
  assert.equal(Array.from(kev.vendor).length, 1_000)
  assert.equal(new TextDecoder().decode(new TextEncoder().encode(kev.vendor)), kev.vendor)
  assert.equal(new TextDecoder().decode(new TextEncoder().encode(news.title)), news.title)
})

test('plain feed labels normalize whitespace and remove invisible control overrides', () => {
  const [news] = parseNews({ hits: [newsRecord({ title: ' Alert\r\n\t\u202efile.exe\u202c\u0000 ', author: '\u0000\u202e ' })] })
  assert.equal(news.title, 'Alert file.exe')
  assert.equal(news.author, 'unknown')
  const [kev] = parseKev({ vulnerabilities: [kevRecord({
    vulnerabilityName: '\u0000\u202e', shortDescription: 'Useful\t fallback', product: 'Safe\u2066 name\u2069',
  })] })
  assert.equal(kev.title, 'Useful fallback')
  assert.equal(kev.product, 'Safe name')
  assert.throws(() => parseNews({ hits: [newsRecord({ title: '\u0000\u202e' })] }), /No valid news records/)
})

test('record identifiers are validated intact rather than sanitized or truncated into new IDs', () => {
  for (const cveID of [`CVE-2026-${'1'.repeat(56)}`, `CVE-2026-${'1'.repeat(1_100)}`, 'CVE-2026-\u202e12345', 'CVE-2026-12\u0000345']) {
    assert.throws(() => parseKev({ vulnerabilities: [kevRecord({ cveID })] }), /No valid CISA records/)
  }
  const longest = `CVE-2026-${'1'.repeat(55)}`
  assert.equal(parseKev({ vulnerabilities: [kevRecord({ cveID: longest })] })[0].id, longest)
  for (const objectID of ['12\u0000345', '\u202e12345', '123 45']) {
    assert.throws(() => parseNews({ hits: [newsRecord({ objectID })] }), /No valid news records/)
  }
})

test('news query normalization drops malformed records and bounds results', () => {
  const hits = Array.from({ length: 9 }, (_, index) => newsRecord({ objectID: String(100 + index), created_at: `2026-09-${10 + index}T12:00:00Z` }))
  const items = parseNews({ hits: [null, {}, ...hits, hits[8]] })
  assert.equal(items.length, 6)
  assert.equal(items[0].id, '108')
  assert.equal(new Set(items.map((item) => item.id)).size, 6)
})

test('combined news prioritizes freshest results across queries before dedupe and limit', () => {
  const group = (firstId: number, day: number) => parseNews({ hits: Array.from({ length: 6 }, (_, index) => newsRecord({ objectID: String(firstId + index), created_at: `2026-09-${day}T12:00:00Z` })) })
  const oldest = group(100, 10)
  const middle = group(200, 15)
  const newest = group(300, 20)
  const original = structuredClone([oldest, middle, newest])
  const result = mergeNews([oldest, middle, newest, newest])
  assert.equal(result.length, 12)
  assert.ok(result.every((item) => Number(item.id) >= 200))
  assert.equal(new Set(result.map((item) => item.id)).size, 12)
  assert.deepEqual([oldest, middle, newest], original)
})

test('equal-date limit boundaries stay deterministic when source order changes', () => {
  const vulnerabilities = Array.from({ length: 10 }, (_, index) => kevRecord({ cveID: `CVE-2026-${1000 + index}` }))
  const expectedKev = Array.from({ length: 8 }, (_, index) => `CVE-2026-${1000 + index}`)
  assert.deepEqual(parseKev({ vulnerabilities }).map((item) => item.id), expectedKev)
  assert.deepEqual(parseKev({ vulnerabilities: vulnerabilities.toReversed() }).map((item) => item.id), expectedKev)
  const groups = [0, 1, 2].map((group) => parseNews({
    hits: Array.from({ length: 6 }, (_, index) => newsRecord({ objectID: String(100 + group * 6 + index) })).reverse(),
  }))
  const expectedNews = Array.from({ length: 12 }, (_, index) => String(100 + index))
  assert.deepEqual(mergeNews(groups).map((item) => item.id), expectedNews)
  assert.deepEqual(mergeNews(groups.toReversed().map((group) => group.toReversed())).map((item) => item.id), expectedNews)
})

test('MSRC rejects malformed envelopes and wholly invalid rows but accepts a genuine empty index', () => {
  for (const data of [null, [], true, {}, { value: {} }, { value: 'not an array' }]) {
    assert.throws(() => parseAdvisories(data), /Invalid MSRC response/)
  }
  assert.throws(() => parseAdvisories({ value: [null, {}, 5] }), /No valid MSRC records/)
  assert.deepEqual(parseAdvisories({ value: [] }), [])
})

test('MSRC validates release IDs and constructs official human links instead of following upstream URLs', () => {
  for (const ID of ['2026-Sep', '2018-FEB', '2017-May-B']) {
    const [item] = parseAdvisories({ value: [advisoryRecord({ ID, CvrfUrl: 'https://attacker.example/internal' })] })
    assert.equal(item.id, ID)
    assert.equal(item.url, `https://msrc.microsoft.com/update-guide/releaseNote/${ID}`)
  }
  for (const ID of [undefined, 202609, '', '2026-13', '2026-January', '../2026-Sep', '2026-Sep#bad', '2026-Sep/child', '2026-S\u202eep', '2026-Se\u0000p', '2026-Sep-AA']) {
    assert.throws(() => parseAdvisories({ value: [advisoryRecord({ ID })] }), /No valid MSRC records/)
  }
})

test('MSRC requires valid explicit timestamps in chronological order', () => {
  for (const value of [undefined, 'yesterday', '2026-02-30T00:00:00Z', '2026-09-20T24:00:00Z', '2026-09-20T12:00:00', '2026-09-20T12:00:00+24:00']) {
    for (const field of ['InitialReleaseDate', 'CurrentReleaseDate']) {
      assert.throws(() => parseAdvisories({ value: [advisoryRecord({ [field]: value })] }), /No valid MSRC records/)
    }
  }
  assert.throws(() => parseAdvisories({ value: [advisoryRecord({ CurrentReleaseDate: '2026-09-01T00:00:00Z' })] }), /No valid MSRC records/)
  const [item] = parseAdvisories({ value: [advisoryRecord({ InitialReleaseDate: '2026-09-08T08:00:00+01:00', CurrentReleaseDate: '2026-09-08T07:00:00Z' })] })
  assert.equal(item.publishedAt, '2026-09-08T07:00:00.000Z')
  assert.equal(item.updatedAt, item.publishedAt)
})

test('MSRC requires meaningful titles, normalizes unsafe controls, and drops only invalid rows', () => {
  for (const DocumentTitle of [undefined, {}, '', ' \u202e\u0000 ']) {
    assert.throws(() => parseAdvisories({ value: [advisoryRecord({ DocumentTitle })] }), /No valid MSRC records/)
  }
  const [item] = parseAdvisories({ value: [null, advisoryRecord({ ID: 'unsafe' }), advisoryRecord({ DocumentTitle: ' September\r\n\t\u202e2026\u202c updates\u0000 ' })] })
  assert.equal(item.title, 'September 2026 updates')
  assert.equal(parseAdvisories({ value: [advisoryRecord({ DocumentTitle: 'x'.repeat(1_001) })] })[0].title.length, 1_000)
})

test('MSRC sorts by revision date, deduplicates release IDs case-insensitively, and caps eight without mutating input', () => {
  const value = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((month, index) => advisoryRecord({
    ID: `2026-${month}`, InitialReleaseDate: '2026-01-01T00:00:00Z', CurrentReleaseDate: `2026-09-${String(index + 10).padStart(2, '0')}T00:00:00Z`,
  }))
  const original = structuredClone(value)
  const result = parseAdvisories({ value: [...value, advisoryRecord({ ID: '2026-SEP', InitialReleaseDate: '2026-01-01T00:00:00Z', CurrentReleaseDate: '2026-09-20T00:00:00Z' })] })
  assert.equal(result.length, 8)
  assert.equal(result[0].id, '2026-SEP')
  assert.equal(result[1].id, '2026-Oct')
  assert.equal(new Set(result.map((item) => item.id.toLowerCase())).size, 8)
  assert.deepEqual(value, original)
  const ties = value.map((item) => ({ ...item, CurrentReleaseDate: '2026-09-22T00:00:00Z' }))
  assert.deepEqual(parseAdvisories({ value: ties }), parseAdvisories({ value: ties.toReversed() }))
})
