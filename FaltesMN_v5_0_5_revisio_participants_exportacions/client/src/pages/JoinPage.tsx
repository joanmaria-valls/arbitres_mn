import { useEffect, useState } from 'react'
import { Button, Card, Input, Pill } from '../components/ui'
import { InfoButton } from '../components/AppInfo'
import { joinCompetition } from '../lib/api'
import type { Session } from '../types'

export function JoinPage(props: {
  initialCode?: string
  initialToken?: string
  initialName?: string
  onJoined: (s: Session) => void
}) {
  const [code, setCode] = useState(props.initialCode || '')
  const [token, setToken] = useState(props.initialToken || '')
  const [name, setName] = useState(props.initialName || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [autoSubmitDone, setAutoSubmitDone] = useState(false)

  useEffect(() => {
    if (props.initialCode) setCode(props.initialCode)
    if (props.initialToken) setToken(props.initialToken)
    if (props.initialName) setName(props.initialName)
  }, [props.initialCode, props.initialToken, props.initialName])

  const canSubmit = code.trim().length >= 4 && token.trim().length >= 6 && name.trim().length >= 2

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const s = await joinCompetition(code.trim().toUpperCase(), token.trim(), name.trim())
      props.onJoined(s)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }


  useEffect(() => {
    const hasPrefilledEntry = Boolean(props.initialCode && props.initialToken && props.initialName)
    if (!hasPrefilledEntry || autoSubmitDone || busy) return
    if (!(code.trim().length >= 4 && token.trim().length >= 6 && name.trim().length >= 2)) return
    setAutoSubmitDone(true)
    void submit()
  }, [props.initialCode, props.initialToken, props.initialName, code, token, name, autoSubmitDone, busy])

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 900, fontSize: 22 }}>FaltesMN (CAT)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Pill>Entrada a competició</Pill><InfoButton compact /></div>
      </div>

      <div style={{ height: 12 }} />

      <Card title="Entra a una competició">
        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Codi competició</div>
            <Input value={code} onChange={setCode} placeholder="Ex: A1B2C3" />
          </label>
          <label>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Token d'entrada</div>
            <Input value={token} onChange={setToken} placeholder="(el que t'ha donat el principal)" />
          </label>
          <label>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Nom d'àrbitre</div>
            <Input value={name} onChange={setName} placeholder="Ex: Joan Maria" />
          </label>

          {err ? <div style={{ color: '#b91c1c', fontWeight: 700 }}>{err}</div> : null}

          <Button onClick={submit} disabled={!canSubmit || busy}>
            {busy ? 'Entrant…' : 'Entrar'}
          </Button>

          <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.35 }}>
            Consell: si el token és de <b>taula</b>, aquesta sessió tindrà permisos per marcar checks i penalitzacions.
          </div>
        </div>
      </Card>
    </div>
  )
}
