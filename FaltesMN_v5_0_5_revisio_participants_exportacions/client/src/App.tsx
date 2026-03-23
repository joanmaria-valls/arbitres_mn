import { useEffect, useMemo, useState } from 'react'
import { useHashRoute, navigate } from './lib/hashRoute'
import { fetchJoinPreview, fetchSnapshot, getPrincipalSessionInfo, isActorSessionError, isPrincipalSessionError } from './lib/api'
import {
  bootstrapStorage,
  clearPrincipalCompetition,
  clearPrincipalSession,
  clearSession,
  loadPrincipalSession,
  loadRecentJoins,
  loadSession,
  rememberJoin,
  savePrincipalSession,
  saveSession,
  type RecentJoin
} from './lib/storage'
import type { FarewellScreenState, LogoutPayload, PrincipalSession, Session } from './types'
import { JoinPage } from './pages/JoinPage'
import { PrincipalJoinPage } from './pages/PrincipalJoinPage'
import { PrincipalPage } from './pages/PrincipalPage'
import { AdminPage } from './pages/AdminPage'
import { Dashboard } from './pages/Dashboard'
import { Toasts, type ToastItem } from './components/Toast'
import { Button, Card, Pill } from './components/ui'
import { InfoButton } from './components/AppInfo'

function uuid() {
  return crypto.randomUUID()
}

function BootScreen() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 14 }}>
      <Card title="FaltesMN (CAT)">
        <div style={{ color: '#4b5563', fontWeight: 700 }}>Carregant l'aplicació…</div>
      </Card>
    </div>
  )
}

function NordicWalkingIcon(props: { size?: number | string } = {}) {
  return (
    <svg width={props.size || 156} height={props.size || 156} viewBox="0 0 156 156" aria-hidden="true" style={{ width: props.size || 156, height: props.size || 156, maxWidth: '100%' }}>
      <defs>
        <linearGradient id="faltesmn-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#eff6ff" />
          <stop offset="100%" stopColor="#e8f5e9" />
        </linearGradient>
      </defs>
      <circle cx="78" cy="78" r="70" fill="url(#faltesmn-bg)" stroke="#9dc2ea" strokeWidth="4" />
      <path d="M25 108 C48 98, 68 95, 96 102 S130 111, 136 108" fill="none" stroke="#9dc2ea" strokeWidth="4" strokeLinecap="round" opacity="0.75" />

      <g transform="translate(8 4)">
        <circle cx="58" cy="35" r="9" fill="#1f5fa8" />
        <path d="M56 45 L52 66 L66 78 L76 57" fill="none" stroke="#1f5fa8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M52 66 L38 88" fill="none" stroke="#1f5fa8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M66 78 L52 106" fill="none" stroke="#1f5fa8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M42 50 L49 72" fill="none" stroke="#1f5fa8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M79 48 L90 78" fill="none" stroke="#1f5fa8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M39 58 L31 114" fill="none" stroke="#6b7280" strokeWidth="3.6" strokeLinecap="round" />
        <path d="M90 55 L100 116" fill="none" stroke="#6b7280" strokeWidth="3.6" strokeLinecap="round" />
        <circle cx="31" cy="116" r="2.8" fill="#6b7280" />
        <circle cx="100" cy="118" r="2.8" fill="#6b7280" />
      </g>

      <g transform="translate(36 18) scale(0.72)" opacity="0.9">
        <circle cx="78" cy="34" r="8.5" fill="#2f7d4a" />
        <path d="M76 43 L72 62 L85 73 L95 56" fill="none" stroke="#2f7d4a" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M72 62 L58 83" fill="none" stroke="#2f7d4a" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M85 73 L72 100" fill="none" stroke="#2f7d4a" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M61 48 L68 69" fill="none" stroke="#2f7d4a" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M98 46 L108 76" fill="none" stroke="#2f7d4a" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M58 55 L50 110" fill="none" stroke="#7c8b86" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M108 53 L118 111" fill="none" stroke="#7c8b86" strokeWidth="3.4" strokeLinecap="round" />
        <circle cx="50" cy="112" r="2.6" fill="#7c8b86" />
        <circle cx="118" cy="113" r="2.6" fill="#7c8b86" />
      </g>
    </svg>
  )
}

function WelcomeScreen(props: { onEnter: () => void; competitionName?: string | null; competitionCode?: string | null; entryMode?: 'generic' | 'join' }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: '6px 6px max(8px, env(safe-area-inset-bottom))', overflow: 'hidden', overscrollBehavior: 'none' }}>
      <div
        style={{
          width: '100%',
          maxWidth: 820,
          minHeight: 'calc(100dvh - max(12px, env(safe-area-inset-bottom)))',
          background: 'linear-gradient(180deg, #eff6ff 0%, #e8f5e9 100%)',
          border: '1px solid #c8dcc7',
          borderRadius: 24,
          boxShadow: '0 10px 30px rgba(31,95,168,0.10)',
          padding: '12px 10px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 900, fontSize: 22, color: '#1f5fa8' }}>FaltesMN (CAT)</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <InfoButton compact />
          </div>
        </div>

        <div style={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', gap: 12, padding: '8px 0 4px' }}>
          <NordicWalkingIcon size="min(94px, 27vw)" />
          <div style={{ display: 'grid', gap: 8, maxWidth: 620 }}>
            <div style={{ fontSize: 'clamp(17px, 3.8vw, 25px)', fontWeight: 900, color: '#1f2937', lineHeight: 1.15 }}>
              {props.entryMode === 'join' ? "Benvingut/da a la sessió d'arbitratge de marxa nòrdica" : "Benvinguts/des a una nova sessió d'arbitratge de marxa nòrdica"}
            </div>
            {props.competitionName ? (
              <div style={{ fontSize: 'clamp(16px, 3.7vw, 21px)', fontWeight: 900, color: '#1f5fa8', textTransform: 'uppercase', lineHeight: 1.15 }}>
                {props.competitionName}
              </div>
            ) : null}
            <div style={{ fontSize: 'clamp(11px, 2.8vw, 13px)', color: '#4b5563', lineHeight: 1.45 }}>
              Aplicació de suport per a l'arbitratge de recorregut, taula i principal.
              {props.competitionCode ? <> Codi: <b>{props.competitionCode}</b>.</> : null}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 2, paddingBottom: 6 }}>
          <Button onClick={props.onEnter} style={{ minWidth: 196, fontSize: 17, padding: '11px 18px', borderRadius: 14 }}>
            Entrar
          </Button>
        </div>
      </div>
    </div>
  )
}

function FarewellScreen(props: { farewell: FarewellScreenState; onClose: () => void; onBack: () => void }) {
  const isReferee = props.farewell.actorRole === 'referee'
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: '6px 6px max(8px, env(safe-area-inset-bottom))', overflow: 'hidden', overscrollBehavior: 'none' }}>
      <div
        style={{
          width: '100%',
          maxWidth: 820,
          minHeight: 'calc(100dvh - max(12px, env(safe-area-inset-bottom)))',
          background: 'linear-gradient(180deg, #eff6ff 0%, #e8f5e9 100%)',
          border: '1px solid #c8dcc7',
          borderRadius: 24,
          boxShadow: '0 10px 30px rgba(31,95,168,0.10)',
          padding: '14px 12px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 22,
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'grid', gap: 10, placeItems: 'center' }}>
          <NordicWalkingIcon size="min(118px, 34vw)" />
          <div style={{ fontSize: 30, fontWeight: 900, color: '#1f2937', lineHeight: 1.15 }}>Moltes gràcies per l'arbitratge</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1f5fa8' }}>{props.farewell.actorName}</div>
          <div style={{ fontSize: 15, color: '#4b5563' }}>Competició: <b>{props.farewell.competitionName}</b></div>
        </div>

        {isReferee ? (
          <Card style={{ maxWidth: 620, margin: '0 auto', width: '100%' }}>
            <div style={{ display: 'grid', gap: 8, textAlign: 'left' }}>
              <div style={{ fontWeight: 800, color: '#1f2937' }}>Registre PDF de l'àrbitre de recorregut</div>
              <div style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.45 }}>
                {props.farewell.pdfStatus === 'failed'
                  ? (props.farewell.pdfMessage || "No s'ha pogut generar automàticament el PDF en sortir.")
                  : (props.farewell.pdfMessage || 'S’ha iniciat la descàrrega del PDF amb el teu registre.')}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.45 }}>
                Des del navegador no sempre és possible forçar una subcarpeta concreta dins de <b>Baixades</b>. Per això el fitxer es descarrega amb el nom de la competició incorporat, perquè quedi fàcil de localitzar.
              </div>
            </div>
          </Card>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={props.onBack} style={{ minWidth: 190, fontSize: 18, padding: '14px 18px', borderRadius: 14 }}>
            Enrere
          </Button>
          <Button onClick={props.onClose} style={{ minWidth: 190, fontSize: 18, padding: '14px 18px', borderRadius: 14 }}>
            Tancar
          </Button>
        </div>
      </div>
    </div>
  )
}

function ClosedScreen(props: { onTryClose: () => void }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: '6px 6px max(8px, env(safe-area-inset-bottom))', overflow: 'hidden', overscrollBehavior: 'none' }}>
      <div
        style={{
          width: '100%',
          maxWidth: 820,
          minHeight: 'calc(100dvh - max(12px, env(safe-area-inset-bottom)))',
          background: 'linear-gradient(180deg, #eff6ff 0%, #e8f5e9 100%)',
          border: '1px solid #c8dcc7',
          borderRadius: 24,
          boxShadow: '0 10px 30px rgba(31,95,168,0.10)',
          padding: '14px 12px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 22,
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'grid', gap: 10, placeItems: 'center' }}>
          <NordicWalkingIcon size="min(118px, 34vw)" />
          <div style={{ fontSize: 30, fontWeight: 900, color: '#1f2937', lineHeight: 1.15 }}>Sessió tancada</div>
          <div style={{ fontSize: 16, color: '#4b5563', lineHeight: 1.5, maxWidth: 620 }}>
            Ja has sortit del flux de l'aplicació. Si el dispositiu no permet tancar la pestanya automàticament, ja la pots tancar manualment.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Button onClick={props.onTryClose} style={{ minWidth: 220, fontSize: 18, padding: '14px 18px', borderRadius: 14 }}>
            Tancar la pestanya
          </Button>
        </div>
      </div>
    </div>
  )
}

function HomeMenu(props: { recentJoins: RecentJoin[] }) {
  return (
    <div style={{ maxWidth: 840, margin: '0 auto', padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 900, fontSize: 22 }}>FaltesMN (CAT)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Pill>Inici</Pill><InfoButton compact /></div>
      </div>
      <div style={{ height: 12 }} />

      <Card title="Què vols fer?">
        <div style={{ display: 'grid', gap: 10 }}>
          <Button onClick={() => navigate('/join')}>Entrar a una competició</Button>
          <Button variant="secondary" onClick={() => navigate('/principal')}>
            Accés Àrbitre principal
          </Button>
          <Button variant="secondary" onClick={() => navigate('/admin')}>
            Admin plataforma
          </Button>
          <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.35 }}>
            Recomanat: el <b>principal</b> crea la competició i després pot compartir QR, enllaç o codi/token.
          </div>
        </div>
      </Card>

      {props.recentJoins.length ? (
        <>
          <div style={{ height: 12 }} />
          <Card title="Reprendre una entrada recent">
            <div style={{ display: 'grid', gap: 10 }}>
              {props.recentJoins.map((r, idx) => (
                <div
                  key={`${r.code}-${r.joinToken}-${r.name}-${idx}`}
                  style={{
                    border: '1px solid #d1d5db',
                    borderRadius: 12,
                    padding: 10,
                    display: 'flex',
                    gap: 10,
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div style={{ fontWeight: 900 }}>{r.name}</div>
                    <div style={{ fontSize: 13, color: '#4b5563' }}>
                      {r.roleLabel} · {r.competitionName ? <><b>{r.competitionName}</b> · Codi {r.code}</> : <>Competició {r.code}</>}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      navigate(
                        `/join?code=${encodeURIComponent(r.code)}&token=${encodeURIComponent(r.joinToken)}&name=${encodeURIComponent(r.name)}`
                      )
                    }
                  >
                    Reprendre
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  )
}

export default function App() {
  const route = useHashRoute()

  const [hydrated, setHydrated] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [principalSession, setPrincipalSession] = useState<PrincipalSession | null>(null)
  const [recentJoins, setRecentJoins] = useState<RecentJoin[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [enteredHome, setEnteredHome] = useState(false)
  const [farewell, setFarewell] = useState<FarewellScreenState | null>(null)
  const [farewellReturnSession, setFarewellReturnSession] = useState<Session | null>(null)
  const [closedScreen, setClosedScreen] = useState(false)
  const [joinPreview, setJoinPreview] = useState<{ competitionName: string; competitionCode: string } | null>(null)

  const addToast = (t: { text: string; kind?: 'info' | 'warn' | 'danger' }) => {
    setToasts((prev) => [...prev, { id: uuid(), text: t.text, kind: t.kind }])
  }

  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      await bootstrapStorage()

      let nextSession = loadSession()
      let nextPrincipalSession = loadPrincipalSession()
      const nextRecentJoins = loadRecentJoins()

      if (nextSession) {
        try {
          await fetchSnapshot(nextSession.actorToken, nextSession.competition.id)
        } catch (e) {
          if (isActorSessionError(e)) {
            clearSession()
            nextSession = null
          }
        }
      }

      if (nextPrincipalSession) {
        try {
          const principal = await getPrincipalSessionInfo(nextPrincipalSession.sessionToken)
          nextPrincipalSession = { ...nextPrincipalSession, principal }
        } catch (e) {
          if (isPrincipalSessionError(e)) {
            clearPrincipalSession()
            clearPrincipalCompetition()
            nextPrincipalSession = null
          }
        }
      }

      if (cancelled) return
      setSession(nextSession)
      setPrincipalSession(nextPrincipalSession)
      setRecentJoins(nextRecentJoins)
      setEnteredHome(false)
      setHydrated(true)
    }

    boot().catch(() => {
      if (cancelled) return
      setHydrated(true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveSession(session)
  }, [session, hydrated])

  useEffect(() => {
    if (!hydrated) return
    savePrincipalSession(principalSession)
  }, [principalSession, hydrated])

  useEffect(() => {
    if (route.path !== '/') {
      setFarewell(null)
    }
  }, [route.path])

  const renderExternalClosedPage = () => {
    const html = `<!doctype html>
<html lang="ca">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FaltesMN (CAT)</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:linear-gradient(180deg,#eff6ff 0%,#e8f5e9 100%);min-height:100vh;display:grid;place-items:center;padding:16px;color:#1f2937}
  .card{width:min(860px,100%);background:rgba(255,255,255,.72);border:1px solid #c8dcc7;border-radius:24px;box-shadow:0 10px 30px rgba(31,95,168,.10);padding:28px 20px;text-align:center}
  h1{margin:0 0 10px 0;font-size:30px;line-height:1.15}
  p{margin:0;font-size:16px;line-height:1.5;color:#4b5563}
</style>
</head>
<body>
  <div class="card">
    <h1>Sessió tancada</h1>
    <p>Ja has sortit del flux de l'aplicació. Ja pots tancar aquesta pestanya o tornar al navegador.</p>
  </div>
</body>
</html>`
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  }

  const handleCloseFarewell = () => {
    setFarewell(null)
    setFarewellReturnSession(null)
    setClosedScreen(true)
    try {
      window.close()
    } catch {}
    try {
      window.location.replace(renderExternalClosedPage())
      return
    } catch {}
    navigate('/closed')
  }

  const handleBackFromFarewell = () => {
    if (!farewellReturnSession) {
      setFarewell(null)
      setClosedScreen(false)
      navigate('/')
      return
    }
    setFarewell(null)
    setClosedScreen(false)
    setSession(farewellReturnSession)
    setFarewellReturnSession(null)
    setEnteredHome(true)
    navigate('/')
  }

  useEffect(() => {
    let cancelled = false
    const wantsJoinPreview = route.path.startsWith('/join') || route.path.startsWith('/principal-join')
    const code = String(route.query.code || '')
    const token = String(route.query.token || '')
    if (!wantsJoinPreview || !code || !token) {
      setJoinPreview(null)
      return
    }
    fetchJoinPreview(code, token)
      .then((preview) => {
        if (cancelled) return
        setJoinPreview({ competitionName: preview.competition.name, competitionCode: preview.competition.code })
      })
      .catch(() => {
        if (cancelled) return
        setJoinPreview(code ? { competitionName: '', competitionCode: code.toUpperCase() } : null)
      })
    return () => { cancelled = true }
  }, [route.path, route.query.code, route.query.token])

  const handleJoined = (s: Session) => {
    setSession(s)
    setFarewell(null)
    setEnteredHome(true)
    if (s.joinToken) {
      rememberJoin(s)
      setRecentJoins(loadRecentJoins())
    }
    navigate('/')
  }

  const page = useMemo(() => {
    if (!hydrated) return <BootScreen />

    if (farewell) {
      return <FarewellScreen farewell={farewell} onClose={handleCloseFarewell} onBack={handleBackFromFarewell} />
    }

    if (route.path === '/closed' || closedScreen) return <ClosedScreen onTryClose={handleCloseFarewell} />

    if (!enteredHome) return <WelcomeScreen onEnter={() => { setClosedScreen(false); setEnteredHome(true) }} competitionName={joinPreview?.competitionName || null} competitionCode={joinPreview?.competitionCode || null} entryMode={joinPreview ? 'join' : 'generic'} />

    if (route.path.startsWith('/admin')) return <AdminPage />

    if (route.path.startsWith('/principal-join')) {
      return (
        <PrincipalJoinPage
          initialCode={route.query.code}
          initialToken={route.query.token}
          initialName={route.query.name}
          onJoined={handleJoined}
        />
      )
    }

    if (route.path.startsWith('/principal')) {
      return (
        <PrincipalPage
          initialKey={route.query.key}
          initialCompetitionId={route.query.compId}
          savedSession={principalSession}
          onSession={(s) => setPrincipalSession(s)}
          onJoined={handleJoined}
        />
      )
    }

    if (route.path.startsWith('/join')) {
      return (
        <JoinPage
          initialCode={route.query.code}
          initialToken={route.query.token}
          initialName={route.query.name}
          onJoined={handleJoined}
        />
      )
    }


    if (session) {
      return (
        <Dashboard
          session={session}
          onLogout={(payload?: LogoutPayload) => {
            setFarewellReturnSession(payload?.farewell ? session : null)
            setSession(null)
            setFarewell(payload?.farewell || null)
            navigate('/')
          }}
          onInvalidSession={() => {
            setSession(null)
            setFarewell(null)
            addToast({ text: 'La sessió guardada ja no era vàlida. Torna a entrar.', kind: 'warn' })
            navigate('/')
          }}
          addToast={addToast}
          onSessionRecovered={(s) => {
            setSession(s)
            setFarewell(null)
            addToast({ text: 'Sessió recuperada automàticament.', kind: 'info' })
          }}
        />
      )
    }

    return <HomeMenu recentJoins={recentJoins} />
  }, [hydrated, route.path, JSON.stringify(route.query), session, principalSession, JSON.stringify(recentJoins), enteredHome, farewell, closedScreen, JSON.stringify(joinPreview)])

  return (
    <>
      {page}
      <Toasts
        items={toasts}
        onRemove={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </>
  )
}
