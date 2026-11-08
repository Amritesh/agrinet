import { expect, test } from '@playwright/test'

test('Month Lab explores historical candidates and a traceable modeled chain', async ({ page }) => {
  await page.goto('./?mode=lab&product=tomato&month=2024-08')
  await expect(page.getByRole('heading', { name: /Where was it cheaper/ })).toBeVisible()
  await expect(page.locator('.ml-result').first()).toBeVisible()
  await expect(page.getByLabel('How to use this page')).toContainText('Choose a crop')
  await expect(page.locator('.ml-overview')).toContainText('August 2024')
  await expect(page.getByRole('region', { name: 'Trade chain' })).toContainText('ESTIMATED COSTS')
  await expect(page.getByRole('region', { name: 'Trade chain' })).toContainText('Later observed destination price')
  await expect(page.locator('.ml-provenance')).toContainText('Static archive, not live quotes')
  await page.getByLabel('Historical month').selectOption('2024-09')
  await expect(page.locator('.ml-overview')).toContainText('September 2024')
  await expect(page.locator('.ml-result').first()).toContainText('2024-09-')
  await expect(page).toHaveURL(/month=2024-09/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('all indexed products are searchable and missing coverage is explicit', async ({ page }) => {
  await page.goto('./?mode=lab&product=tomato&month=2024-08')
  await expect(page.locator('.ml-product-control label')).toContainText('368 crops')
  expect(await page.getByLabel('Crop', { exact: true }).locator('option').count()).toBeGreaterThan(300)
  await page.getByLabel('1 / WHICH CROP?').fill('wheat')
  await expect(page.getByLabel('Crop', { exact: true }).locator('option', { hasText: /^Wheat$/ })).toHaveCount(1)
  await page.getByLabel('Crop', { exact: true }).selectOption('wheat')
  await expect(page.getByText(/No detailed stories yet/)).toBeVisible()
  await expect(page.getByText(/No qualifying modeled candidate/)).toBeVisible()
  await expect(page.getByText(/none qualified as a positive modeled buy-day result/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('static month API drives screened candidates and a sequential hindsight chain', async ({ page }) => {
  const first = { origin: 'a', destination: 'b', buy: '2024-08-03', sell: '2024-08-04', origin_market: { name: 'Alpha', state: 'X' }, destination_market: { name: 'Beta', state: 'Y' }, buy_price: 100, sell_price: 150, gross: 50, net_baseline: 30, net_adverse: 5, variety: 'Local', grade: 'FAQ', route: { km: 40 }, known_destination_date: '2024-08-02', verdict: 'positive_retrospective_modeled_surplus_not_verified_profit' }
  const second = { ...first, origin: 'b', destination: 'c', buy: '2024-08-15', sell: '2024-08-16', origin_market: { name: 'Beta', state: 'Y' }, destination_market: { name: 'Gamma', state: 'Z' }, buy_price: 110, sell_price: 160, known_destination_date: '2024-08-14' }
  await page.route('**/month-api/catalog.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema: 'agrinet-month-1', products: { wheat: { name: 'Wheat', months: ['2024-08'], supported_product: true } } }) }))
  await page.route('**/month-api/wheat/2024-08.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema: 'agrinet-month-1', product: 'wheat', month: '2024-08', status: 'modeled_scenarios_only', coverage: { routed_pairs_considered: 2 }, opportunities: [first, second], chains: [{ variety: 'Local', grade: 'FAQ', legs: [first, second], modeled_net_per_initial_qtl: 60, selection: 'retrospective' }] }) }))
  await page.goto('./?mode=lab&product=wheat&month=2024-08')
  await expect(page.getByRole('region', { name: 'Sequential scenario' })).toContainText('Alpha → 2024-08-04 Beta')
  await expect(page.getByRole('region', { name: 'Sequential scenario' })).toContainText('Beta → 2024-08-16 Gamma')
  await expect(page.getByRole('region', { name: 'Sequential scenario' })).toContainText('neither realized profit nor an executable return')
  await expect(page.getByRole('region', { name: 'Sequential scenario' })).toContainText('seven days after the sale')
  await expect(page.getByRole('region', { name: 'Sequential scenario' })).toContainText('initial capital and cash feasibility are not modeled')
  await expect(page.locator('.ml-result')).toHaveCount(2)
})

test('an indexed month with unsupported economics is not presented as a profitable chain', async ({ page }) => {
  await page.route('**/month-api/catalog.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema: 'agrinet-month-1', products: { archive_only_crop: { name: 'Archive Only Crop', months: ['2024-08'], supported_product: false } } }) }))
  await page.route('**/month-api/archive_only_crop/2024-08.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema: 'agrinet-month-1', product: 'archive_only_crop', month: '2024-08', status: 'unsupported_product', coverage: { routed_pairs_considered: 0 }, opportunities: [], chains: [] }) }))
  await page.goto('./?mode=lab&product=archive_only_crop&month=2024-08')
  await page.getByLabel('1 / WHICH CROP?').fill('archive only')
  await expect(page.getByLabel('Crop', { exact: true }).locator('option', { hasText: /Archive Only Crop/ })).toHaveCount(1)
  await expect(page.getByLabel('Historical month')).toHaveValue('2024-08')
  await expect(page.getByText(/no calibrated cost model/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Sequential scenario' })).toHaveCount(0)
  await expect(page.locator('.ml-overview')).toContainText('0')
})

test('Month Lab is discoverable from story home', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('link', { name: 'Open Month Lab' })).toHaveAttribute('href', /mode=lab/)
  await page.getByRole('link', { name: 'Open Month Lab' }).click()
  await expect(page.getByRole('heading', { name: /Where was it cheaper/ })).toBeVisible()
})
