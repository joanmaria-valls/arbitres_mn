const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function normalizePathname(pathname: string) {
  return pathname || '/'
}

export function normalizeAppBaseUrl(input: string) {
  const raw = input.trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    url.hash = ''
    url.search = ''
    url.pathname = normalizePathname(url.pathname)
    return url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '')
  } catch {
    return raw.replace(/#.*$/, '').replace(/\/+$/, '')
  }
}

export function currentAppBaseUrl() {
  return normalizeAppBaseUrl(`${window.location.origin}${window.location.pathname}`)
}

export function isLocalHostname(hostname: string) {
  const host = hostname.trim().toLowerCase()
  return LOCAL_HOSTS.has(host) || host.startsWith('127.')
}

export function isLocalAppBaseUrl(value: string | null | undefined) {
  if (!value?.trim()) return false
  try {
    return isLocalHostname(new URL(normalizeAppBaseUrl(value)).hostname)
  } catch {
    return false
  }
}

function configuredBaseUrl() {
  const fromEnv = String(((import.meta as any).env?.VITE_PUBLIC_BASE_URL) || '').trim()
  return fromEnv ? normalizeAppBaseUrl(fromEnv) : ''
}

export function effectiveJoinBaseUrl(savedValue?: string | null) {
  const configured = configuredBaseUrl()
  if (configured) return configured

  const detected = currentAppBaseUrl()
  const saved = savedValue?.trim() ? normalizeAppBaseUrl(savedValue) : ''
  if (!saved) return detected

  try {
    const detectedHost = new URL(detected).hostname
    const savedHost = new URL(saved).hostname
    if (!isLocalHostname(detectedHost) && isLocalHostname(savedHost)) return detected
  } catch {
    return detected
  }

  return saved
}

function isPrivateIpv4(ip: string) {
  if (/^10\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  const match = ip.match(/^172\.(\d+)\./)
  if (match) {
    const second = Number(match[1])
    return second >= 16 && second <= 31
  }
  return false
}

function extractCandidateIps(candidate: string) {
  return Array.from(candidate.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)).map((m) => m[0])
}

async function detectPrivateIpv4ViaWebRtc() {
  if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') return null

  return await new Promise<string | null>((resolve) => {
    let settled = false
    const seen = new Set<string>()
    const pc = new RTCPeerConnection({ iceServers: [] })

    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        pc.onicecandidate = null
        pc.close()
      } catch {
        // ignore
      }
      resolve(value)
    }

    const consider = (text: string) => {
      for (const ip of extractCandidateIps(text)) {
        if (!isPrivateIpv4(ip) || seen.has(ip)) continue
        seen.add(ip)
        finish(ip)
        return true
      }
      return false
    }

    const timer = window.setTimeout(() => finish(null), 1500)

    try {
      pc.createDataChannel('faltesmn-base-url')
      pc.onicecandidate = (event) => {
        const candidate = event.candidate?.candidate || ''
        if (candidate && consider(candidate)) return
        if (!event.candidate) finish(null)
      }
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          const sdp = pc.localDescription?.sdp || ''
          if (sdp) consider(sdp)
        })
        .catch(() => finish(null))
    } catch {
      finish(null)
    }
  })
}

export async function detectBetterLocalBaseUrl(currentValue?: string | null) {
  const configured = configuredBaseUrl()
  if (configured) return configured

  const current = currentAppBaseUrl()
  let currentUrl: URL
  try {
    currentUrl = new URL(current)
  } catch {
    return null
  }

  if (!isLocalHostname(currentUrl.hostname)) return null
  if (currentValue?.trim() && !isLocalAppBaseUrl(currentValue)) return null

  const lanIp = await detectPrivateIpv4ViaWebRtc()
  if (!lanIp) return null

  currentUrl.hostname = lanIp
  return normalizeAppBaseUrl(currentUrl.toString())
}

export function principalAccessLink(baseUrl: string, principalKey: string, competitionId?: string | null) {
  const cleanBase = normalizeAppBaseUrl(baseUrl).replace(/\/$/, '')
  const usp = new URLSearchParams()
  usp.set('key', principalKey)
  if (competitionId?.trim()) usp.set('compId', competitionId.trim())
  return `${cleanBase}/#/principal?${usp.toString()}`
}


export function principalCompetitionJoinLink(baseUrl: string, compCode: string, token: string, name?: string) {
  const cleanBase = normalizeAppBaseUrl(baseUrl).replace(/\/$/, '')
  const usp = new URLSearchParams()
  usp.set('code', compCode)
  usp.set('token', token)
  if (name?.trim()) usp.set('name', name.trim())
  return `${cleanBase}/#/principal-join?${usp.toString()}`
}
export function competitionJoinLink(baseUrl: string, compCode: string, token: string, name?: string) {
  const cleanBase = normalizeAppBaseUrl(baseUrl).replace(/\/$/, '')
  const usp = new URLSearchParams()
  usp.set('code', compCode)
  usp.set('token', token)
  if (name?.trim()) usp.set('name', name.trim())
  return `${cleanBase}/#/join?${usp.toString()}`
}
