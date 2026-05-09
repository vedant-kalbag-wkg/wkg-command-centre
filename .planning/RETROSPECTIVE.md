# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP — Kiosk Management Platform

**Shipped:** 2026-04-29
**Phases:** 7 (1, 2, 3, 4, 4.1, 5, 6) | **Plans:** 34 GSD-tracked + Phase 5 off-GSD | **Tasks:** 61
**Timeline:** 2026-03-18 → 2026-04-29 (~6 weeks)

### What Was Built

- **Replacement for Monday.com** as the system of record for 1,000+ kiosks across 373+ active hotel/venue locations, with temporal kiosk-to-venue assignment history (the primary Monday.com differentiator).
- **Four interchangeable views over the same data** — Table (TanStack v8 + Zustand View Engine), Kanban (dnd-kit), Gantt (`@svar-ui/react-gantt`), Calendar (`react-big-calendar`) — wired into a `?view=`-bookmarkable navigation.
- **Full analytics arc** delivered off-GSD via PRs #23–#29: Dashboard, Trend Builder, Pivot, Compare, Maturity, Heat Map, Outlet Tiers, Performer Patterns, Experiments, Commission, Flag Review, Actions Dashboard. 7 audit-fix migrations (0027–0034) plus structural cleanup (0035–0037). The arc surfaced and resolved math discrepancies (D1–D10) that the team now treats as canonical.
- **Destructive-data toolkit** hardened by operator UAT against prod: D8 multi-POS site merge (4,171 sales rewrites + 19 archives applied atomically), `/settings/geocoding` Google Maps integration (313 lat/lng populated), thresholds-as-settings (outlet-tier cutoffs lifted from constants → `appSettings` + admin UI).
- **Operational guardrails** — full audit log (per-record + global) with denormalised actor/entity names, application-layer pattern (DB triggers can't provide business context); KPI tooltips on 26/27 cards citing the D-decision/PR that defines each metric's math.

### What Worked

- **Splitting Phase 4 (Migration) → 4.1 (Quality & Correctness)** as an INSERTED decimal phase. The first import surfaced field-mapping bugs we couldn't have predicted from the requirements alone; a dedicated correctness pass shipped six plans worth of fixes without contaminating Phase 4's history.
- **`@svar-ui/react-gantt` over a custom Gantt build.** Brand customisation depth was a Phase 3 blocker concern, but Azure/Graphite token overrides worked cleanly with minimal CSS. Saved easily 1–2 weeks.
- **`kiosk_assignments` temporal join table from day one.** Picked in pre-Phase-1, validated when Phase 5.2 backfilled 362 assignments → `live_date` for the Maturity dashboard. A simple `venue_id` FK would have meant losing the differentiator.
- **Application-layer audit log with denormalised actor/entity names.** DB-trigger audits would have shipped faster but couldn't have produced the per-record `AuditTimeline` with human-readable "X changed Y on Z at T" rows.
- **Tooltip-as-audit-trace pattern (Phase 6.3).** KPI tooltips citing D1/D2/D3/D5/D7/D9/D10 made the canonical-math mapping discoverable at runtime by any operator reading the dashboard. Reusable substrate for v2.
- **In-memory geocoding staging** (Phase 6.6) instead of a `geocoding_stagings` table. ~80KB fits client React state; cancel becomes trivially correct; symmetric stage/commit/cancel verbs leave persistence as a future swap.
- **ALL-OR-NOTHING single-transaction multi-POS merge** (Phase 6.1, D-03). Partial-merge state is unrecoverable for sales-record rewrites; the atomic constraint forced testcontainer verification before prod apply.
- **Operator UAT before destructive prod apply.** Phase 6.1 (multi-POS merge) and 6.6 (geocoding) both gated on human-in-loop staging UAT. Caught at least one issue per phase that automated tests didn't.

### What Was Inefficient

- **Phase 5 delivered off-GSD via PR-driven development.** It worked — the analytics arc shipped and the math is right — but the GSD audit trail is missing. Phase summaries were never written; rationale lives in PR descriptions and the `tasks/todo.md` audit-fix backlog. Phase 6 had to retroactively sweep up loose ends (KPI tooltips, Monday-client tests, kiosk-config-groups regression fixture). **Tradeoff:** PR-driven speed ≈ 2-3× faster for exploration; backfill cost ≈ 1 phase. For analytics-style iteration the speed won, but only because Phase 6 was budgeted for cleanup.
- **macOS-vs-Linux lockfile drift** kept biting CI (commits `33766b0`, `0c71b07`, `c725acd`, `1187fac`, `a0998b0`, `244ce24`). Eventually documented in `CLAUDE.md` with the canonical Docker regen path. Should have been written up after the first occurrence, not the fifth.
- **Same-name location collapse policy** got muddled mid-session. The user's directives evolved across one conversation: "no true duplicates" → "both T4 and 4T need to exist" → "I do not want two separate locations with the same name". Each was correct at the time but contradictory across the arc. Captured the contradiction in `tasks/v2-carryover-from-v1-phase-6.md` § DM-V2-01 and deferred — but a clearer "decision rule + exception list" framing earlier would have saved the late-session ambiguity.
- **Email infrastructure shipped without a working transport in prod.** The forgot-password / invite / external-invite templates work in code, but `nodemailer` defaults to `localhost:1025` and Vercel never had `SMTP_*` env vars set. Silent fail. Caught at v1.0 close, deferred to V2-EMAIL-01 (Resend).
- **Three Phase 6.1 / 6.6 plans wrote `One-liner:` stubs** instead of real summary one-liners, polluting the auto-generated `MILESTONES.md`. Had to be hand-curated at archive time. The `gsd-tools summary-extract` step needs a structured one-liner field that fails-loud when missing.
- **GitHub auto-delete-merged-branches not enabled.** `gsd/phase-06-…` branch still on origin after PR #30 squash-merge. Five-minute fix deferred to V2-INFRA-01 — but it should have been on day-one config.

### Patterns Established

- **Phase X.1 (decimal) for "Quality & Correctness" passes** after a phase whose first real run surfaces correctness bugs. Phase 4.1 validated the pattern; future Monday-shape changes should reuse it.
- **Per-decision audit-log shape** for high-volume rewrites (multi-POS merge): aggregate audit entries per `(defunct_id, table)` rather than per-row, to keep audit history queryable without 7,531 individual rows.
- **Pure-DI boundaries at integration edges** (Plan 06-06 `Geocoder` in `src/lib/geocoding/google.ts`): env vars read at the action layer; pipeline accepts injected dependency; unit tests run with `vi.fn()` stub and never hit network.
- **`metadata.script` as alias not actual path** (Plan 06-06): `metadata.script='scripts/geocode-locations.ts'` even though the real file is `src/lib/geocoding/pipeline.ts` — keeps rollback-grep alignment with `multi-pos-merge` / `backfill-kiosk-install-dates` conventions.
- **In-batch + cross-batch tiebreaker symmetry** (Plan 06-07): when fixing non-determinism in one matcher, fix the symmetric matcher in the same PR even if not in scope. Bug shape was identical; ratchet-style fix.
- **Tooltip-as-audit-trace** (Plan 06-03): user-facing KPI tooltips cite the D-decision or PR that defines the math. Makes runtime introspection a feature, not a debugging chore.
- **Locked decisions in `CLAUDE.md`** for recurring failure modes (lockfile regen, prod password rotation, Vercel preview env-var pinning, Playwright preview UAT). Pattern: codify after the second occurrence, not the fifth.

### Key Lessons

1. **Codify recurring failure modes after the second occurrence, not the fifth.** Lockfile drift cost ~5 cycles before `CLAUDE.md` got the canonical Docker regen. Auth/email/branch-cleanup gaps cost less but followed the same shape.
2. **Phase 5 off-GSD was a deliberate tradeoff that worked — but only because Phase 6 was the cleanup budget.** Don't ship without an explicit "this is the audit-trail backfill cost" plan. Speed-vs-discipline isn't a binary; it's a budget.
3. **User directives evolve mid-conversation. Capture contradictions explicitly.** The same-name collapse arc had three contradictory rules across one session. Naming the contradiction in writing prevents downstream code from silently choosing one.
4. **Operator UAT for destructive prod operations is non-negotiable.** Multi-POS merge and geocoding both passed automated tests but had operator-caught issues at the staging UAT step.
5. **Silent-fail prod infrastructure is worse than missing infrastructure.** The email transport defaulting to `localhost:1025` looked correct in code review and broke nothing in tests — until prod users couldn't reset passwords. Default to fail-loud (throw on missing config in prod) over fail-silent (default to localhost).
6. **`metadata.script` aliasing for tooling-grep alignment** is a small thing that pays back every time someone runs a rollback-pattern grep. Worth the inline comment.
7. **Pure-DI at integration edges** isn't optional. Plan 06-06's geocoding pipeline accepted an injected `Geocoder` and never read env vars — the unit tests ran without GOOGLE_MAPS_API_KEY and the staging UAT was the first real-API touch. Without the boundary, every test would have needed the key.
8. **Phase X.1 INSERTED decimal phases for correctness sweeps** preserve the original phase's history while letting the correctness pass have its own plans, summaries, and PRs. Don't rewrite the original phase to "fix" it; insert.

### Cost Observations

- Model mix: ~70% Opus, ~30% Sonnet (Opus for planning, deep refactors, multi-pos-merge correctness; Sonnet for execution, table styling, test scaffolding)
- Sessions: ~30+ across the milestone span
- Notable: Phase 5 off-GSD pulled an unmeasured tail of sessions into PR-driven mode — those costs are in PR-level git history but not in `STATE.md` performance metrics. Phase 6 cleanup ran a measured ~3 hours of plan execution time across 7 plans, dwarfed by operator UAT time on 06-01 (multi-POS merge) and 06-06 (geocoding).
- Lockfile-drift recurrences cost ~30 mins per occurrence × 6 occurrences ≈ 3 hours of pure friction. The `CLAUDE.md` writeup cost ~20 minutes; net positive after one avoided occurrence.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 7 | 34 | First milestone — established phase branching, decimal-phase insertion pattern, operator-UAT-before-destructive-prod pattern, off-GSD-with-cleanup-budget tradeoff |

### Cumulative Quality

| Milestone | Source LOC | Tests | Migrations Applied | Notes |
|-----------|------------|-------|--------------------|-------|
| v1.0 | ~92.8k (TS/TSX/SQL) | Vitest unit + Playwright E2E (counts not centrally tracked) | 0001 → 0037 (37) | All migrations applied to prod; 4 backfill scripts run on prod |

### Top Lessons (Verified Across Milestones)

*Cross-milestone validation requires v1.1+ to confirm. v1.0 lessons above are single-milestone observations until v2.0 validates or refutes them.*
