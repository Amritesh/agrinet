import { expect, test } from '@playwright/test'

test('story-first dashboard keeps collaboration discreet and works on narrow screens', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Product' })).toBeVisible()
  await expect(page.getByRole('note')).toContainText('Historical modeled margin, not verified profit')
  await expect(page.locator('header').getByRole('link', { name: 'Research tools' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Other AGRINET pages' }).getByRole('link', { name: 'Collaborate' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Other AGRINET pages' }).getByRole('link', { name: 'Research tools' })).toHaveAttribute('href', /mode=research/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('empty catalog gives an honest, recoverable zero-story state', async ({ page }) => {
  await page.route('**/stories/catalog.json', (route) => route.fulfill({ json: {
    engine: 'stories-2.0.0', data_snapshot: 'test', latest_observation: '2026-04-20', story_count: 0,
    featured: [], commodities: {}, products: { lentil: { name: 'Lentil', stories: 0, best: 0 } },
  } }))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'No trade story available' })).toBeVisible()
  await expect(page.getByText('This does not mean a trade cannot be profitable.', { exact: false })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Product' })).toHaveValue('lentil')
  await expect(page.getByRole('button', { name: 'Watch the story' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
