import { defineConfig } from "@playwright/test";

const baseURL = process.env.PREVIEW_URL;
if (!baseURL) {
  throw new Error(
    "PREVIEW_URL env var required for remote playwright run. Example: PREVIEW_URL=https://your-preview.vercel.app npm run test:e2e:remote",
  );
}

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "./playwright-output",
  reporter: [["list"], ["html", { outputFolder: "./playwright-report", open: "never" }]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
  },
});
