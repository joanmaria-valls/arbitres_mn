import { useEffect } from 'react'

export type ToastItem = { id: string; text: string; kind?: 'info' | 'warn' | 'danger' }

export function Toasts(props: { items: ToastItem[]; onRemove: (id: string) => void }) {
  useEffect(() => {
    const timers = props.items.map((t) =>
      setTimeout(() => {
        props.onRemove(t.id)
      }, t.kind === 'danger' ? 6500 : 4500)
    )
    return () => timers.forEach(clearTimeout)
  }, [props.items])

  return (
    <div style={{ position: 'fixed', bottom: 14, left: 14, right: 14, zIndex: 9999, display: 'grid', gap: 10 }}>
      {props.items.map((t) => {
        const bg = t.kind === 'danger' ? '#fee2e2' : t.kind === 'warn' ? '#fef9c3' : '#e0f2fe'
        const fg = '#111827'
        return (
          <div
            key={t.id}
            style={{
              background: bg,
              color: fg,
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: '10px 12px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
              fontWeight: 700
            }}
          >
            {t.text}
          </div>
        )
      })}
    </div>
  )
}
