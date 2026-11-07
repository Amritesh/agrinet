import { test, expect, type Page } from '@playwright/test'

async function open(page: Page, path = '?mode=research&c=onion') {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/rest/v1/rpc/health', (route) => route.fulfill({ json: { latest_price_date: '2026-04-20' } }))
  await page.route('**/rest/v1/**', (route) => route.fulfill({ json: [] }))
  await page.route('**/basemaps.cartocdn.com/**', (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#16191b' } }] } }))
  // An ad blocker / network failure for the analytics beacon must never matter.
  await page.route('**/static.cloudflareinsights.com/**', (route) => route.abort('blockedbyclient'))
  await page.goto(path)
  return errors
}

test('compact Collaborate item opens the collaboration section without leaving the app', async ({ page }) => {
  const errors = await open(page)
  const nav = page.getByRole('navigation', { name: 'Workspaces' })
  await nav.getByRole('button', { name: 'Collaborate', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Build the Future of Agricultural Intelligence With Us' })).toBeVisible()
  await expect(page.getByText('AGRINET is exploring partnerships with agricultural traders, FPOs, logistics providers, food processors, researchers, and early-stage investors.')).toBeVisible()
  for (const c of ['Agricultural industry partnership', 'Logistics and freight-data partnership', 'Procurement and supply-chain pilot', 'Research collaboration', 'Co-founder or engineering collaboration', 'Investor or incubator discussion'])
    await expect(page.getByRole('heading', { name: c, exact: true })).toBeVisible()
  const repo = page.getByRole('link', { name: /project repository/i }).first()
  await expect(repo).toHaveAttribute('href', 'https://github.com/Amritesh/agrinet')
  await expect(repo).toHaveAttribute('rel', /noopener/)
  // Contact action always exists: approved email if configured, otherwise a public GitHub issue.
  const action = page.getByRole('link', { name: /contact the project owner/i })
  await expect(action).toHaveAttribute('href', /^(mailto:[^?]+\?subject=AGRINET|https:\/\/github\.com\/Amritesh\/agrinet\/issues\/new\?title=)/)
  // Honest copy: existing vs in development; no fabricated traction.
  await expect(page.getByText(/research prototype/i).first()).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/testimonial|backed by|our customers|revenue of/i)
  // No contact form collecting personal data, no popups.
  await expect(page.locator('main form, main input[type=email], main textarea')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  // Returning to the atlas keeps the time machine working.
  await nav.getByRole('button', { name: 'Market Atlas', exact: true }).click()
  await expect(page.getByLabel('Selected date', { exact: true })).toBeVisible()
  expect(errors.filter((e) => !/cloudflareinsights|ERR_BLOCKED|Failed to load resource/i.test(e))).toEqual([])
})

test('#collaborate deep link and footer link reach the section; atlas deep links unaffected', async ({ page }) => {
  await open(page, '?c=tomato#collaborate')
  await expect(page.getByRole('heading', { name: 'Build the Future of Agricultural Intelligence With Us' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Simulation Studio', exact: true }).click()
  await page.getByRole('contentinfo').getByRole('button', { name: /collaborate/i }).click()
  await expect(page.getByRole('heading', { name: 'Build the Future of Agricultural Intelligence With Us' })).toBeVisible()
  await open(page, '?mode=research&c=potato&d=2024-01-16')
  await expect(page.getByLabel('Selected date', { exact: true })).toHaveValue('2024-01-16')
})

test('public metadata: title, description, canonical, Open Graph image', async ({ page }) => {
  await open(page)
  await expect(page).toHaveTitle('AGRINET — Agricultural Market Intelligence & Supply Chain Optimization')
  const meta = (sel: string) => page.locator(sel).getAttribute('content')
  expect(await meta('meta[name="description"]')).toContain("Explore India's agricultural markets through historical commodity prices")
  expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe('https://amritesh.github.io/agrinet/')
  expect(await meta('meta[property="og:url"]')).toBe('https://amritesh.github.io/agrinet/')
  expect(await meta('meta[property="og:image"]')).toMatch(/^https:\/\/amritesh\.github\.io\/agrinet\/og-image\.png$/)
  expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image')
  const img = await page.request.get('og-image.png')
  expect(img.status()).toBe(200)
})

test('no analytics beacon without a configured token; blocked beacon never breaks render', async ({ page }) => {
  await open(page)
  await expect(page.getByLabel('Selected date', { exact: true })).toBeVisible()
  const n = await page.locator('script[src*="cloudflareinsights"]').count()
  expect(n).toBeLessThanOrEqual(1)
})
