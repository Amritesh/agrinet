import { test, expect, type APIRequestContext } from '@playwright/test'

// Acceptance against the generated catalog, never invented story fixtures.
async function catalog(request: APIRequestContext) {
  const response = await request.get('stories/catalog.json')
  expect(response.ok()).toBe(true)
  return response.json()
}

test('home shows qualifying modeled-margin stories, not research dashboards', async ({ page, request }) => {
  const c = await catalog(request)
  expect(c.story_count).toBeGreaterThan(0)
  expect(Object.keys(c.products).length).toBeGreaterThan(100)
  await page.goto('./')
  await expect(page).toHaveURL(new RegExp(`\\?story=${c.featured[0].id}$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.featured[0].title)
  await expect(page.getByRole('note')).toContainText('not verified profit')
  await expect(page.getByRole('combobox', { name: 'Product' }).locator('option')).toHaveCount(Object.keys(c.products).length)
  await expect(page.locator('.st-evidence')).toContainText('Modeled outcomes, not realized trades')
  for (const x of ['Opportunity Lab', 'Network Optimizer', 'Simulation Studio', 'Research tools'])
    await expect(page.getByRole('button', { name: x })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('published evidence reconciles and admits missing offers and freight quotes', async ({ page, request }) => {
  const c = await catalog(request), f = c.featured[0]
  const stories = await (await request.get(`stories/${f.commodity}/${f.period.slice(0, 4)}.json`)).json()
  const s = stories.find((x: { id: string }) => x.id === f.id)
  expect(s.verdict).toBe('positive_modeled_surplus')
  expect(s.trades.length).toBe(s.facts.n)
  expect(s.facts.net_baseline).toBeGreaterThan(0)
  expect(s.facts.net_adverse).toBeGreaterThan(0)
  expect(s.facts.inf_adverse).toBeGreaterThan(0)
  expect(s.routes[0].truck_suitable).toBe(false)
  expect(s.markets.every((m: { precision: string }) => !m.precision.includes('centroid'))).toBe(true)
  expect(s.evidence.caveats.join(' ')).toContain('no actual shipment')
  const w = s.facts.wf_base
  expect(w.sell - w.buy - w.freight - w.fees - w.loading - w.loss - w.interest).toBeCloseTo(w.net, 1)
  await page.goto(`?story=${s.id}`)
  await page.getByText('Sources, assumptions and limits').click()
  await expect(page.locator('.prov')).toContainText('not offers')
  await expect(page.locator('.prov')).toContainText('not a verified truck route')
})

test('all indexed products remain selectable even when no story qualifies', async ({ page, request }) => {
  const c = await catalog(request)
  const zero = Object.entries(c.products).find(([, p]) => (p as { stories: number }).stories === 0)
  expect(zero).toBeTruthy()
  await page.goto('./')
  await page.getByRole('combobox', { name: 'Product' }).selectOption(zero![0])
  await expect(page.getByRole('heading', { name: 'No trade story available' })).toBeVisible()
  await expect(page).not.toHaveURL(/\?story=/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('story player, static share page and deep link work on mobile and desktop', async ({ page, request, context }) => {
  const c = await catalog(request), f = c.featured[0]
  await page.goto('./')
  await page.getByRole('button', { name: 'Next scene' }).click()
  await expect(page.locator('.st-step')).toHaveText('Scene 2 of 8')
  await page.getByRole('button', { name: 'Skip to conclusion' }).click()
  await expect(page.locator('.st-step')).toHaveText('Scene 8 of 8')
  await page.getByRole('button', { name: 'Replay' }).click()
  await expect(page.locator('.st-step')).toHaveText('Scene 1 of 8')
  await page.getByRole('button', { name: 'Pause' }).click()
  const p2 = await context.newPage()
  await p2.goto(`s/${f.id}/`)
  await expect(p2.getByRole('heading', { level: 1 })).toHaveText(f.title)
  expect(await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('legacy explore and research remain addressable but are not default tabs', async ({ page }) => {
  await page.goto('?mode=explore')
  await expect(page.getByRole('application', { name: 'India agricultural intelligence map' })).toBeVisible()
  await page.goto('?mode=research')
  await expect(page.getByRole('navigation', { name: 'Workspaces' })).toBeVisible()
})
