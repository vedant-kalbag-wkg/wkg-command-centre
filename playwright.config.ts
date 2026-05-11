import { defineConfig } from "@playwright/test";

const overrideBaseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "./playwright-output",
  reporter: [["list"], ["html", { outputFolder: "./playwright-report", open: "never" }]],
  globalSetup: require.resolve("./tests/global-setup"),
  use: {
    baseURL: overrideBaseURL ?? "http://localhost:3003",
    screenshot: "only-on-failure",
  },
  webServer: overrideBaseURL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3003",
        reuseExistingServer: !process.env.CI,
      },
});
