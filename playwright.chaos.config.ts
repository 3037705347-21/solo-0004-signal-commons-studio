import { defineConfig, devices } from "@playwright/test";

/**
 * Chaos drill gate configuration.
 *
 * Independent from the smoke e2e suite: drills run single-worker, fully
 * serial, with zero retries so a timing-sensitive failure is never masked.
 * Reports land in chaos-report/ and traces survive in test-results/chaos/.
 *
 *   npm run drill                 # full gate
 *   npm run drill:one -- CC-02    # one scenario
 *   npm run drill:suite recovery  # one suite
 */
export default defineConfig({
  testDir: "./e2e/chaos",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["./e2e/chaos/chaosReporter.ts"],
    ["html", { outputFolder: "chaos-report/html", open: "never" }],
    ["json", { outputFile: "chaos-report/playwright-results.json" }],
  ],
  outputDir: "test-results/chaos",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
