import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Divider, Input, Pill, BandTitle } from '../components/ui'
import { InfoButton } from '../components/AppInfo'
import { closeCompetition, createCompetition, getPrincipalSessionInfo, isPrincipalSessionError, principalDirectEnter, principalEnterCompetition, principalLogin } from '../lib/api'
import {
  clearPrincipalCompetition,
  loadJoinBaseUrl,
  loadPrincipalAccessKey,
  loadPrincipalCompetition,
  savePrincipalAccessKey,
  savePrincipalCompetition
} from '../lib/storage'
import { competitionJoinLink, detectBetterLocalBaseUrl, effectiveJoinBaseUrl, principalAccessLink } from '../lib/baseUrl'
import { copyText } from '../lib/clipboard'
import type { Competition, PrincipalSession, Session } from '../types'

async function makeQrDataUrl(text: string): Promise<string> {
  const QRCode = (await import('qrcode')).default
  return await QRCode.toDataURL(text, { margin: 1, width: 260 })
}



export function PrincipalPage(props: {
  initialKey?: string
  initialCompetitionId?: string
  savedSession: PrincipalSession | null
  onSession: (s: PrincipalSession | null) => void
  onJoined: (s: Session) => void
}) {
  const [principalKey, setPrincipalKey] = useState(props.initialKey || loadPrincipalAccessKey() || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [autoJoinDoneFor, setAutoJoinDoneFor] = useState<string>('')

  const [compName, setCompName] = useState('')
  const [competition, setCompetition] = useState<(Competition & { joinTokens?: { principal?: string; referee: string; table: string } }) | null>(
    () => loadPrincipalCompetition()
  )
  const [principalAccessKey, setPrincipalAccessKey] = useState(() => props.initialKey || loadPrincipalAccessKey() || '')
  const [joinBaseUrl, setJoinBaseUrl] = useState(() => effectiveJoinBaseUrl(loadJoinBaseUrl()))

  const sess = props.savedSession

  useEffect(() => {
    if (!props.initialKey) return
    setPrincipalKey(props.initialKey)
    setPrincipalAccessKey(props.initialKey)
    savePrincipalAccessKey(props.initialKey)
  }, [props.initialKey])

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

  useEffect(() => {
    if (!sess) return
    getPrincipalSessionInfo(sess.sessionToken).catch((e) => {
      if (!isPrincipalSessionError(e)) return
      props.onSession(null)
      setCompetition(null)
      clearPrincipalCompetition()
      setErr('La sessió de principal ha caducat. Torna a entrar.')
    })
  }, [sess?.sessionToken])

  useEffect(() => {
    savePrincipalCompetition(competition)
  }, [competition])

  useEffect(() => {
    const trimmedKey = props.initialKey?.trim() || ''
    const targetCompId = props.initialCompetitionId?.trim() || ''
    const autoKey = targetCompId ? `${trimmedKey}::${targetCompId}` : trimmedKey

    if (!trimmedKey || !targetCompId) return
    if (autoJoinDoneFor === autoKey) return

    let cancelled = false
    setAutoJoinDoneFor(autoKey)
    setBusy(true)
    setErr(null)

    ;(async () => {
      const actorSession = await principalDirectEnter(trimmedKey, targetCompId)
      if (cancelled) return
      savePrincipalAccessKey(trimmedKey)
      setPrincipalKey(trimmedKey)
      setPrincipalAccessKey(trimmedKey)
      props.onJoined(actorSession)
    })()
      .catch((e: any) => {
        if (cancelled) return
        if (isPrincipalSessionError(e)) {
          props.onSession(null)
          setCompetition(null)
          clearPrincipalCompetition()
          setErr('La sessió de principal ha caducat. Torna a entrar.')
        } else {
          setErr(String(e?.message || e))
        }
      })
      .finally(() => {
        if (cancelled) return
        setBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [props.initialKey, props.initialCompetitionId, autoJoinDoneFor])

  useEffect(() => {
    if (props.initialCompetitionId?.trim()) return
    const trimmedKey = props.initialKey?.trim() || ''
    if (!trimmedKey) return
    if (busy) return
    if (autoJoinDoneFor === trimmedKey) return

    let cancelled = false
    setAutoJoinDoneFor(trimmedKey)
    setBusy(true)
    setErr(null)

    ;(async () => {
      const principalSession = await principalLogin(trimmedKey)
      if (cancelled) return
      savePrincipalAccessKey(trimmedKey)
      setPrincipalKey(trimmedKey)
      setPrincipalAccessKey(trimmedKey)
      props.onSession(principalSession)
    })()
      .catch((e: any) => {
        if (cancelled) return
        if (isPrincipalSessionError(e)) {
          props.onSession(null)
          setCompetition(null)
          clearPrincipalCompetition()
          setErr('La sessió de principal ha caducat. Torna a entrar.')
        } else {
          setErr(String(e?.message || e))
        }
      })
      .finally(() => {
        if (cancelled) return
        setBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [props.initialKey, props.initialCompetitionId, autoJoinDoneFor, busy])

  const doLogin = async () => {
    setBusy(true)
    setErr(null)
    try {
      const trimmedKey = principalKey.trim()
      const s = await principalLogin(trimmedKey)
      savePrincipalAccessKey(trimmedKey)
      setPrincipalAccessKey(trimmedKey)
      props.onSession(s)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const doCreate = async () => {
    if (!sess) return
    setBusy(true)
    setErr(null)
    try {
      const c = await createCompetition(sess.sessionToken, compName.trim())
      setCompetition(c)
    } catch (e: any) {
      if (isPrincipalSessionError(e)) {
        props.onSession(null)
        setCompetition(null)
        clearPrincipalCompetition()
        setErr('La sessió de principal ha caducat. Torna a entrar.')
      } else {
        setErr(String(e?.message || e))
      }
    } finally {
      setBusy(false)
    }
  }

  const doClose = async () => {
    if (!sess || !competition) return
    setBusy(true)
    setErr(null)
    try {
      await closeCompetition(sess.sessionToken, competition.id)
      setCompetition({ ...competition, status: 'closed', closedAt: new Date().toISOString() })
    } catch (e: any) {
      if (isPrincipalSessionError(e)) {
        props.onSession(null)
        setCompetition(null)
        clearPrincipalCompetition()
        setErr('La sessió de principal ha caducat. Torna a entrar.')
      } else {
        setErr(String(e?.message || e))
      }
    } finally {
      setBusy(false)
    }
  }

  const doPrincipalEnter = async () => {
    if (!sess || !competition) return
    setBusy(true)
    setErr(null)
    try {
      const actorSession = await principalEnterCompetition(sess.sessionToken, competition.id)
      props.onJoined(actorSession)
    } catch (e: any) {
      if (isPrincipalSessionError(e)) {
        props.onSession(null)
        setCompetition(null)
        clearPrincipalCompetition()
        setErr('La sessió de principal ha caducat. Torna a entrar.')
      } else {
        setErr(String(e?.message || e))
      }
    } finally {
      setBusy(false)
    }
  }

  const links = useMemo(() => {
    if (!competition?.joinTokens) return null
    return {
      principalLink: competition.joinTokens?.principal ? competitionJoinLink(joinBaseUrl, competition.code, competition.joinTokens.principal, props.savedSession?.principal.name || 'Principal') : (principalAccessKey.trim() ? principalAccessLink(joinBaseUrl, principalAccessKey.trim(), competition.id) : ''),
      refereeLink: competitionJoinLink(joinBaseUrl, competition.code, competition.joinTokens.referee),
      tableLink: competitionJoinLink(joinBaseUrl, competition.code, competition.joinTokens.table)
    }
  }, [competition, joinBaseUrl, principalAccessKey])

  const [qrPrincipal, setQrPrincipal] = useState<string>('')
  const [qrRef, setQrRef] = useState<string>('')
  const [qrTable, setQrTable] = useState<string>('')

  useEffect(() => {
    ;(async () => {
      if (!links) {
        setQrPrincipal('')
        setQrRef('')
        setQrTable('')
        return
      }
      setQrPrincipal(links.principalLink ? await makeQrDataUrl(links.principalLink) : '')
      setQrRef(await makeQrDataUrl(links.refereeLink))
      setQrTable(await makeQrDataUrl(links.tableLink))
    })().catch(() => undefined)
  }, [links?.principalLink, links?.refereeLink, links?.tableLink])

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 900, fontSize: 22 }}>FaltesMN (CAT)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Pill>Àrbitre principal</Pill><InfoButton compact /></div>
      </div>

      <div style={{ height: 12 }} />

      {!sess ? (
        <Card title="Accés com a Àrbitre principal">
          <div style={{ display: 'grid', gap: 10 }}>
            <label>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Clau de principal</div>
              <Input value={principalKey} onChange={setPrincipalKey} placeholder="(clau que t'ha donat l'administrador)" />
            </label>
            {err ? <div style={{ color: '#b91c1c', fontWeight: 700 }}>{err}</div> : null}
            <Button onClick={doLogin} disabled={busy || principalKey.trim().length < 8}>
              {busy ? 'Entrant…' : 'Entrar'}
            </Button>

            <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.35 }}>
              Aquesta clau et permet <b>crear</b>, <b>gestionar</b> i <b>tancar</b> competicions, i també entrar al panell de l&apos;àrbitre principal.
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Card title={`Sessió: ${sess.principal.name}`}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                onClick={() => {
                  props.onSession(null)
                  setCompetition(null)
                  savePrincipalCompetition(null)
                }}
              >
                Tanca sessió de principal
              </Button>
            </div>
          </Card>

          <div style={{ height: 12 }} />

          <Card title="Crear o continuar competició">
            <div style={{ display: 'grid', gap: 10 }}>
              <label>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Nom de la competició</div>
                <Input value={compName} onChange={setCompName} placeholder="Ex: Súria 2026" />
              </label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button onClick={doCreate} disabled={busy || compName.trim().length < 2}>
                  {busy ? 'Creant…' : 'Crear competició'}
                </Button>
              </div>
              {competition ? (
                <div style={{ fontSize: 13, color: '#4b5563' }}>
                  Competició carregada actualment: <b>{competition.name}</b> ({competition.code})
                </div>
              ) : null}
              {err ? <div style={{ color: '#b91c1c', fontWeight: 700 }}>{err}</div> : null}
            </div>
          </Card>

          {competition ? (
            <>
              <div style={{ height: 12 }} />
              <Card>
                <div style={{ display: 'grid', gap: 10 }}>
                  <BandTitle>PANELL DE L&apos;ÀRBITRE PRINCIPAL I ACCESSOS</BandTitle>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>Nom de la competició: {competition.name}</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Pill>Codi de la competició: {competition.code}</Pill>
                    <Pill>{competition.status === 'open' ? 'OBERTA' : 'TANCADA'}</Pill>
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Button onClick={doPrincipalEnter} disabled={busy}>
                      Entrar al panell de l&apos;àrbitre principal
                    </Button>
                    <Button variant="danger" onClick={doClose} disabled={busy || competition.status !== 'open'}>
                      Tancar competició
                    </Button>
                  </div>

                  <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.35 }}>
                    L&apos;àrbitre principal pot tornar a aquesta pantalla sempre que vulgui per reobrir els QR, copiar codis o tornar a entrar al seu panell.
                  </div>

                  <Divider />

                  <BandTitle>BASE URL DELS QR I ENLLAÇOS</BandTitle>
                  <label>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>URL base de l&apos;aplicació</div>
                    <Input value={joinBaseUrl} onChange={setJoinBaseUrl} placeholder="Ex: https://192.168.1.50:5173" />
                  </label>
                  <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.35 }}>
                    Per defecte s&apos;hi posa la <b>URL actual</b> de l&apos;aplicació. Si l&apos;has obert per <b>IP o domini</b>, els QR ja sortiran bé. Si l&apos;has obert per <b>localhost</b>, l&apos;aplicació intentarà detectar una <b>IP local</b>; si no la troba, la pots corregir manualment.
                  </div>

                  {links && competition.joinTokens ? (
                    <>
                      <Divider />

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                        {links.principalLink ? (
                          <div style={{ display: 'grid', gap: 8, border: '1px solid #c8dcc7', borderRadius: 12, padding: 12, background: '#fbfefb' }}>
                            <div style={{ fontWeight: 900 }}>Accés àrbitre principal</div>
                            {qrPrincipal ? <img src={qrPrincipal} alt="QR principal" style={{ width: 220, borderRadius: 12, border: '1px solid #c8dcc7' }} /> : null}
                            <div style={{ fontSize: 13, color: '#4b5563', wordBreak: 'break-all' }}>{links.principalLink}</div>
                            <Pill>{competition.joinTokens?.principal ? `Token: ${competition.joinTokens.principal}` : `Clau: ${principalAccessKey}`}</Pill>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <Button variant="secondary" onClick={async () => { const ok = await copyText(links.principalLink); if (ok) { setCopied('principal-link'); setErr(null) } else { setErr('No s’ha pogut copiar l’enllaç del principal.') } }}>
                                {copied === 'principal-link' ? 'Enllaç copiat' : 'Copia enllaç'}
                              </Button>
                              <Button variant="secondary" onClick={async () => { const value = competition.joinTokens?.principal || principalAccessKey; const ok = await copyText(value); if (ok) { setCopied('principal-key'); setErr(null) } else { setErr(competition.joinTokens?.principal ? 'No s’ha pogut copiar el token del principal.' : 'No s’ha pogut copiar la clau del principal.') } }}>
                                {copied === 'principal-key' ? (competition.joinTokens?.principal ? 'Token copiat' : 'Clau copiada') : (competition.joinTokens?.principal ? 'Copia token' : 'Copia la clau')}
                              </Button>
                            </div>
                          </div>
                        ) : null}

                        <div style={{ display: 'grid', gap: 8, border: '1px solid #c8dcc7', borderRadius: 12, padding: 12, background: '#fbfefb' }}>
                          <div style={{ fontWeight: 900 }}>Accés àrbitres de recorregut</div>
                          {qrRef ? <img src={qrRef} alt="QR àrbitres" style={{ width: 220, borderRadius: 12, border: '1px solid #c8dcc7' }} /> : null}
                          <div style={{ fontSize: 13, color: '#4b5563', wordBreak: 'break-all' }}>{links.refereeLink}</div>
                          <Pill>Token: {competition.joinTokens.referee}</Pill>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <Button variant="secondary" onClick={async () => { const ok = await copyText(links.refereeLink); if (ok) { setCopied('ref-link'); setErr(null) } else { setErr('No s’ha pogut copiar l’enllaç de recorregut.') } }}>
                              {copied === 'ref-link' ? 'Enllaç copiat' : 'Copia enllaç'}
                            </Button>
                            <Button variant="secondary" onClick={async () => { const ok = await copyText(competition.joinTokens!.referee); if (ok) { setCopied('ref-token'); setErr(null) } else { setErr('No s’ha pogut copiar el token de recorregut.') } }}>
                              {copied === 'ref-token' ? 'Token copiat' : 'Copia token'}
                            </Button>
                          </div>
                        </div>

                        <div style={{ display: 'grid', gap: 8, border: '1px solid #c8dcc7', borderRadius: 12, padding: 12, background: '#fbfefb' }}>
                          <div style={{ fontWeight: 900 }}>Accés àrbitre de taula</div>
                          {qrTable ? <img src={qrTable} alt="QR taula" style={{ width: 220, borderRadius: 12, border: '1px solid #c8dcc7' }} /> : null}
                          <div style={{ fontSize: 13, color: '#4b5563', wordBreak: 'break-all' }}>{links.tableLink}</div>
                          <Pill>Token: {competition.joinTokens.table}</Pill>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <Button variant="secondary" onClick={async () => { const ok = await copyText(links.tableLink); if (ok) { setCopied('table-link'); setErr(null) } else { setErr('No s’ha pogut copiar l’enllaç de taula.') } }}>
                              {copied === 'table-link' ? 'Enllaç copiat' : 'Copia enllaç'}
                            </Button>
                            <Button variant="secondary" onClick={async () => { const ok = await copyText(competition.joinTokens!.table); if (ok) { setCopied('table-token'); setErr(null) } else { setErr('No s’ha pogut copiar el token de taula.') } }}>
                              {copied === 'table-token' ? 'Token copiat' : 'Copia token'}
                            </Button>
                          </div>
                        </div>
                      </div>

                      <Divider />
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Pill>Codi manual: {competition.code}</Pill>
                        <Button variant="secondary" onClick={async () => { const ok = await copyText(competition.code); if (ok) { setCopied('code'); setErr(null) } else { setErr('No s’ha pogut copiar el codi manual.') } }}>
                          {copied === 'code' ? 'Codi copiat' : 'Copia el codi'}
                        </Button>
                      </div>
                    </>
                  ) : null}

                  {err ? <div style={{ color: '#b91c1c', fontWeight: 700 }}>{err}</div> : null}
                </div>
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
