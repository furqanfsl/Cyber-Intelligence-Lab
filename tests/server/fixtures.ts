export function kevRecord(overrides: Record<string, unknown> = {}) {
  return {
    cveID: 'CVE-2026-12345',
    vulnerabilityName: 'Example vulnerability',
    vendorProject: 'Example vendor',
    product: 'Example product',
    dateAdded: '2026-09-20',
    dueDate: '2026-10-11',
    knownRansomwareCampaignUse: 'Unknown',
    ...overrides,
  }
}

export function newsRecord(overrides: Record<string, unknown> = {}) {
  return {
    objectID: '12345',
    title: 'Example defensive security story',
    author: 'example',
    points: 42,
    created_at: '2026-09-20T12:30:00Z',
    ...overrides,
  }
}
