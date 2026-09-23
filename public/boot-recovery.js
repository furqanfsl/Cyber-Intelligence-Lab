/* Standalone, dependency-free recovery: this must work even if the app module fails. */
(() => {
  const root = document.getElementById('root')
  const boot = document.getElementById('lab-boot')
  if (!root || !boot) return
  boot.dataset.bootState = 'waiting'

  let timer
  let observer
  const isWaiting = () => root.contains(boot)
  const showRecovery = (failed) => {
    if (!isWaiting()) return
    if (!failed && boot.dataset.bootState === 'failed') return
    if (failed) clearTimeout(timer)
    boot.dataset.bootState = failed ? 'failed' : 'slow'
    document.getElementById('boot-title').textContent = failed
      ? "The lab couldn't start"
      : 'The lab is taking longer to open'
    document.getElementById('boot-message').textContent = failed
      ? 'Part of the application failed to load. Reload the page to try again.'
      : 'The interface has not finished loading. You can wait, or reload to try again.'
    document.getElementById('boot-actions').hidden = false
    const help = document.getElementById('boot-help')
    help.hidden = false
    if (['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) && location.port === '5500') {
      const direct = document.getElementById('boot-direct')
      const url = new URL('/', location.href)
      url.protocol = 'http:'
      url.port = '5173'
      direct.href = url.href
      direct.hidden = false
      help.textContent = 'Keep Vite running with npm run dev. If Go Live cannot connect, try the Vite preview directly.'
    }
  }
  const onError = (event) => {
    if (event instanceof ErrorEvent || event.target instanceof HTMLScriptElement) showRecovery(true)
  }
  const onRejection = () => showRecovery(true)
  const stop = () => {
    clearTimeout(timer)
    observer.disconnect()
    window.removeEventListener('error', onError, true)
    window.removeEventListener('unhandledrejection', onRejection)
  }

  document.getElementById('boot-reload').addEventListener('click', (event) => {
    event.preventDefault()
    location.reload()
  })
  window.addEventListener('error', onError, true)
  window.addEventListener('unhandledrejection', onRejection)
  // Start now, not on DOMContentLoaded: a stalled module can delay that event.
  timer = setTimeout(() => showRecovery(false), 8000)
  observer = new MutationObserver(() => { if (!isWaiting()) stop() })
  observer.observe(root, { childList: true })
})()
