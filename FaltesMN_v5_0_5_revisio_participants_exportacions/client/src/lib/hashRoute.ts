import { useEffect, useMemo, useState } from 'react'

export type Route = {
  path: string
  query: Record<string, string>
}

function parseHash(): Route {
  const hash = window.location.hash || '#/'
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  const [pathPart, queryPart] = h.split('?')
  const path = pathPart || '/'
  const query: Record<string, string> = {}
  if (queryPart) {
    const usp = new URLSearchParams(queryPart)
    usp.forEach((v, k) => {
      query[k] = v
    })
  }
  return { path, query }
}

export function useHashRoute(): Route {
  const [r, setR] = useState<Route>(() => parseHash())

  useEffect(() => {
    const on = () => setR(parseHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  return useMemo(() => r, [r.path, JSON.stringify(r.query)])
}

export function navigate(path: string, query?: Record<string, string | number | undefined>) {
  const usp = new URLSearchParams()
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue
      usp.set(k, String(v))
    }
  }
  const q = usp.toString()
  window.location.hash = q ? `#${path}?${q}` : `#${path}`
}
