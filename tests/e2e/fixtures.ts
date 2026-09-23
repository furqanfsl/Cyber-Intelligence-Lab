import type { LiveIntelPayload } from '../../shared/live-intel.ts'

export const intelligence: LiveIntelPayload = {
  generatedAt: '2026-09-22T12:00:00.000Z',
  pollAfterMs: 60_000,
  cacheTtlMs: 60_000,
  sources: [
    { name: 'CISA Known Exploited Vulnerabilities', status: 'ok', count: 1 },
    { name: 'Hacker News Algolia cyber search', status: 'ok', count: 1 },
    { name: 'Microsoft Security Response Center', status: 'ok', count: 1 },
  ],
  kev: [{
    id: 'CVE-2026-12345', title: 'Example vulnerability record', vendor: 'Example vendor',
    product: 'Example product', dateAdded: '2026-09-21', dueDate: '2026-10-01',
    ransomwareUse: 'Unknown', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=CVE-2026-12345',
  }],
  advisories: [{
    id: '2026-Sep', title: 'September 2026 Security Updates',
    publishedAt: '2026-09-08T07:00:00.000Z', updatedAt: '2026-09-22T07:00:00.000Z',
    url: 'https://msrc.microsoft.com/update-guide/releaseNote/2026-Sep',
  }],
  news: [{
    id: '12345678', title: 'Example defensive security discussion',
    url: 'https://news.ycombinator.com/item?id=12345678', source: 'Hacker News',
    author: 'example-author', points: 12, createdAt: '2026-09-22T11:00:00.000Z',
  }],
}
