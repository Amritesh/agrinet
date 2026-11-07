import { defineConfig, devices } from '@playwright/test'

// External URL may include a path prefix (e.g. GitHub Pages /agrinet/).
const baseURL = (process.env.BASE_URL ?? 'http://127.0.0.1:4174/agrinet/').replace(/\/?$/, '/')
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
    use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', reducedMotion: 'reduce' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
  ],
  webServer: process.env.BASE_URL ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort --base /agrinet/',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
