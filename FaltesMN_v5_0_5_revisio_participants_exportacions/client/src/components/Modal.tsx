import type { ReactNode } from 'react'
import { Button } from './ui'

export function Modal(props: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  actions?: ReactNode
  showCloseButton?: boolean
  maxWidth?: string | number
}) {
  if (!props.open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '14px 14px max(14px, env(safe-area-inset-bottom))',
        overflowY: 'auto',
        zIndex: 999
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div
        style={{
          width: typeof props.maxWidth === 'number' ? `min(${props.maxWidth}px, 100%)` : (props.maxWidth || 'min(920px, 100%)'),
          maxHeight: 'calc(100dvh - 28px)',
          overflowY: 'auto',
          background: 'white',
          borderRadius: 14,
          border: '1px solid #e5e7eb',
          padding: 14,
          boxSizing: 'border-box'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', position: 'sticky', top: 0, background: 'white', paddingBottom: 8, zIndex: 2 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>{props.title}</div>
          {props.showCloseButton === false ? <div /> : (
            <Button variant="secondary" onClick={props.onClose}>
              Tanca
            </Button>
          )}
        </div>
        <div style={{ marginTop: 12 }}>{props.children}</div>
        {props.actions ? <div style={{ marginTop: 14 }}>{props.actions}</div> : null}
      </div>
    </div>
  )
}
