(() => {
  const preview = 'http://127.0.0.1:5173/'
  const status = document.getElementById('launch-status')
  const retry = document.getElementById('retry')
  const link = document.getElementById('open-preview')
  if (!status || !retry || !link) return
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    status.textContent = 'Open this project locally to use the preview launcher.'
    retry.hidden = true
    link.hidden = true
    return
  }
  const destination = preview + location.hash
  link.href = destination
  let active = false
  let generation = 0
  let pendingController
  window.addEventListener('pagehide', () => {
    generation += 1
    pendingController?.abort()
    active = false
    retry.disabled = false
  })
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void connect()
  })

  async function connect() {
    if (active) return
    active = true
    const current = generation
    retry.disabled = true
    status.textContent = 'Checking the local preview…'
    try {
      for (let attempt = 0; attempt < 30 && current === generation; attempt += 1) {
        const controller = new AbortController()
        pendingController = controller
        const timeout = setTimeout(() => controller.abort(), 2000)
        let ready = false
        try {
          const response = await fetch(preview, {
            signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
          })
          if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
            const html = await response.text()
            ready = html.includes('<title>Cyber Intelligence Lab</title>') && html.includes('/@vite/client')
          }
        } catch { /* A stopped server is expected; keep the startup steps visible. */ }
        finally { clearTimeout(timeout) }
        if (current !== generation) return
        if (ready) {
          status.textContent = 'Preview ready. Opening the lab…'
          location.replace(destination)
          return
        }
        if (attempt === 0) status.textContent = 'The preview is not ready. Start the server using the steps below; this page will check again.'
        if (attempt < 29) await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      if (current === generation) status.textContent = 'The preview is still unavailable. Start the server, then choose Retry connection.'
    } finally {
      if (current === generation) {
        pendingController = undefined
        active = false
        retry.disabled = false
      }
    }
  }
  retry.addEventListener('click', connect)
  void connect()
})()
