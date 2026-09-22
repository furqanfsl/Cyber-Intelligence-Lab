import { useCallback, useEffect, useRef, useState } from 'react'
import { createIntelPoller, initialIntelState } from '../lib/live-intel'

export function useLiveIntel() {
  const [state, setState] = useState(initialIntelState)
  const poller = useRef<ReturnType<typeof createIntelPoller> | null>(null)

  useEffect(() => {
    const client = createIntelPoller({ onChange: setState })
    poller.current = client
    const onVisibilityChange = () => {
      if (document.hidden) client.pause()
      else client.resume()
    }
    const onOnline = () => client.setOnline(true)
    const onOffline = () => client.setOnline(false)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    if (document.hidden) client.pause()
    client.setOnline(navigator.onLine)
    if (!document.hidden) void client.refresh()
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      client.stop()
      if (poller.current === client) poller.current = null
    }
  }, [])

  const refresh = useCallback(() => { void poller.current?.refresh() }, [])
  return { ...state, refresh }
}
