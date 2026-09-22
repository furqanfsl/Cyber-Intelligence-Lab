export function nextTab<T extends string>(tabs: readonly T[], current: T, key: string): T | undefined {
  const index = tabs.indexOf(current)
  if (!tabs.length || index < 0) return undefined
  if (key === 'Home') return tabs[0]
  if (key === 'End') return tabs[tabs.length - 1]
  if (key === 'ArrowRight') return tabs[(index + 1) % tabs.length]
  if (key === 'ArrowLeft') return tabs[(index + tabs.length - 1) % tabs.length]
  return undefined
}
