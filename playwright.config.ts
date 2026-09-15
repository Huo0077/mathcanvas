import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.mjs",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"]
  }
})
