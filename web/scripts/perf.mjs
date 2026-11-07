// Measure first-screen time, frame rate during the route animation, and JS heap: node scripts/perf.mjs <url>
import { chromium } from '@playwright/test'
const url = process.argv[2]
const b = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const out = {}
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const p = await b.newPage({ viewport: vp })
  const t0 = Date.now()
  await p.goto(url)
  await p.getByRole('heading', { level: 1 }).waitFor()
  const h1 = Date.now() - t0
  await p.waitForSelector('.board-map canvas')
  const nav = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null } })
  await p.waitForTimeout(1500)
  await p.locator('.st-dots button').nth(3).click()
  const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 4000) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t))) }; requestAnimationFrame(f) }))
  const heap1 = await p.evaluate(() => performance.memory?.usedJSHeapSize ?? null)
  for (let k = 0; k < 3; k++) for (let i = 0; i < 8; i++) { await p.locator('.st-dots button').nth(i).click(); await p.waitForTimeout(250) }
  const heap2 = await p.evaluate(() => performance.memory?.usedJSHeapSize ?? null)
  const gl = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c?.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown' })
  out[name] = { h1VisibleMs: h1, ...nav, routeAnimationFps: fps, heapMB: [heap1, heap2].map((h) => (h ? +(h / 1e6).toFixed(1) : null)), renderer: gl }
  await p.close()
}
await b.close()
console.log(JSON.stringify(out, null, 1))
