type VisibilityTarget = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>
type TimerOptions = { schedule?: typeof setInterval; cancel?: typeof clearInterval }

/** Run an opt-in interval only while its page is visible. Disposal never resumes it. */
export function createVisibleInterval(callback: () => void, delay: number, target: VisibilityTarget, { schedule = setInterval, cancel = clearInterval }: TimerOptions = {}) {
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  let generation = 0
  function clear() {
    generation++
    if (timer !== undefined) cancel(timer)
    timer = undefined
  }
  function sync() {
    clear()
    if (!disposed && !target.hidden) {
      const activeGeneration = generation
      timer = schedule(() => {
        if (!disposed && !target.hidden && generation === activeGeneration) callback()
      }, delay)
    }
  }
  target.addEventListener('visibilitychange', sync)
  sync()
  return () => {
    disposed = true
    clear()
    target.removeEventListener('visibilitychange', sync)
  }
}
