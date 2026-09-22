type VisibilityTarget = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>
type TimerOptions = { schedule?: typeof setInterval; cancel?: typeof clearInterval }

/** Run an opt-in interval only while its page is visible. Disposal never resumes it. */
export function createVisibleInterval(callback: () => void, delay: number, target: VisibilityTarget, { schedule = setInterval, cancel = clearInterval }: TimerOptions = {}) {
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  function clear() {
    if (timer !== undefined) cancel(timer)
    timer = undefined
  }
  function sync() {
    clear()
    if (!disposed && !target.hidden) timer = schedule(callback, delay)
  }
  target.addEventListener('visibilitychange', sync)
  sync()
  return () => {
    disposed = true
    clear()
    target.removeEventListener('visibilitychange', sync)
  }
}
