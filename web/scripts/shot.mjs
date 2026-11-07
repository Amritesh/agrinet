// Quick visual probe: node shot.mjs <url> <outprefix>
import { chromium } from '@playwright/test'
const [url, out] = process.argv.slice(2)
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1 })
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e)))
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  const t0 = Date.now()
  await p.goto(url)
  await p.getByRole('heading', { level: 1 }).waitFor({ timeout: 20000 })
  console.log(name, 'h1 visible ms', Date.now() - t0)
  await p.waitForTimeout(2500)
  await p.screenshot({ path: `${out}-${name}-0.png` })
  const n = await p.locator('.st-dots button').count()
  const want = (process.argv[4] ?? '3,4,last').split(',').map((x) => (x === 'last' ? n - 1 : Number(x)))
  for (const i of want) {
    await p.locator('.st-dots button').nth(i).click()
    await p.waitForTimeout(3000)
    await p.screenshot({ path: `${out}-${name}-${i}.png` })
  }
  console.log(name, 'errors', JSON.stringify(errs.slice(0, 5)))
  await p.close()
}
await b.close()
