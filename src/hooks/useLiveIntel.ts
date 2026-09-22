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
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (document.hidden) client.pause()
    else void client.refresh()
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      client.stop()
      if (poller.current === client) poller.current = null
    }
  }, [])

  const refresh = useCallback(() => { void poller.current?.refresh() }, [])
  return { ...state, refresh }
}
