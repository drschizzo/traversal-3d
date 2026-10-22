// Tests de bout en bout : le jeu construit et les salons, servis par wrangler dev comme en production.
//   npm run e2e    (la première fois : npx playwright install chromium)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:8787', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'npm --prefix server run dev -- --port 8787',
    url: 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
