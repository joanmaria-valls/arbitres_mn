import { useEffect, useState } from 'react'
import { navigate } from '../lib/hashRoute'
import { BandTitle, Button, Card, Divider, Input, Pill } from '../components/ui'
import { InfoButton } from '../components/AppInfo'
import { detectBetterLocalBaseUrl, effectiveJoinBaseUrl } from '../lib/baseUrl'
import { loadJoinBaseUrl, saveJoinBaseUrl, savePrincipalAccessKey } from '../lib/storage'
import { copyText } from '../lib/clipboard'

async function http(path: string, init: RequestInit = {}) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(path, {
      ...init,
      signal: init.signal || controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(init.headers || {})
      }
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `Error HTTP ${res.status}`)
    }
    return data
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Temps d’espera esgotat amb el servidor')
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}

export function AdminPage() {
  const [adminKey, setAdminKey] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [created, setCreated] = useState<{ principalName: string; principalKey: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [joinBaseUrl, setJoinBaseUrl] = useState(() => effectiveJoinBaseUrl(loadJoinBaseUrl()))

  useEffect(() => {
    saveJoinBaseUrl(joinBaseUrl)
  }, [joinBaseUrl])

  useEffect(() => {
    let cancelled = false
    detectBetterLocalBaseUrl(loadJoinBaseUrl())
      .then((better) => {
        if (!better || cancelled) return
        setJoinBaseUrl((prev) => (prev === better ? prev : better))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const create = async () => {
    setBusy(true)
    setErr(null)
    setCreated(null)
    setCopied(null)
    try {
      const r = await http('/api/admin/principals', {
        method: 'POST',
        headers: { 'x-admin-key': adminKey },
        body: JSON.stringify({ name })
      })
      setCreated({ principalName: r.principal.name, principalKey: r.principalKey })
      savePrincipalAccessKey(r.principalKey)
      setName('')
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 900, fontSize: 22 }}>FaltesMN (CAT)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill>Admin plataforma</Pill>
          <InfoButton compact />
          <Button variant="secondary" onClick={() => navigate('/')}>Sortir a la pantalla principal</Button>
        </div>
      </div>

      <div style={{ height: 12 }} />

      <Card>
        <div style={{ display: 'grid', gap: 10 }}>
          <BandTitle>CREAR CLAU D&apos;ÀRBITRE PRINCIPAL</BandTitle>

          <label>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>PLATFORM_ADMIN_KEY</div>
            <Input value={adminKey} onChange={setAdminKey} placeholder="(clau del servidor)" />
          </label>
          <label>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Nom de l&apos;àrbitre principal</div>
            <Input value={name} onChange={setName} placeholder="Ex: Principal FEEC #1" />
          </label>

          <Divider />

          <BandTitle>URL BASE PER ALS QR</BandTitle>
          <label>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>URL base de l&apos;aplicació</div>
            <Input value={joinBaseUrl} onChange={setJoinBaseUrl} placeholder="Ex: https://192.168.1.50:5173" />
          </label>
          <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.35 }}>
            Per defecte s&apos;hi posa la <b>URL actual</b> de l&apos;aplicació. Si l&apos;has obert per <b>IP o domini</b>, el QR del principal ja sortirà bé. Si l&apos;has obert per <b>localhost</b>, l&apos;aplicació intentarà detectar una <b>IP local</b> i, si no pot, la pots corregir manualment.
          </div>

          {err ? <div style={{ color: '#b91c1c', fontWeight: 700 }}>{err}</div> : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button onClick={create} disabled={busy || adminKey.trim().length < 8 || name.trim().length < 2}>
              {busy ? 'Creant…' : 'Crear clau'}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/')}>Sortir</Button>
          </div>

          {created ? (
            <>
              <Divider />
              <div style={{ fontWeight: 900 }}>Clau creada</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>{created.principalName}</div>
              <div
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: 14,
                  padding: 10,
                  borderRadius: 10,
                  border: '1px solid #c8dcc7',
                  background: '#f2faf1',
                  wordBreak: 'break-all'
                }}
              >
                {created.principalKey}
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const ok = await copyText(created.principalKey)
                    if (ok) {
                      setCopied('key')
                      setErr(null)
                    } else {
                      setErr('No s’ha pogut copiar la clau al porta-retalls.')
                    }
                  }}
                >
                  {copied === 'key' ? 'Clau copiada' : 'Copia la clau'}
                </Button>
              </div>

              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.35 }}>
                Copia aquesta clau i passa-la a l&apos;àrbitre principal. No es pot recuperar després si es perd.
                L&apos;enllaç i el QR de l&apos;àrbitre principal es generaran quan ja hi hagi una competició creada.
              </div>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
