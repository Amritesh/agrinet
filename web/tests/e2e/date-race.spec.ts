import { test, expect, type Page } from '@playwright/test'

const coverage = [2004, 2026].map(year => ({ commodity_id: 23, year, n_rows: 1, n_markets: 1, n_days: 1, n_states: 1 }))
const latest = '2026-11-05'
const endpoints = { coverage: '**/data/coverage.json', health: '**/rest/v1/rpc/health' }
type Endpoint = keyof typeof endpoints

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

async function settleBrowser(page: Page) {
  // Let fetch handlers and React commits finish before releasing the other API.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function initialize(page: Page, options: {
  first: Endpoint
  query?: string
  rows?: typeof coverage
  coverageFails?: boolean
  healthFails?: boolean
  health?: Record<string, unknown>
  beforeResponses?: () => Promise<void>
}) {
  const gates = { coverage: gate(), health: gate() }
  const requests = { coverage: 0, health: 0 }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  // No live DB reads: only initialization responses vary in these tests.
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }))
  await page.route('**/data/markets.json', route => route.fulfill({ json: [] }))
  for (const endpoint of ['coverage', 'health'] as const) {
    await page.route(endpoints[endpoint], async route => {
      requests[endpoint]++
      await gates[endpoint].promise
      const fails = endpoint === 'coverage' ? options.coverageFails : options.healthFails
      // Invalid JSON models a rejected static fetch; the RPC rejects an HTTP error.
      if (fails) await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable' })
      else await route.fulfill({ json: endpoint === 'coverage' ? options.rows ?? coverage : options.health ?? { latest_price_date: latest } })
    })
  }
  await page.goto(`?v=news${options.query ?? ''}`)
  // Exercise the real dev entrypoint's StrictMode setup/cleanup/setup replay.
  await expect.poll(() => requests.coverage).toBe(2)
  await expect.poll(() => requests.health).toBe(2)
  await options.beforeResponses?.()
  for (const endpoint of [options.first, options.first === 'health' ? 'coverage' : 'health'] as Endpoint[]) {
    const response = page.waitForResponse(endpoints[endpoint])
    gates[endpoint].release()
    await (await response).finished()
    await settleBrowser(page)
  }
  return { date: page.getByLabel('Selected date', { exact: true }), errors }
}

for (const first of ['health', 'coverage'] as const) {
  for (const linkedDate of [null, '2024-01-15', '2026-10-01']) {
    test(`${first} first: observed range and ${linkedDate ? `deep link ${linkedDate}` : 'default latest'} survive reversed response order`, async ({ page }) => {
      const { date, errors } = await initialize(page, { first, query: linkedDate ? `&d=${linkedDate}` : '' })
      await expect(date).toHaveAttribute('max', latest, { timeout: 2000 })
      await expect(date).toHaveAttribute('min', '2004-01-01')
      await expect(date).toHaveValue(linkedDate ?? latest)
      await expect(page).toHaveURL(new RegExp(`d=${linkedDate ?? latest}`))
      await expect(page.getByLabel('Comparison date (before/after)', { exact: true })).toHaveAttribute('max', latest)
      await page.getByRole('button', { name: 'Jump to latest', exact: true }).click()
      await expect(date).toHaveValue(latest)
      expect(errors).toEqual([])
    })
  }

  test(`${first} first: a date selected while initialization is pending is preserved`, async ({ page }) => {
    const { date, errors } = await initialize(page, {
      first,
      beforeResponses: () => page.getByLabel('Selected date', { exact: true }).fill('2024-01-15'),
    })
    await expect(date).toHaveAttribute('max', latest)
    await expect(date).toHaveValue('2024-01-15', { timeout: 2000 })
    expect(errors).toEqual([])
  })

  test(`${first} first: health failure falls back to observed coverage years`, async ({ page }) => {
    const { date, errors } = await initialize(page, { first, healthFails: true })
    await expect(page.locator('.health')).toContainText('API down')
    await expect(date).toHaveAttribute('min', '2004-01-01')
    await expect(date).toHaveAttribute('max', '2026-12-31')
    await page.getByRole('button', { name: 'Jump to latest', exact: true }).click()
    await expect(date).toHaveValue('2026-12-31')
    expect(errors).toEqual([])
  })
}

for (const coverageFails of [false, true]) {
  test(`${coverageFails ? 'failed' : 'empty'} coverage still uses health latest`, async ({ page }) => {
    const { date, errors } = await initialize(page, { first: 'health', rows: [], coverageFails })
    await expect(date).toHaveAttribute('min', '2001-01-01')
    await expect(date).toHaveAttribute('max', latest)
    await expect(date).toHaveValue(latest)
    expect(errors).toEqual([])
  })

  test(`${coverageFails ? 'failed' : 'empty'} coverage plus failed health preserves safe initial range`, async ({ page }) => {
    const { date, errors } = await initialize(page, { first: 'coverage', rows: [], coverageFails, healthFails: true })
    await expect(page.locator('.health')).toContainText('API down')
    await expect(date).toHaveAttribute('min', '2001-01-01')
    await expect(date).toHaveAttribute('max', '2026-04-20')
    await expect(date).toHaveValue('2026-04-20')
    expect(errors).toEqual([])
  })
}

for (const health of [{ latest_price_date: null }, { latest_price_date: 'not-a-date' }]) {
  test(`health date ${String(health.latest_price_date)} falls back to coverage`, async ({ page }) => {
    const { date, errors } = await initialize(page, { first: 'coverage', health })
    await expect(date).toHaveAttribute('min', '2004-01-01')
    await expect(date).toHaveAttribute('max', '2026-12-31')
    expect(errors).toEqual([])
  })
}

test('StrictMode cleanup ignores stale initialization completing after the active effect', async ({ page }) => {
  const stale = gate()
  const requests = { coverage: 0, health: 0 }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }))
  await page.route('**/data/markets.json', route => route.fulfill({ json: [] }))
  for (const endpoint of ['coverage', 'health'] as const) {
    await page.route(endpoints[endpoint], async route => {
      const old = ++requests[endpoint] === 1
      if (old) await stale.promise
      const json = endpoint === 'coverage'
        ? old ? [{ ...coverage[0], year: 2010 }] : coverage
        : { latest_price_date: old ? '2010-06-01' : latest }
      await route.fulfill({ json })
    })
  }
  await page.goto('?v=news')
  await expect.poll(() => requests.coverage).toBe(2)
  await expect.poll(() => requests.health).toBe(2)
  const date = page.getByLabel('Selected date', { exact: true })
  await expect(date).toHaveValue(latest)
  const responses = Object.values(endpoints).map(endpoint => page.waitForResponse(endpoint))
  stale.release()
  await Promise.all((await Promise.all(responses)).map(response => response.finished()))
  await settleBrowser(page)
  await expect(date).toHaveAttribute('min', '2004-01-01')
  await expect(date).toHaveAttribute('max', latest)
  await expect(date).toHaveValue(latest)
  await expect(page.locator('.health')).toContainText(`data to ${latest}`)
  expect(errors).toEqual([])
})
