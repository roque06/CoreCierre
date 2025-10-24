import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.js'],   // 👈 corre tus .js
  timeout: 80 * 1000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    headless: false,
    ignoreHTTPSErrors: true,
    actionTimeout: 0,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'edge',
      use: {
        channel: 'msedge',       // usar Microsoft Edge
        headless: false,
        viewport: null,          // 👈 pantalla completa
        ignoreHTTPSErrors: true,
      },
    },
  ],

  outputDir: 'test-results/',
});
