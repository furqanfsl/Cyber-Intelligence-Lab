import { useEffect, useState } from 'react'

const preferenceKey = 'cil-motion'
const revealSelector = '.reveal, .panel, .case-row, .skills-grid article'

function readPreference() {
  try {
    return localStorage.getItem(preferenceKey) !== 'off'
  } catch {
    // Storage can be disabled in private or restricted browsing contexts.
    return true
  }
}

/** Decorative motion is independent from the opt-in incident simulation. */
export function useLabMotion() {
  const [preferred, setPreferred] = useState(readPreference)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [hidden, setHidden] = useState(() => document.hidden)
  const enabled = preferred && !reduced

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMedia = () => setReduced(media.matches)
    const onVisibility = () => setHidden(document.hidden)
    const onStorage = (event: StorageEvent) => {
      if (event.key === preferenceKey || event.key === null) setPreferred(readPreference())
    }
    media.addEventListener('change', onMedia)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('storage', onStorage)
    return () => {
      media.removeEventListener('change', onMedia)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.labMotion = enabled ? 'on' : 'off'
    return () => { delete document.documentElement.dataset.labMotion }
  }, [enabled])

  useEffect(() => {
    const elements = [...document.querySelectorAll<HTMLElement>(revealSelector)]
    if (!enabled || !('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('is-visible'))
      return
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      })
    }, { rootMargin: '0px 0px 40px 0px', threshold: 0 })

    elements.forEach((element) => {
      // Never gate a whole grid (including tall mobile grids) behind its children.
      // Fixed/sticky controls also must not acquire a transformed containing block.
      const position = getComputedStyle(element).position
      if (element.querySelector(revealSelector) || position === 'sticky' || position === 'fixed') {
        element.classList.add('is-visible')
        return
      }
      element.classList.add('lab-reveal')
      observer.observe(element)
    })

    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return
      let element: Element | null = event.target
      while (element) {
        if (element.matches(revealSelector)) {
          element.classList.add('is-visible', 'lab-focus-visible')
          observer.unobserve(element)
        }
        element = element.parentElement
      }
    }
    document.addEventListener('focusin', onFocus)
    return () => {
      observer.disconnect()
      document.removeEventListener('focusin', onFocus)
    }
  }, [enabled])

  function toggle() {
    if (reduced) return
    const next = !preferred
    setPreferred(next)
    try {
      localStorage.setItem(preferenceKey, next ? 'on' : 'off')
    } catch {
      // The current-session control still works without persistence.
    }
  }

  return { enabled, reduced, hidden, toggle }
}
