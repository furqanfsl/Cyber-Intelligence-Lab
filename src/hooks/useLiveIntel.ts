import { useCallback, useEffect, useRef, useState } from 'react'
import { createIntelPoller, initialIntelState } from '../lib/live-intel'

export function useLiveIntel() {
  const [state, setState] = useState(initialIntelState)
  const poller = useRef<ReturnType<typeof createIntelPoller> | null>(null)

  useEffect(() => {
    const client = createIntelPoller({ onChange: setState })
    poller.current = client
    void client.refresh()
    return () => {
      client.stop()
      if (poller.current === client) poller.current = null
    }
  }, [])

  const refresh = useCallback(() => { void poller.current?.refresh() }, [])
  return { ...state, refresh }
}
