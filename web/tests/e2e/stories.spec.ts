import { test, expect, type Page } from '@playwright/test'

// AGRINET 4.0 acceptance: Stories home + Explore, real generated story data, no mocks of story content.
const FEATURED = 'onion-2023-02-gap-lasalgaon-azadpur'

async function guard(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error' && !/cloudflareinsights|Failed to load resource.*(rest|rpc)/i.test(m.text())) errors.push(m.text()) })
  await page.route('**/static.cloudflareinsights.com/**', (r) => r.abort('blockedbyclient'))
  return errors
}

test('first visit: Stories is the home, a real featured story loads with labels, no forms or workspace tabs', async ({ page }) => {
  const errors = await guard(page)
  const t0 = Date.now()
  await page.goto('./')
  const h1 = page.getByRole('heading', { level: 1 })
  await expect(h1).toBeVisible()
  const firstScreenMs = Date.now() - t0
  test.info().annotations.push({ type: 'firstScreenMs', description: String(firstScreenMs) })
  await expect(page).toHaveURL(new RegExp(`\\?story=${FEATURED}$`))
  await expect(page.getByRole('button', { name: /Watch the story/ })).toBeVisible()
  await expect(page.getByRole('note')).toContainText('Historical data, not live prices')
  await expect(page.getByRole('note')).toContainText('latest observation 20 Apr 2026')
  for (const c of ['Onion', 'Tomato', 'Potato']) await expect(page.getByRole('group', { name: 'Commodity' }).getByRole('button', { name: c })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Month' })).toHaveValue('02')
  await expect(page.getByRole('combobox', { name: 'Year' })).toHaveValue('2023')
  // Ruthless simplification: none of the engineering workspaces in the default view.
  for (const gone of ['Opportunity Lab', 'Network Optimizer', 'Simulation Studio', 'Shocks', 'News', 'Analytics'])
    await expect(page.getByRole('button', { name: gone, exact: true })).toHaveCount(0)
  await expect(page.locator('input[type=number], input[type=text]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Collaborate', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('every number in the featured story resolves to the published evidence file', async ({ page, request }) => {
  const stories = await (await request.get('stories/onion/2023.json')).json()
  const s = stories.find((x: { id: string }) => x.id === FEATURED)
  expect(s.trades.length).toBe(s.facts.n)
  // Reproduce the gross gap median from the published trade rows.
  const g = s.trades.map((t: { gross: number; sell_price: number; buy_price: number }) => { expect(t.gross).toBeCloseTo(t.sell_price - t.buy_price, 2); return t.gross }).sort((a: number, b: number) => a - b)
  const m = g.length % 2 ? g[(g.length - 1) / 2] : (g[g.length / 2 - 1] + g[g.length / 2]) / 2
  expect(Math.round(m)).toBe(s.facts.gross_median)
  // Waterfall reconciles to the stated net.
  const w = s.facts.wf_base
  expect(w.sell - w.buy - w.freight - w.fees - w.loading - w.loss - w.interest).toBeCloseTo(w.net, 1)
  // Costs are cited or labelled as assumptions; no freight quote is claimed.
  expect(s.assumptions.every((a: { kind: string }) => ['sourced', 'assumption', 'missing'].includes(a.kind))).toBe(true)
  expect(JSON.stringify(s)).not.toMatch(/freight quote(?!s? (?:exist|are unavailable))/i)
  expect(s.routes[0].truck_suitable).toBe(false)
  for (const mk of s.markets) expect(mk.precision).toBeTruthy()
  await page.goto(`?story=${FEATURED}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(s.title)
})

test('story plays without interaction, reveals route, costs, strategy and conclusion; controls work', async ({ page }) => {
  const errors = await guard(page)
  await page.clock.install()
  await page.goto(`?story=${FEATURED}`)
  await page.getByRole('button', { name: /Watch the story/ }).click()
  const step = page.locator('.st-step')
  await expect(step).toHaveText(/Scene 1 of 8/)
  await page.clock.runFor(15000)
  await expect(step).toHaveText(/Scene 2 of 8/)
  for (let i = 0; i < 8; i++) await page.clock.runFor(13000)
  await expect(step).toHaveText(/Scene 8 of 8/)
  await expect(page.getByRole('heading', { name: 'The lesson' })).toBeVisible()
  await expect(page.locator('.st-caveats')).toContainText('no actual shipment is claimed')
  // Previous / Next / scene dots / skip / replay.
  await page.getByRole('button', { name: 'Previous scene' }).click()
  await expect(step).toHaveText(/Scene 7 of 8/)
  await expect(page.getByRole('heading', { name: 'Hindsight vs. a real trader' })).toBeVisible()
  await page.getByRole('button', { name: /Scene 5:/ }).click()
  await expect(page.getByText('Modeled net', { exact: true })).toBeVisible()
  await expect(page.locator('.wf-row').filter({ hasText: 'Freight' })).toContainText('₹240')
  await page.getByRole('button', { name: 'Skip to conclusion' }).click()
  await expect(step).toHaveText(/Scene 8 of 8/)
  await page.getByRole('button', { name: 'Replay' }).click()
  await expect(step).toHaveText(/Scene 1 of 8/)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.clock.runFor(30000)
  await expect(step).toHaveText(/Scene 1 of 8/)
  expect(errors).toEqual([])
})

test('provenance panel discloses sources, assumptions and the known data limits', async ({ page }) => {
  await page.goto(`?story=${FEATURED}`)
  await page.getByText('Sources, assumptions and limits').click()
  const prov = page.locator('.prov')
  await expect(prov).toContainText('historical, not current')
  await expect(prov).toContainText('not offers')
  await expect(prov).toContainText('no freight quotes')
  await expect(prov).toContainText('sub-yards')
  await expect(prov).toContainText('not a verified truck route')
  await expect(prov.getByRole('link', { name: /RBI Working Paper/ })).toHaveAttribute('href', /rbi\.org\.in/)
  await expect(prov.locator('.pk-assumption').first()).toBeVisible()
})

test('share link reproduces the exact story; month selector never fabricates', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined }) })
  await page.goto(`?story=${FEATURED}`)
  await page.getByRole('button', { name: 'Share this story' }).click()
  await expect(page.getByRole('status')).toHaveText(/Link copied|agrinet/)
  // Switch commodity & month: a real story for that month, or the nearest one, labelled.
  await page.getByRole('group', { name: 'Commodity' }).getByRole('button', { name: 'Tomato' }).click()
  await expect(page).toHaveURL(/\?story=tomato-/)
  await expect(page.locator('.st-note')).toContainText(/No well-supported tomato story for February 2023|^$/)
  await page.getByRole('group', { name: 'Commodity' }).getByRole('button', { name: 'Onion' }).click()
  await page.getByRole('combobox', { name: 'Year' }).selectOption('2013')
  await page.getByRole('combobox', { name: 'Month' }).selectOption('08')
  await expect(page).toHaveURL(/\?story=onion-2013-08-shock$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The month onion prices jumped across India')
  const url = page.url()
  const p2 = await context.newPage()
  await p2.goto(url)
  await expect(p2.getByRole('heading', { level: 1 })).toHaveText('The month onion prices jumped across India')
  await p2.goto('?story=onion-1999-01-shock')
  await expect(p2.locator('.st-note.bad')).toContainText('was not found')
  await expect(p2.getByRole('heading', { level: 1 })).toBeVisible()
})

test('Explore is a clean map; research tools and collaborate stay reachable', async ({ page }) => {
  await page.route('**/rest/v1/rpc/health', (r) => r.fulfill({ json: { latest_price_date: '2026-04-20' } }))
  await page.goto('./')
  await page.getByRole('link', { name: 'Explore map' }).click()
  await expect(page).toHaveURL(/mode=explore/)
  await expect(page.getByRole('application', { name: 'India agricultural intelligence map' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Workspaces' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Views' })).toHaveCount(0)
  await expect(page.locator('details.layers')).toHaveCount(0)
  await expect(page.getByLabel('Selected date', { exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: 'Modes' }).getByRole('link', { name: 'Research tools' }).click()
  await expect(page.getByRole('navigation', { name: 'Workspaces' })).toBeVisible()
  await page.getByRole('link', { name: '← Stories' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.getByRole('contentinfo').getByRole('link', { name: 'Collaborate with AGRINET' }).click()
  await expect(page.getByRole('heading', { name: 'Build the Future of Agricultural Intelligence With Us' })).toBeVisible()
})

test('reduced motion: story still complete, no route animation required', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`?story=${FEATURED}`)
  await page.getByRole('button', { name: /Scene 4:/ }).click()
  await expect(page.getByRole('heading', { name: /km by road/ })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('reduced-motion-route.png') })
})
