// Static share pages + PNG preview cards for featured AGRINET stories.
// GitHub Pages is static and social crawlers do not run React, so each featured story
// gets /s/<id>/index.html with its own Open Graph tags and an original og.png card.
// Usage (after `python -m pipeline.stories`):  node scripts/share-page.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const ID = /^(onion|potato|tomato)-\d{4}-\d{2}(-[a-z0-9-]+)?$/

export function sharePageHtml(story, site) {
  if (!ID.test(story.id)) throw new Error(`unsafe story id ${story.id}`)
  const base = site.replace(/\/?$/, '/')
  const page = `${base}s/${story.id}/`
  const app = `${base}?story=${story.id}`
  const title = `${story.title} · ${monthLabel(story.period)}`
  const desc = `${story.summary} Historical data, not live prices; any trade shown is a model, not a claimed transaction.`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · AGRINET</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(page)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="AGRINET">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(page)}">
<meta property="og:image" content="${esc(page)}og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)} — AGRINET story card">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(page)}og.png">
<style>body{font-family:Georgia,serif;background:#faf4e6;color:#1b2e40;max-width:640px;margin:10vh auto;padding:0 20px}a{color:#94592a}</style>
</head>
<body>
<p>AGRINET story</p>
<h1>${esc(story.title)}</h1>
<p>${esc(story.summary)}</p>
<p><small>Historical data, not live prices. Reported mandi modal prices; any trade shown is modeled.</small></p>
<p><a href="${esc(app)}">Open the story →</a></p>
<script>location.replace(${JSON.stringify(app)})</script>
</body>
</html>
`
}

function cardHtml(story, states) {
  // Equirectangular projection of India into the right half of a 1200×630 card.
  const [x0, x1, y0, y1] = [68, 97.5, 6.5, 35.7]
  const W = 520, H = 570, ox = 650, oy = 30
  const sx = W / (x1 - x0), sy = H / (y1 - y0), s = Math.min(sx, sy)
  const P = ([lon, lat]) => [ox + (lon - x0) * s, oy + (y1 - lat) * s]
  const ring = (r) => r.map((c, i) => `${i ? 'L' : 'M'}${P(c).map((v) => v.toFixed(1)).join(',')}`).join('') + 'Z'
  const d = states.features.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)).map((poly) => ring(poly[0])).join('')
  const route = story.routes?.[0]?.path?.map((c, i) => `${i ? 'L' : 'M'}${P(c).map((v) => v.toFixed(1)).join(',')}`).join('') ?? ''
  const pts = (story.kind === 'shock' ? story.markets.slice(0, 80) : story.markets).map((m) => {
    const [x, y] = P([m.lon, m.lat])
    const r = story.kind === 'shock' ? 4 + Math.min(8, Math.abs(m.pct ?? 0) / 14) : 9
    const fill = story.kind === 'shock' ? ((m.pct ?? 0) >= 0 ? '#b0402c' : '#2c5c8a') : '#b87333'
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" fill-opacity="${story.kind === 'shock' ? 0.7 : 1}" stroke="#1b2e40" stroke-width="2"/>`
  }).join('')
  const kind = { shock: 'Price shock', corridor: 'Hypothetical trade · modeled', storage: 'Storage decision · modeled' }[story.kind]
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1200px;height:630px;background:#faf4e6;font-family:Georgia,'Times New Roman',serif;color:#1b2e40;position:relative;overflow:hidden}
  .l{position:absolute;left:56px;top:56px;width:560px}
  .b{font:700 22px Georgia;letter-spacing:.2em}.b span{color:#b87333}
  .k{margin-top:46px;font:600 17px system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#94592a}
  h1{font-size:52px;line-height:1.08;margin:14px 0 18px}
  p{font:400 22px/1.4 system-ui,sans-serif;color:#33434f;margin:0}
  .f{position:absolute;left:56px;bottom:40px;font:500 16px system-ui,sans-serif;color:#5a4a2c;background:#efe3c8;padding:8px 14px;border-radius:8px}
  </style></head><body>
  <svg width="1200" height="630" style="position:absolute;inset:0"><path d="${d}" fill="#1b2e40" opacity=".25" transform="translate(5,7)"/><path d="${d}" fill="#f3ead4" stroke="#3b4f60" stroke-width="1" stroke-opacity=".5"/>
  ${route ? `<path d="${route}" fill="none" stroke="#1b2e40" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="${route}" fill="none" stroke="#b87333" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}${pts}</svg>
  <div class="l"><div class="b"><span>◈</span> AGRINET</div><div class="k">${esc(kind)} · ${esc(monthLabel(story.period))}</div><h1>${esc(story.title)}</h1><p>${esc(story.summary)}</p></div>
  <div class="f">Historical data, not live prices · reported mandi modal prices</div>
  </body></html>`
}

async function main() {
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const site = process.env.SITE_URL ?? 'https://amritesh.github.io/agrinet/'
  const catPath = path.join(web, 'public/stories/catalog.json')
  const cat = JSON.parse(await readFile(catPath, 'utf8'))
  const states = JSON.parse(await readFile(path.join(web, 'public/geo/india_states.geojson'), 'utf8'))
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  const pages = []
  for (const f of cat.featured) {
    const year = JSON.parse(await readFile(path.join(web, `public/stories/${f.commodity}/${f.period.slice(0, 4)}.json`), 'utf8'))
    const story = year.find((s) => s.id === f.id)
    const dir = path.join(web, 'public/s', story.id)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'index.html'), sharePageHtml(story, site))
    await page.setContent(cardHtml(story, states))
    await page.screenshot({ path: path.join(dir, 'og.png') })
    pages.push(story.id)
    console.log('card', story.id)
  }
  await browser.close()
  cat.pages = pages
  await writeFile(catPath, JSON.stringify(cat))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main()
