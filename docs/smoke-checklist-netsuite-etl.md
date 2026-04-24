# NetSuite ETL — Pre-merge Smoke Checklist

Run through this before merging `fix/maturity-buckets-end-date` into `optimisation`.

- [ ] `npm run build` succeeds.
- [ ] `npx vitest run` — all unit + integration projects pass.
- [ ] `npx playwright test` — all E2E tests pass (or acceptable skip reasons documented).
- [ ] `npm run etl:azure` against Azurite emulator OR staging Azure processes at least one fixture blob and is idempotent on second run.
- [ ] `POST /api/etl/azure/run` with `x-etl-token` header returns the run result; without token returns 401; with `x-vercel-cron: 1` header runs successfully.
- [ ] `ETL_AZURE_ENABLED=false` (or unset) causes the HTTP route to return 503.
- [ ] `/settings/data-import/sales` renders the history view; no upload form is present.
- [ ] Commission dashboard reflects the new base calculation (SUM(netAmount) WHERE isBookingFee=true) against seeded test data.
- [ ] DB backup captured BEFORE running 0018 migration in production.

## Rollback

Migration 0018 truncates `sales_records`. No in-place rollback is supported. If rollback is needed:
1. Restore the pre-migration DB backup.
2. Set `ETL_AZURE_ENABLED=false` in Vercel to stop further ingestion.
3. File a bug, triage, fix forward.
