// Mobile audit: node scripts/mobile-audit.mjs <baseUrl> <outDir>
// Per viewport: horizontal overflow, small tap targets (<44px), tiny text (<12px),
// whether the scene caption + Play/Next are visible without scrolling, and screenshots.
import { chromium, devices } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
const [base, out] = [process.argv[2], process.argv[3]]
await mkdir(out, { recursive: true })
const VPS = { 'p360': { width: 360, height: 740 }, 'p390': { width: 390, height: 844 }, 'p430': { width: 430, height: 932 }, 'land': { width: 844, height: 390 } }
const b = await chromium.launch()
const audit = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const small = [...document.querySelectorAll('a, button, select, summary, [role=button]')].filter(vis).map((el) => { const r = el.getBoundingClientRect(); return { t: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) } }).filter((x) => x.h < 44 || x.w < 44)
  const tiny = new Set()
  for (const el of document.querySelectorAll('body *')) { if (!vis(el) || !el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const f = parseFloat(getComputedStyle(el).fontSize); if (f < 12) tiny.add(`${el.className || el.tagName}:${f}`) }
  const inView = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }
  const stage = document.querySelector('.st-stage, .map-stage, .maplibregl-map')?.getBoundingClientRect()
  return { overflowX: document.documentElement.scrollWidth - innerWidth, small, tiny: [...tiny].slice(0, 15), captionInView: inView('.st-caption'), playInView: inView('.st-controls'), titleInView: inView('.st-title'), mapH: stage ? Math.round(stage.height) : null, docH: document.documentElement.scrollHeight }
}
const res = {}
for (const [name, vp] of Object.entries(VPS)) {
  const ctx = await b.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['Pixel 7'].userAgent })
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)))
  await p.goto(base); await p.getByRole('heading', { level: 1 }).waitFor(); await p.waitForTimeout(2500)
  res[name] = { home: await p.evaluate(audit) }
  await p.screenshot({ path: `${out}/${name}-home.png` })
  for (const i of [3, 4, 6]) { await p.locator('.st-dots button').nth(i).click(); await p.waitForTimeout(2600); await p.screenshot({ path: `${out}/${name}-scene${i}.png` }); res[name][`scene${i}`] = await p.evaluate(audit) }
  await p.screenshot({ path: `${out}/${name}-scene6-full.png`, fullPage: true })
  await p.goto(base + '?story=onion-2013-08-shock'); await p.getByRole('heading', { level: 1 }).waitFor(); await p.locator('.st-dots button').nth(1).click(); await p.waitForTimeout(2600); await p.screenshot({ path: `${out}/${name}-shock.png` })
  await p.goto(base + '?mode=explore'); await p.waitForTimeout(4000); res[name].explore = await p.evaluate(audit); await p.screenshot({ path: `${out}/${name}-explore.png` })
  await p.goto(base + '?mode=research'); await p.waitForTimeout(4000); res[name].research = await p.evaluate(audit); await p.screenshot({ path: `${out}/${name}-research.png` })
  res[name].errors = errs
  await ctx.close()
}
await b.close()
console.log(JSON.stringify(res, null, 1))
