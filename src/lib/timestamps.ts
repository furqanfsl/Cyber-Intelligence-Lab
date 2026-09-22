type TimestampOptions = { locale?: string; timeZone?: string }

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value
}

export function isAbsoluteTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return false
  return isCalendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value))
}

/** Absolute source timestamps displayed in the browser's zone with an explicit UTC offset. */
export function formatTimestamp(value: unknown, { locale, timeZone }: TimestampOptions = {}): string {
  if (!isAbsoluteTimestamp(value)) return 'Time unavailable'
  const date = new Date(value)
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
