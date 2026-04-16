import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Two Vitest projects:
 *   - `unit`:        fast, no external services. Default when running `vitest`.
 *   - `integration`: spins up Testcontainers Postgres; slower; opt-in via
 *                    `vitest --project integration`.
 *
 * Playwright owns `tests/**\/*.spec.ts` — we explicitly exclude it from both
 * projects so vitest never tries to run browser tests.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "./src"),
          },
        },
        test: {
          name: "unit",
          globals: true,
          environment: "node",
          include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
          exclude: [
            "node_modules/**",
            "tests/**",
            "**/*.integration.test.ts",
          ],
        },
      },
      {
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "./src"),
          },
        },
        test: {
          name: "integration",
          globals: true,
          environment: "node",
          include: ["tests/**/*.integration.test.ts"],
          exclude: ["node_modules/**", "tests/**/*.spec.ts"],
          // Testcontainers: first-run image pull can be slow.
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
