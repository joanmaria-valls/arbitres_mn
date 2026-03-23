import { useState } from 'react'
import { Button } from './ui'
import { Modal } from './Modal'

export function InfoButton(props: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setOpen(true)}
        style={props.compact ? { minWidth: 92, justifyContent: 'center' } : undefined}
      >
        Inf.
      </Button>
      <Modal open={open} title="Informació" onClose={() => setOpen(false)}>
        <div style={{ display: 'grid', gap: 10, lineHeight: 1.45 }}>
          <div><b>Idea original:</b> Joan-Maria Valls i Prats</div>
          <div><b>Creació:</b> Joan-Maria Valls i Prats amb eines d'I.A. -març 2026-</div>
          <div>Per a l'ús exclusiu per part d'àrbitres de marxa nòrdica.</div>
        </div>
      </Modal>
    </>
  )
}
