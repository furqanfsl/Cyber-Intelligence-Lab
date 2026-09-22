type TimestampOptions = { locale?: string; timeZone?: string }

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value
}

/** Absolute source timestamps displayed in the browser's zone with an explicit UTC offset. */
export function formatTimestamp(value: unknown, { locale, timeZone }: TimestampOptions = {}): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return 'Time unavailable'
  if (!isCalendarDate(value.slice(0, 10))) return 'Time unavailable'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Time unavailable'
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone, timeZoneName: 'shortOffset',
    }).format(date)
  } catch {
    return 'Time unavailable'
  }
}
