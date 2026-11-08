import { test, expect, type Page } from '@playwright/test'

// Phone layouts for the Stories home. These run in every project but set their own viewport.
async function featured(page: Page) {
  const c = await (await page.request.get('stories/catalog.json')).json()
  return c.featured[0].id as string
}
const inView = (page: Page, sel: string) => page.evaluate((s) => {
  const r = document.querySelector(s)!.getBoundingClientRect()
  return r.top >= 0 && r.bottom <= innerHeight + 1 && r.height > 0
}, sel)
const smallTargets = (page: Page, sel: string) => page.evaluate((s) => [...document.querySelectorAll<HTMLElement>(s)]
  .filter((e) => e.offsetParent !== null)
  .map((e) => { const r = e.getBoundingClientRect(); return { n: e.getAttribute('aria-label') ?? e.textContent?.trim(), w: Math.round(r.width), h: Math.round(r.height) } })
  .filter((x) => x.h < 40 || x.w < 40), sel)

for (const vp of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
  test.describe(`phone portrait ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: true, isMobile: true })

    test('player bar, title and map are on screen at first load; page scrolls; no sideways overflow', async ({ page }) => {
      await page.goto(`?story=${await featured(page)}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await inView(page, '.st-controls')).toBe(true)
      expect(await inView(page, '.st-title')).toBe(true)
      const map = await page.locator('.st-stage').boundingBox()
      expect(map!.height).toBeGreaterThanOrEqual(220)
      // Nothing wider than the phone: otherwise mobile browsers zoom the whole page out.
      expect(await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth])).toEqual([vp.width, vp.width])
      // Map stays pinned while reading further down the story.
      await page.evaluate(() => window.scrollBy(0, 300))
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100)
      expect(Math.round((await page.locator('.st-stage').boundingBox())!.y)).toBe(0)
      // The rest of the story (more stories, footer) must be reachable by scrolling.
      const foot = page.getByRole('contentinfo').getByRole('link', { name: 'Collaborate' })
      await foot.scrollIntoViewIfNeeded()
      await expect(foot).toBeInViewport()
    })

    test('tap targets are finger-sized and scene changes keep the caption readable', async ({ page }) => {
      await page.goto(`?story=${await featured(page)}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await smallTargets(page, '.st-top a, .st-top button, .st-top select, .st-dots button, .st-controls button')).toEqual([])
      for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next scene' }).tap()
      await expect(page.locator('.st-step')).toHaveText('Scene 5 of 8')
      await expect(page.locator('.st-headline')).toBeInViewport()
      expect(await inView(page, '.st-controls')).toBe(true)
      // Caption starts below the pinned map, not hidden underneath it.
      const [cap, map] = await Promise.all([page.locator('.st-headline').boundingBox(), page.locator('.st-stage').boundingBox()])
      expect(cap!.y).toBeGreaterThanOrEqual(map!.y + map!.height - 1)
    })
  })
}

test.describe('phone landscape 844×390', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true })
  test('map and story sit side by side with the player reachable and the corridor framed', async ({ page }) => {
    await page.goto(`?story=${await featured(page)}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const [map, panel] = await Promise.all([page.locator('.st-stage').boundingBox(), page.locator('.st-panel').boundingBox()])
    expect(map!.width).toBeGreaterThan(300)
    expect(map!.height).toBeGreaterThan(250)
    expect(panel!.x).toBeGreaterThanOrEqual(map!.x + map!.width - 1)
    expect(await inView(page, '.st-controls')).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
  })
})

test.describe('Explore on a phone 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  test('finger-sized controls, page fits the screen, attribution folds away from the map', async ({ page }) => {
    await page.route('**/rest/v1/rpc/health', (r) => r.fulfill({ json: { latest_price_date: '2026-04-20' } }))
    await page.goto('?mode=explore')
    await expect(page.getByRole('application', { name: 'India agricultural intelligence map' })).toBeVisible()
    expect(await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth])).toEqual([390, 390])
    expect(await smallTargets(page, '.topbar button, .topbar a, .timeline button, .timeline select, .maplibregl-ctrl-group button')).toEqual([])
    await expect(page.locator('.maplibregl-ctrl-attrib.maplibregl-compact-show')).toHaveCount(0, { timeout: 8000 })
    await expect(page.locator('.maplibregl-ctrl-attrib-button')).toBeVisible()
    const map = await page.getByRole('application', { name: 'India agricultural intelligence map' }).boundingBox()
    expect(map!.height).toBeGreaterThan(360)
  })
})
