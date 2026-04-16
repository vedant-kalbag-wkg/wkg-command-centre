import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const noRawSalesQuery = require("./eslint-rules/no-raw-sales-query.js");

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Custom ESLint rules are plain CommonJS Node tooling — not app code.
    "eslint-rules/**",
  ]),
  // Custom WKG rules. The `wkg/no-raw-sales-query` rule bans direct Drizzle
  // access to `salesRecords` unless `scopedSalesCondition()` is called in the
  // same function. Allow-listed paths below are expected to bypass it:
  //   - src/lib/scoping/**   (the rule itself is implemented here)
  //   - src/db/schema.ts     (where salesRecords is defined)
  //   - src/db/seed*.ts      (seeding utilities)
  //   - src/db/test-*.ts     (manual DB scratch scripts)
  //   - tests/**             (tests seed + assert directly)
  //   - scripts/**           (migration/import/admin utilities)
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/scoping/**",
      "src/db/schema.ts",
      "src/db/seed*.ts",
      "src/db/test-*.ts",
      // Phase 1 M4 — sales CSV import pipeline legitimately inserts into
      // salesRecords inside an admin-only transaction. No scoping applies
      // (admins bypass). See docs/plans/2026-04-16-phase-1-m4-csv.md.
      "src/app/(app)/settings/data-import/sales/**",
    ],
    plugins: {
      wkg: {
        rules: {
          "no-raw-sales-query": noRawSalesQuery,
        },
      },
    },
    rules: {
      "wkg/no-raw-sales-query": "error",
    },
  },
]);

export default eslintConfig;
