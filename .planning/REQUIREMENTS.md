# v1.1 Requirements — Data foundation + email

**Milestone:** v1.1 — Data foundation + email
**Scoped:** 2026-05-03 via `/gsd-new-milestone`
**Phase numbering:** continues from v1.0 (Phase 7+)
**Source documents:** `PROJECT.md` (current milestone section), `MILESTONES.md` (v1.0 close), `tasks/v2-carryover-from-v1-phase-6.md`, `.planning/notes/v2-data-reset-decision.md`, `.planning/seeds/v2-data-reset-phase.md`, `.planning/seeds/v2-sales-corpus-backfill.md`, `.planning/research/v1.1-{email-queue,rbac-model,notifications-model,map-library}.md`

## Goal

Turn v1.0's MVP into the day-to-day ops platform the team operates from by:
1. Establishing Monday as the authoritative source of truth for hotel/location identity via wipe-and-rebuild
2. Shipping transactional email + per-user notifications + scheduled reports on a single async substrate
3. Extending access control to configurable role tiers + custom granular roles
4. Resolving v1.0 carryover tech debt and UX polish

## Architectural Decisions (locked at scoping)

| Area | Decision | Rationale |
|------|----------|-----------|
| Email provider | **Resend** primary, Brevo documented fallback | Best Next.js/Vercel DX, EU region for GDPR, free tier covers volume; locked at v1.0 close 2026-04-29 |
| Async + scheduled jobs | **Inngest** (`inngest@4.2.6`) for email queue + cron triggers | Skips bespoke `email_jobs` table + manual cron; built-in retries, dedupe, idempotency keys; replaces "queue + cron worker" idea wholesale. Keep thin `email_log` audit table with `payloadHash` unique idx for digest idempotency. |
| RBAC model | **CASL** (`@casl/ability@6.8.1` + `@casl/react@6.0.0`) | Native `fields` (with `*`/`**` wildcards) + `conditions` map directly to "Ops sees pipelineStage but not bankingDetails". Rules JSON → DB-storable → admin-UI authorable without deploy. `redactSensitiveFields` becomes `permittedFieldsOf(ability, 'read', subject)` — drop-in replacement. Pure post-session derivation in `get-user-ctx.ts`; no Better Auth plugin conflict. `userScopes` preserved (feeds CASL `conditions`). |
| Notifications delivery | **Email + deep-link only**; no in-app bell in v1.1 | 3-4 days vs 8-10 for hybrid. Subscriptions: per-kiosk star + per-region checkboxes; admin offline alerts implicit for `role='admin'`. Throttling: 5-min Inngest schedule drains `audit_logs` filtered to status/pipeline_stage changes, grouped by `(userId, entityType)`. Schema: `notification_subscriptions` + singleton `notification_cursor` row. |
| Data reset | **Wipe-and-rebuild from Monday**, not surgical pair-wise merge | Codified in `.planning/notes/v2-data-reset-decision.md`. Monday is authoritative SoT for hotel/location identity; CSVs in `seed_data/` (Jan/Feb/Mar 2026) seed sales; 2024-onwards backfill deferred (`.planning/seeds/v2-sales-corpus-backfill.md`). |
| No manual SQL for ops | **Recurring destructive operator ops are admin UI features, not scripts** | Locked 2026-05-03. `scripts/multi-pos-merge.ts` becomes legacy when location-merge UI ships in DATA-02. |

## A. Data foundation rebuild

- [ ] **DATA-01** — Wipe-and-rebuild from Monday establishing Monday as authoritative SoT for hotel/location identity. Wipes `locations`, `kiosks`, `kioskAssignments`, `products`, sales tables, `auditLogs`, test rollout substrate (`installations`, `milestones`), staging tables. Preserves `user`, `account`, `session`, auth tables, `appSettings`, `pipelineStages`, saved-view tables, user customisations. Subsumes v1.0 carryover items `DM-V2-01`, `DQ-V2-01`, `DQ-V2-02`, `DQ-V2-03`, `MIGR-07`, `MIGR-08`. Idempotent runbook re-run on a fresh DB produces deterministic output.
- [ ] **DATA-02** — Location-merge admin UI: select N location IDs → merge into 1 canonical. Kiosks reattach via `kiosk_assignments`, sales rewrite, audit entry, archive non-canonical with `archived_at`. Admin-only RBAC; preview of merge consequences before confirm; per-action audit_log entry citing actor + selected location IDs + canonical. First-class operator feature replacing `scripts/multi-pos-merge.ts` (which becomes legacy).
- [ ] **DATA-03** — Same-name prevention guardrails: DB unique partial index `UNIQUE (normalised_name) WHERE archived_at IS NULL`; `runDryImport` warns when import would create a same-name candidate; admin alert / dashboard surface if a same-name group sneaks past.
- [ ] **DATA-04** — `LOCATION_NEEDED` sentinel row pattern: sales ETL fallback for unknown outlet codes creates kiosk + assigns to sentinel location (canonical name, address-as-placeholder, region). Operator can later merge sentinel-attached kiosks into real locations via DATA-02.
- [ ] **DATA-05** — Two-pass `assigned_at` seed rule: `live_date` primary, earliest CSV sale fallback. Reuses `scripts/backfill-kiosk-install-dates.ts --apply` for second pass once sales ETL completes. Re-runnable when sales corpus depth grows.

## B. Email infrastructure (Resend + Inngest)

- [x] **EMAIL-01** — Resend integration replacing nodemailer SMTP. Fixes the silent-fail prod forgot-password path (`SMTP_*` env vars never set in Vercel; nodemailer defaults to `localhost:1025`). Preserve existing `email.ts` signatures so call sites stay unchanged. Brevo fallback documented but not implemented. **Code-complete in Phase 8 (2026-05-09); operator UAT pending in `08-HUMAN-UAT.md`.**
- [x] **EMAIL-02** — Self-serve change-password from `/account/security` while signed in. Wraps Better Auth `authClient.changePassword({ currentPassword, newPassword })`. Sends a "password was changed" confirmation email via the EMAIL-01 substrate. **Code-complete in Phase 8 (2026-05-09); real-inbox UAT pending in `08-HUMAN-UAT.md`.**
- [ ] **EMAIL-03** — Forgot-password end-to-end deliverability UAT against prod once EMAIL-01 lands (invite throwaway user, click link, set password, sign in). Bundles with EMAIL-01. **Operator-driven by design (D-14); runbook in `08-03-SUMMARY.md`, items tracked in `08-HUMAN-UAT.md`.**
- [x] **EMAIL-04** — Transactional alerts substrate: Inngest functions for send + retry, branded WeKnow templates, thin `email_log` audit table with `payloadHash` unique idx for digest idempotency. No bespoke `email_jobs` queue table — Inngest is the queue. Scheduled triggers via Inngest schedules (no `vercel.json` cron entries). Substrate for category C. **Code-complete in Phase 8 (2026-05-09); first consumer (password-changed) wired in plan 08-02.**

## C. Notifications & scheduled reports

- [ ] **NOTIF-01** — Per-user notifications for status changes on managed kiosks. Subscriptions via per-kiosk star UI + per-region checkboxes in `/account/notifications`. Throttling: 5-min Inngest schedule drains `audit_logs` filtered to `status` / `pipeline_stage_id` changes, grouped by `(userId, entityType)`. Email + deep-link to the changed kiosk; no in-app bell. Depends on EMAIL-04.
- [ ] **NOTIF-02** — Admin alerts for kiosks going offline. Implicit subscription for users with `role='admin'`; same Inngest drain as NOTIF-01 but filtered to offline transitions. Depends on EMAIL-04.
- [ ] **REPORT-05** — Scheduled / automated email reports: admin-configurable digest (daily / weekly fleet-health snapshot) emailed to a recipient list. Inngest schedule per recipient list; idempotency via `payloadHash` so re-runs don't double-send. Depends on EMAIL-04.
- [ ] **REPORT-06** — Custom report templates: admin-authorable digest content (which KPIs to include, region/group filters baked in). Stored in DB; rendered into REPORT-05 emails.

## D. Access control extended

- [ ] **AUTH-06** — Configurable Ops/IT/Read-only RBAC tiers via CASL. Rules stored as JSON in DB; admin UI for editing tier permissions without deploy. `redactSensitiveFields` migrates to `permittedFieldsOf(ability, 'read', subject)`. Existing `userScopes` preserved (feeds CASL `conditions`).
- [ ] **AUTH-07** — Custom granular roles authorable in admin UI. Per-role rule set (subjects × actions × fields × conditions). Role assignment per-user; UI for creating/editing/cloning roles.

## E. Test coverage + tooling

- [ ] **TEST-01** — Staging orphan-rate baseline measurement: invariant assertion in CI / staging that flags when sales-orphan rate exceeds threshold (signals upstream Monday gap or ETL regression).
- [ ] **MONDAY-01** — Bidirectional Monday sync / drift detection. Reframed under v1.1: Monday is now SoT, "drift" means Monday changed and we need to re-import or alert. Detection job runs on schedule; surfaces diffs in admin UI.
- [ ] **REF-01** — Analytics dashboards `useEffect → loadData()` migration off `react-hooks/set-state-in-effect`. Bring all analytics fetch flows onto the same `loadData()` pattern used elsewhere; remove suppressions.
- [ ] **INFRA-01** — Enable GitHub auto-delete-merged-branches. Removes the recurring `gsd/phase-NN-…` stale-branch cleanup tax.

## F. Polish + tech debt

- [ ] **POLISH-01** — Tab hover state + loading indicator for heavy view-switches. Resolves `.planning/debug/tab-hover-loading-state.md` — fix specified, awaiting verify.
- [ ] **POLISH-02** — Calendar empty-state overlay visual distinction. Resolves `.planning/debug/calendar-empty-state-overlay.md` — fix specified, awaiting verify.
- [ ] **DEBT-01** — Bulk action type-safety: Zod-validated patch objects in `src/app/(app)/kiosks/bulk-actions.ts` + `src/app/(app)/locations/bulk-actions.ts`. Replace ad-hoc `Partial<...>` with explicit per-field schema; drop `as any` casts.
- [ ] **DEBT-02** — Drizzle 0.45.2 patch audit: confirm whether 0.46+ supersedes the hash-based migration detection patch in `patches/drizzle-orm+0.45.2.patch`. If yes, upgrade and drop the patch; if no, document why we're stuck on 0.45.2.

## Out of Scope (explicit)

| Feature | Reason |
|---------|--------|
| Map view / geographic visualisation | Server-side geocoding (`/settings/geocoding`, shipped v1.0) is sufficient; operators don't need kiosks plotted on a map. v1.1 research preserved at `.planning/research/v1.1-map-library.md` if the call ever reverses. |
| In-app notification centre / bell | Defer to v1.2. Email + deep-link covers the immediate use case at 3-4 days vs 8-10 for hybrid. |

## Future Requirements (deferred beyond v1.1)

- **`freeTrialEndDate` analytics** (originally `REPORT-V2-03`) — pickup tied to maintenance-fee recurring-revenue work; not yet scoped.
- **2024-to-date sales corpus backfill + Azure daily ETL takeover** — see `.planning/seeds/v2-sales-corpus-backfill.md`. Activates when full historical CSV/blob feed is available; re-triggers DATA-05 second pass.
- **Analytics CTE type-safety refactor** — `db as any` in 11 analytics query files; significant scope, defer to v1.2 / v2.0.
- **`multi-pos-merge.ts` single-pair fixture** (originally `TEST-V2-01`) — drops with DATA-02; coverage moves to UI-level tests in category A.

## Dependencies + Sequencing

- **A (Data foundation) is the keystone.** DATA-01 must ship before DATA-02 (merge UI is destructive against rebuilt data). DATA-04 + DATA-05 are part of the DATA-01 runbook.
- **B (Email) must precede C (Notifications + Reports).** EMAIL-04 is the substrate; NOTIF-01, NOTIF-02, REPORT-05 all `depends_on: EMAIL-04`. EMAIL-01 must ship before EMAIL-03 (deliverability UAT requires Resend live).
- **D (RBAC) is independent** of A/B/C — can land in parallel. CASL migration is in-place (`redactSensitiveFields` becomes `permittedFieldsOf`); no schema change required for AUTH-06 beyond rules JSON storage.
- **E + F (test coverage, polish, debt)** are independent and can be batched into a single closing phase.

## Traceability

Filled by `gsd-roadmapper` 2026-05-03 — every REQ-ID maps to exactly one phase in ROADMAP.md.

| REQ-ID | Phase | Coverage |
|--------|-------|----------|
| DATA-01 | Phase 7 | SC1 — idempotent wipe-and-rebuild runbook (Monday import + sales ETL + two-pass backfill) produces deterministic golden-snapshot output |
| DATA-02 | Phase 7 | SC2 — admin location-merge UI with multi-select + preview + atomic sales/assignment rewrite + audit entry |
| DATA-03 | Phase 7 | SC3 — DB unique partial index on `normalised_name WHERE archived_at IS NULL` + dry-run import same-name warning + admin alert surface |
| DATA-04 | Phase 7 | SC4 — `LOCATION_NEEDED` sentinel created on unknown-outlet sales ETL ingest; orphan kiosks merge-able via DATA-02 |
| DATA-05 | Phase 7 | SC5 — two-pass `assigned_at` rule: `live_date` primary, `MIN(salesRecords.date)` fallback via `backfill-kiosk-install-dates.ts --apply` |
| EMAIL-01 | Phase 8 | SC1 — Resend transport replaces nodemailer SMTP; forgot-password / invite emails actually deliver in prod; `email_log` records `resend_message_id` |
| EMAIL-02 | Phase 8 | SC2 — `/account/security` self-serve change-password via Better Auth `authClient.changePassword` + confirmation email |
| EMAIL-03 | Phase 8 | SC3 — end-to-end forgot-password UAT against prod passes via git-branch-aliased `BETTER_AUTH_URL` |
| EMAIL-04 | Phase 8 | SC4 — Inngest send + retry functions, branded templates, `email_log` audit table with `payloadHash` unique index for digest idempotency |
| NOTIF-01 | Phase 9 | SC1 — per-kiosk star + per-region subscription UI; 5-min Inngest drain of `audit_logs` filtered to status / pipeline_stage_id changes; grouped digest emails with deep-links |
| NOTIF-02 | Phase 9 | SC2 — implicit subscription for `role='admin'`; same Inngest drain filtered to offline transitions; opt-out via prefs page |
| REPORT-05 | Phase 9 | SC3 — admin-configurable recipient lists for daily/weekly fleet-health digest; per-list Inngest schedule; `payloadHash` idempotency prevents double-sends |
| REPORT-06 | Phase 9 | SC4 — admin-authorable custom report templates stored in DB; rendered into REPORT-05 emails |
| AUTH-06 | Phase 10 | SC1+SC2+SC4+SC5 — CASL `Ability` built in `get-user-ctx`; configurable Ops/IT/Read-only tier rules in DB JSON; admin UI for tier editing without deploy; `userScopes` continues to drive `conditions` |
| AUTH-07 | Phase 10 | SC3 — admin UI for creating/editing/cloning custom granular roles (subjects × actions × fields × conditions) with per-user assignment |
| TEST-01 | Phase 11 | SC1 — staging orphan-rate baseline measurement + CI invariant assertion when threshold exceeded |
| MONDAY-01 | Phase 11 | SC2 — scheduled Monday-drift detection job surfacing diffs in admin UI (reframed: Monday is SoT, "drift" means Monday changed) |
| REF-01 | Phase 11 | SC3 — analytics dashboards migrated to shared `loadData()` pattern; `react-hooks/set-state-in-effect` suppressions removed |
| INFRA-01 | Phase 11 | SC4 — GitHub auto-delete-merged-branches enabled |
| POLISH-01 | Phase 11 | SC4 — tab hover state + loading indicator shipped per `.planning/debug/tab-hover-loading-state.md` |
| POLISH-02 | Phase 11 | SC4 — calendar empty-state overlay visual distinction shipped per `.planning/debug/calendar-empty-state-overlay.md` |
| DEBT-01 | Phase 11 | SC5 — Zod-validated patch schemas in kiosk + location `bulk-actions.ts`; `as any` casts removed |
| DEBT-02 | Phase 11 | SC6 — Drizzle 0.45.2 patch audit complete (upgraded to 0.46+ or documented why stuck) |

**Total:** 23 REQs across 6 categories → 5 phases. **Coverage: 23/23 ✓** No orphans.

---
*Approved 2026-05-03. Roadmapper next: derive phase structure (continuing from Phase 7), map every REQ-ID to a phase, derive 2-5 success criteria per phase, validate 100% coverage. → DONE 2026-05-03; see `.planning/ROADMAP.md`.*
