# Verify Data Reset Report

**Total:** 11 | **Pass:** 8 | **Fail:** 2 | **Warn:** 1

| Invariant | Status | Expected | Actual | Detail |
|-----------|--------|----------|--------|--------|
| locations.active count vs golden | FAIL | 373 | 509 |  |
| kiosks.active count vs golden | FAIL | 442 | 392 |  |
| sales_records count vs golden | PASS | 95103 | 95103 |  |
| sales_records total revenue (gross GBP) vs golden | PASS | 1783083.58 | 1783083.58 |  |
| no orphan kiosk_assignments (FK to live kiosk + live location) | PASS | 0 | 0 |  |
| no active same-name groups (excluding sentinel) | PASS | 0 | 0 |  |
| LOCATION_NEEDED sentinel exists | PASS | 1 row (name=LOCATION_NEEDED, region=GLOBAL) | 1 row |  |
| LOCATION_NEEDED orphan kiosk count (informational) | WARN | — | 0 | no orphans — clean |
| locations.customer_code coverage (Phase 07-06 Pass 0 input) | PASS | >= 320 | 364 | Pass 0 resolution path has expected data shape |
| kiosk_assignments.assigned_at coverage (NULL count after two-pass backfill) | PASS | 0 | 0 |  |
| audit_logs has reseed entry from runbook system actor | PASS | >= 1 | 2 |  |
