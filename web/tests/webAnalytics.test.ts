// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { BEACON_SRC, initAnalytics } from '../src/lib/webAnalytics'

const TOKEN = '0123456789abcdef0123456789abcdef'
const beacons = () => document.querySelectorAll(`script[src^="${BEACON_SRC}"]`)

describe('Cloudflare Web Analytics beacon', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = '' })

  it('is disabled without a site token and injects nothing', () => {
    expect(initAnalytics(undefined, '?c=onion').status).toBe('disabled')
    expect(initAnalytics('', '').status).toBe('disabled')
    expect(beacons()).toHaveLength(0)
  })

  it('rejects malformed tokens instead of injecting them', () => {
    expect(initAnalytics('abc"}<script>', '').status).toBe('invalid-token')
    expect(beacons()).toHaveLength(0)
  })

  it('injects exactly one deferred module beacon with SPA tracking disabled', () => {
    expect(initAnalytics(TOKEN, '?c=onion').status).toBe('injected')
    const s = beacons()
    expect(s).toHaveLength(1)
    const el = s[0] as HTMLScriptElement
    expect(el.type).toBe('module')
    expect(el.defer).toBe(true)
    expect(JSON.parse(el.dataset.cfBeacon!)).toEqual({ token: TOKEN, spa: false })
  })

  it('initializes once even when called repeatedly (StrictMode / re-renders)', () => {
    initAnalytics(TOKEN, '')
    expect(initAnalytics(TOKEN, '').status).toBe('already-present')
    initAnalytics(TOKEN, '')
    expect(beacons()).toHaveLength(1)
  })

  it('does not send scenario share payloads: skips loads carrying ?s=', () => {
    expect(initAnalytics(TOKEN, '?s=eyJ2IjoxfQ').status).toBe('skipped-sensitive-url')
    expect(beacons()).toHaveLength(0)
  })

  it('timeline URL changes do not create extra page views (no history patching, one script)', () => {
    initAnalytics(TOKEN, '?c=onion&d=2024-01-01')
    const push = history.pushState, replace = history.replaceState
    for (let i = 0; i < 50; i++) history.replaceState(null, '', `?c=onion&d=2024-01-${String((i % 28) + 1).padStart(2, '0')}`)
    expect(history.pushState).toBe(push)
    expect(history.replaceState).toBe(replace)
    expect(beacons()).toHaveLength(1)
  })

  it('never throws when the DOM refuses the script (blocked/failed beacon)', () => {
    const broken = { querySelector: () => null, createElement: () => { throw new Error('blocked') } } as unknown as Document
    expect(() => initAnalytics(TOKEN, '', broken)).not.toThrow()
    expect(initAnalytics(TOKEN, '', broken).status).toBe('error')
  })
})
