import { useEffect, useState } from 'react'

type WakeLockSentinelLike = {
  release: () => Promise<void>
  addEventListener?: (type: string, listener: () => void) => void
}

export function useWakeLock(active: boolean) {
  const [supported, setSupported] = useState<boolean>(() => typeof navigator !== 'undefined' && 'wakeLock' in navigator)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && 'wakeLock' in navigator)
  }, [])

  useEffect(() => {
    if (!active || !supported) {
      setEnabled(false)
      return
    }

    let released = false
    let sentinel: WakeLockSentinelLike | null = null

    const acquire = async () => {
      try {
        if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
        sentinel = await (navigator as any).wakeLock.request('screen')
        if (released) {
          await sentinel?.release?.().catch(() => undefined)
          return
        }
        setEnabled(true)
        sentinel?.addEventListener?.('release', () => {
          setEnabled(false)
        })
      } catch {
        setEnabled(false)
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire().catch(() => undefined)
    }

    acquire().catch(() => undefined)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisibility)
      setEnabled(false)
      sentinel?.release?.().catch(() => undefined)
    }
  }, [active, supported])

  return { supported, enabled }
}
