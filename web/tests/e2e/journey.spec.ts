import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'

// Run this same acceptance against the finished GitHub Pages deployment:
// BASE_URL=https://amritesh.github.io/agrinet/ npm run test:e2e
for (const name of ['Onion', 'Tomato', 'Potato']) {
  test(`${name} complete real-data user journey and geographic playback`, async ({ page }, testInfo) => {
    test.setTimeout(100_000)
    const metrics: Record<string, number | string> = { commodity: name, project: testInfo.project.name }
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    const view = (label: string) => page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: label, exact: true })
    const t = Date.now()
    await page.goto(`?c=${name.toLowerCase()}&d=2024-01-15&v=map`)
    const status = page.getByRole('status')
    await expect(status).toContainText(new RegExp(`[1-9][0-9]* mandis reporting ${name} on 2024-01-15`))
    await expect(page.locator('.map canvas')).toHaveCount(2)
    metrics.coldMapReadyMs = Date.now() - t
    // Screen capture of real geography + deck.gl overlays, not a mocked map.
    const map = page.getByRole('application', { name: 'India agricultural intelligence map' })
    const before = await map.screenshot({ animations: 'disabled' })
    await page.getByLabel('Playback speed', { exact: true }).selectOption('1')
    const playStart = Date.now()
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.getByLabel('Selected date', { exact: true })).not.toHaveValue('2024-01-15')
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    const playedDate = await page.getByLabel('Selected date', { exact: true }).inputValue()
    metrics.playbackFirstAdvanceMs = Date.now() - playStart
    metrics.playedDate = playedDate
    await expect(status).toContainText(playedDate)
    await expect(status).toContainText(/[1-9][0-9]* mandis/)
    const after = await map.screenshot({ animations: 'disabled' })
    metrics.mapBeforeSha256 = createHash('sha256').update(before).digest('hex')
    metrics.mapAfterSha256 = createHash('sha256').update(after).digest('hex')
    expect(metrics.mapAfterSha256).not.toBe(metrics.mapBeforeSha256)
    await testInfo.attach(`${name}-geographic-before`, { body: before, contentType: 'image/png' })
    await testInfo.attach(`${name}-geographic-after`, { body: after, contentType: 'image/png' })

    await page.getByLabel('Selected date', { exact: true }).fill('2026-04-20')
    await view('Shocks').click()
    await page.getByRole('combobox', { name: 'Window', exact: true }).selectOption('365')
    await page.getByRole('combobox', { name: 'Min severity', exact: true }).selectOption('1')
    const row = page.locator('.table tbody tr').first()
    await expect(row).toBeVisible()
    const shockDate = (await row.locator('td').nth(1).innerText()).trim()
    const observed = (await row.locator('td').nth(8).innerText()).trim()
    const investigateStart = Date.now()
    await row.click()
    const panel = page.getByRole('complementary', { name: 'Market investigation panel' })
    await expect(panel).toBeVisible()
    await expect(page.getByLabel('Selected date', { exact: true })).toHaveValue(shockDate)
    const investigation = panel.getByRole('region', { name: 'Shock investigation' })
    await expect(investigation).toContainText('Anomaly score')
    await expect(investigation).toContainText('Recomputed in browser')
    await expect(investigation).toContainText('Supporting observations')
    await expect(investigation).toContainText(observed.replace('/q', ''))
    const chart = panel.locator('section').filter({ has: page.getByRole('heading', { name: 'Price history', exact: true }) }).locator('canvas')
    await expect(chart).toHaveCount(1)
    await expect(panel.locator('.kpis')).toContainText('₹')
    metrics.realInvestigationReadyMs = Date.now() - investigateStart
    metrics.shockDate = shockDate
    await page.getByRole('button', { name: 'Close panel', exact: true }).click()

    await view('News').click()
    await page.getByRole('combobox', { name: 'Window', exact: true }).selectOption('365')
    await expect(page.locator('.view .loading')).toHaveCount(0)
    await expect(page.locator('.view .error')).toHaveCount(0)
    const articles = page.locator('.news-item a')
    if (await articles.count()) {
      expect(await articles.first().getAttribute('href')).toMatch(/^https?:\/\//)
      metrics.newsResult = `authentic article links: ${await articles.count()}`
    } else {
      await expect(page.locator('.view .empty')).toContainText('No news items stored')
      metrics.newsResult = 'explicit empty state (no invented attribution)'
    }
    expect(errors).toEqual([])
    await testInfo.attach('performance-and-evidence.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' })
    console.log(`ACCEPTANCE_METRICS ${JSON.stringify(metrics)}`)
  })
}
