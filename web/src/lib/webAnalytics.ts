// Cloudflare Web Analytics (cookieless) beacon, manual installation for a
// GitHub Pages site. Pageview policy: one pageview per genuine document load.
// SPA tracking is disabled ("spa": false) because AGRINET rewrites the URL with
// history.replaceState on every commodity/date/market change; the Navigation API
// would otherwise report timeline scrubbing as page views.
// Docs: https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/

export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js'
const BEACON_ID = 'agrinet-cf-web-analytics'
const TOKEN_RE = /^[A-Za-z0-9]{16,64}$/

export type AnalyticsStatus = 'disabled' | 'invalid-token' | 'skipped-sensitive-url' | 'already-present' | 'injected' | 'error'

export function initAnalytics(token: string | undefined, search: string, doc: Document = document): { status: AnalyticsStatus } {
  try {
    const t = (token ?? '').trim()
    if (!t) return { status: 'disabled' }
    if (!TOKEN_RE.test(t)) return { status: 'invalid-token' }
    // Scenario share links carry user-entered commercial inputs in ?s=; the
    // beacon reports the page URL, so such loads are not measured.
    if (new URLSearchParams(search).has('s')) return { status: 'skipped-sensitive-url' }
    if (doc.querySelector(`#${BEACON_ID}, script[src^="${BEACON_SRC}"]`)) return { status: 'already-present' }
    const s = doc.createElement('script')
    s.id = BEACON_ID
    s.type = 'module'
    s.defer = true
    s.src = BEACON_SRC
    s.dataset.cfBeacon = JSON.stringify({ token: t, spa: false })
    // Ad blockers or network failures must never affect the application.
    s.onerror = () => { s.remove() }
    ;(doc.body ?? doc.head).appendChild(s)
    return { status: 'injected' }
  } catch {
    return { status: 'error' }
  }
}
