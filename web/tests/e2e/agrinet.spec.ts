import { test, expect, type Page } from '@playwright/test'

const view = (page: Page, name: string) => page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name, exact: true })

test('deep link preserves commodity/date/view and real analytics', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('?c=tomato&d=2024-01-15&v=analytics')
  await expect(page.getByLabel('Selected date', { exact: true })).toHaveValue('2024-01-15')
  await expect(view(page, 'Analytics')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('navigation', { name: 'Commodity', exact: true }).getByRole('button', { name: 'Tomato', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.kpi-card').filter({ hasText: 'Tomato' }).locator('.kpi-value')).toContainText('₹')
  await page.reload()
  await expect(page.getByLabel('Selected date', { exact: true })).toHaveValue('2024-01-15')
  expect(errors).toEqual([])
})

test('mobile and desktop navigation and timeline remain accessible in viewport', async ({ page }) => {
  await page.goto('./')
  for (const name of ['Map', 'Shocks', 'News', 'Analytics']) {
    const button = view(page, name)
    await expect(button).toBeInViewport()
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
  }
  for (const label of ['Selected date', 'Playback step', 'Playback speed', 'Comparison date (before/after)', 'Timeline position']) {
    await expect(page.getByLabel(label, { exact: true })).toBeInViewport()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('all three actual commodity snapshots, comparison, and playback controls', async ({ page }) => {
  const failures: string[] = []
  page.on('response', r => { if (r.status() >= 400 && /\/(data|geo)\//.test(r.url()) && !/2027\.bin/.test(r.url())) failures.push(`${r.status()} ${r.url()}`) })
  await page.goto('./')
  await page.getByLabel('Selected date', { exact: true }).fill('2024-01-15')
  for (const name of ['Onion', 'Potato', 'Tomato']) {
    await page.getByRole('navigation', { name: 'Commodity', exact: true }).getByRole('button', { name, exact: true }).click()
    await expect(page.getByRole('status')).toContainText(new RegExp(`[1-9][0-9]* mandis.*${name}`))
  }
  await page.getByLabel('Comparison date (before/after)', { exact: true }).fill('2024-01-08')
  await expect(page.getByRole('button', { name: 'Clear comparison', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear comparison', exact: true }).click()
  await page.getByLabel('Playback step', { exact: true }).selectOption('week')
  await page.getByRole('button', { name: 'Step forward', exact: true }).click()
  await expect(page.getByLabel('Selected date', { exact: true })).toHaveValue('2024-01-22')
  await page.getByLabel('Playback step', { exact: true }).selectOption('day')
  await page.getByLabel('Playback speed', { exact: true }).selectOption('1')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByLabel('Selected date', { exact: true })).not.toHaveValue('2024-01-22')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  const paused = await page.getByLabel('Selected date', { exact: true }).inputValue()
  await page.waitForTimeout(1200)
  await expect(page.getByLabel('Selected date', { exact: true })).toHaveValue(paused)
  await page.getByRole('button', { name: 'Jump to latest', exact: true }).click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  expect(failures).toEqual([])
})

test('real shock filtering opens market investigation with real history', async ({ page }) => {
  await page.goto('./')
  await page.getByLabel('Selected date', { exact: true }).fill('2026-04-20')
  await view(page, 'Shocks').click()
  await page.getByRole('combobox', { name: 'Window', exact: true }).selectOption('365')
  await page.getByRole('combobox', { name: 'Min severity', exact: true }).selectOption('1')
  const first = page.locator('.table tbody tr').first()
  await expect(first).toBeVisible({ timeout: 30_000 })
  const date = (await first.locator('td').nth(1).innerText()).trim()
  const market = (await first.locator('td').nth(2).innerText()).split(' (')[0].trim()
  await page.getByLabel('Filter shocks', { exact: true }).fill(market)
  await expect(first).toContainText(market)
  await first.press('Enter')
  await expect(page.getByRole('complementary', { name: 'Market investigation panel' })).toBeVisible()
  await expect(page.getByLabel('Selected date', { exact: true })).toHaveValue(date)
  await expect(page.locator('.investigation')).toBeVisible()
  await expect(page.locator('.panel .kpis')).toContainText('₹')
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await expect(page.locator('.panel')).toHaveCount(0)
})

test('news filters show authentic links or an explicit honest empty state', async ({ page }) => {
  await page.goto('./')
  await view(page, 'News').click()
  await page.getByRole('combobox', { name: 'Window', exact: true }).selectOption('365')
  await page.getByRole('checkbox', { name: 'only Onion' }).uncheck()
  await expect(page.locator('.view .loading')).toHaveCount(0)
  await expect(page.locator('.view .error')).toHaveCount(0)
  const links = page.locator('.news-item a')
  if (await links.count()) {
    expect(await links.first().getAttribute('href')).toMatch(/^https?:\/\//)
    await expect(links.first()).not.toHaveText('')
  } else {
    await expect(page.locator('.view .empty')).toContainText('No news items stored')
  }
  await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('policy')
  await expect(page.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('policy')
})

test('actual national analytics match independently decoded stored binary', async ({ page, request }) => {
  const response = await request.get('data/snap/onion/2024.bin')
  expect(response.ok()).toBe(true)
  const buffer = await response.body()
  const magic = buffer.readUInt32LE(0)
  expect([0x41475231, 0x41475232]).toContain(magic)
  const wide = magic === 0x41475232
  const stride = wide ? 6 : 4
  const ordinal = Math.round((Date.parse('2024-01-15') - Date.UTC(2001, 0, 1)) / 86400000)
  let offset = 8
  let prices: number[] = []
  for (let day = 0; day < buffer.readUInt32LE(4); day++) {
    const d = buffer.readUInt32LE(offset), n = buffer.readUInt32LE(offset + 4)
    offset += 8
    if (d === ordinal) prices = Array.from({ length: n }, (_, i) => wide ? buffer.readUInt32LE(offset + i * stride + 2) : buffer.readUInt16LE(offset + i * stride + 2))
    offset += n * stride
  }
  expect(prices.length).toBeGreaterThan(0)
  prices.sort((a, b) => a - b)
  const h = Math.floor(prices.length / 2)
  const median = prices.length % 2 ? prices[h] : (prices[h - 1] + prices[h]) / 2
  await page.goto('./')
  await page.getByLabel('Selected date', { exact: true }).fill('2024-01-15')
  await view(page, 'Analytics').click()
  const card = page.locator('.kpi-card').filter({ hasText: 'Onion' })
  await expect(card.locator('.kpi-value')).toHaveText(`₹${Math.round(median)}/q`)
  await expect(card.locator('.kpi-sub')).toContainText(`${prices.length} mandis on 2024-01-15`)
})
