import { useMemo, useState } from 'react'
import { Button, Card, Pill } from '../components/ui'
import { InfoButton } from '../components/AppInfo'
import { joinCompetition } from '../lib/api'
import type { Session } from '../types'

export function PrincipalJoinPage(props: {
  initialCode?: string
  initialToken?: string
  initialName?: string
  onJoined: (s: Session) => void
}) {
  const code = (props.initialCode || '').trim().toUpperCase()
  const token = (props.initialToken || '').trim()
  const name = (props.initialName || 'Principal').trim()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const canEnter = code.length >= 4 && token.length >= 6 && name.length >= 2

  const summary = useMemo(() => ({ code, tokenMasked: token ? `${token.slice(0, 4)}…${token.slice(-4)}` : '' , name}), [code, token, name])

  const submit = async () => {
    if (!canEnter) {
      setErr('Falten dades de l’enllaç del principal.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const s = await joinCompetition(code, token, name)
      props.onJoined(s)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 900, fontSize: 22 }}>FaltesMN (CAT)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Pill>Accés Principal</Pill><InfoButton compact /></div>
      </div>

      <div style={{ height: 12 }} />

      <Card title="Entrada del Principal a la competició">
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 800 }}>Codi competició: <span style={{ color: '#1f2937' }}>{summary.code || '—'}</span></div>
          <div style={{ color: '#4b5563' }}>Token del principal: {summary.tokenMasked || '—'}</div>
          <div style={{ color: '#4b5563' }}>Nom: {summary.name}</div>

          {err ? <div style={{ color: '#b91c1c', fontWeight: 700 }}>{err}</div> : null}

          <Button onClick={submit} disabled={!canEnter || busy}>
            {busy ? 'Entrant…' : 'Entrar al panell del principal'}
          </Button>

          <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.35 }}>
            Aquesta entrada és específica per al QR del Principal. Si no entra, aquí t’hauria de mostrar un error clar en lloc de quedar-se penjat.
          </div>
        </div>
      </Card>
    </div>
  )
}
