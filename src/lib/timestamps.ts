type TimestampOptions = { locale?: string; timeZone?: string }

/** Absolute source timestamps displayed in the browser's zone with an explicit UTC offset. */
export function formatTimestamp(value: unknown, { locale, timeZone }: TimestampOptions = {}): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return 'Time unavailable'
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return 'Time unavailable'
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
