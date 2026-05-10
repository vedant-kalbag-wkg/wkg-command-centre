---
phase: 10
plan: 08
type: execute
wave: 6
depends_on: [07]
files_modified:
  - .planning/phases/10-access-control-extended/10-HUMAN-UAT.md
  - .planning/ROADMAP.md
  - .planning/REQUIREMENTS.md
  - .planning/STATE.md
  - .planning/phases/10-access-control-extended/deferred-items.md
autonomous: false
requirements: [AUTH-06, AUTH-07]
must_haves:
  truths:
    - "All 4 Playwright specs in tests/access-control/*.spec.ts run AND PASS against the Vercel preview alias (BETTER_AUTH_URL pinned to git-branch alias per CLAUDE.md). --list is NOT sufficient evidence (per CLAUDE.md 'Playwright specs against preview deploys' rule)."
    - "10-HUMAN-UAT.md operator runbook documents: (1) Vercel preview env-var setup including BETTER_AUTH_URL + TEST_OPS_IT_PASSWORD + TEST_VIEWER_PASSWORD; (2) scripts/seed-test-users.ts run against preview DB; (3) operator checklist for migrations 0050/0051 auto-apply + manual 0052 with pre-check SQL; (4) post-merge rotation per CLAUDE.md aftercare; (5) lock-out recovery via scripts/reset-admin-password.ts."
    - "ROADMAP.md Phase 10 entry updated — phase marked complete, plans listed, success criteria all checked."
    - "REQUIREMENTS.md AUTH-06 + AUTH-07 boxes ticked + traceability table updated."
    - "STATE.md Phase 10 close entry written — locked decisions recapped (esp. Q1 reversal: user.role text PRESERVED), deferred items documented."
    - "deferred-items.md captures: (a) v1.2 — drop user.role text column once Better Auth admin plugin no longer needs it (DEFERRED-10-01); (b) any UAT-discovered gaps (DEFERRED-10-02)."
  artifacts:
    - path: ".planning/phases/10-access-control-extended/10-HUMAN-UAT.md"
      provides: "Operator runbook — Vercel preview setup, migration ops, Playwright runs, manual UAT checklist, post-merge close-out"
    - path: ".planning/ROADMAP.md"
      provides: "Phase 10 marked complete with plan list"
    - path: ".planning/REQUIREMENTS.md"
      provides: "AUTH-06 + AUTH-07 ticked + Phase 10 traceability rows"
    - path: ".planning/STATE.md"
      provides: "Phase 10 close entry — Q1 reversal documented, deferred items listed"
    - path: ".planning/phases/10-access-control-extended/deferred-items.md"
      provides: "Itemised deferrals to v1.2 with rationale + pre-conditions"
  key_links:
    - from: "10-HUMAN-UAT.md operator checklist"
      to: "Vercel preview alias + BETTER_AUTH_URL gotcha"
      via: "Per CLAUDE.md 'Vercel preview env vars': BETTER_AUTH_URL MUST be the git-branch alias"
      pattern: "BETTER_AUTH_URL.*git-branch"
    - from: "Playwright spec runs"
      to: "Vercel preview deployment"
      via: "PLAYWRIGHT_BASE_URL=https://wkg-command-centre-git-<sanitized-branch>-...vercel.app"
      pattern: "PLAYWRIGHT_BASE_URL"
---

<objective>
Run all 4 `tests/access-control/*.spec.ts` Playwright specs against the Vercel preview alias to satisfy the merge gate from CLAUDE.md "Playwright specs against preview deploys" — `--list` parsing alone is NOT sufficient evidence. Author the operator runbook (10-HUMAN-UAT.md) for migration application, env-var pinning, test-user seeding, and lock-out recovery. Close out Phase 10 docs (ROADMAP, REQUIREMENTS, STATE, deferred-items).

Purpose: This is the merge gate. Per CLAUDE.md every phase that ships UI MUST run Playwright against the preview alias before merging — Phase 6 plan 06-05 shipped specs that listed clean but missed a real regression because `--list` was treated as evidence. The operator-driven runbook captures every step the human must do (Vercel env, DB migration sequencing, manual smoke, scripts/reset-admin-password.ts as the recovery escape hatch).

Output: 4 Playwright specs PASSING against preview; 5 doc files updated/created. Phase 10 reaches "code-complete + UAT-pending-operator-walk" state. After operator approval, the phase-completion squash commit goes to main.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/STATE.md
@.planning/phases/10-access-control-extended/10-CONTEXT.md
@.planning/phases/10-access-control-extended/10-RESEARCH.md
@CLAUDE.md
@$HOME/.claude/CLAUDE.md

# Donor: prior phase HUMAN-UAT runbooks
@.planning/phases/09.1-multi-currency-analytics-forex-normalisation-to-gbp-base-rep/09.1-HUMAN-UAT.md
@.planning/phases/08-email-infrastructure/08-HUMAN-UAT.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author 10-HUMAN-UAT.md operator runbook</name>
  <files>.planning/phases/10-access-control-extended/10-HUMAN-UAT.md</files>
  <read_first>
    - .planning/phases/09.1-multi-currency-analytics-forex-normalisation-to-gbp-base-rep/09.1-HUMAN-UAT.md (donor — closest analog phase with migration ops + preview Playwright runs)
    - .planning/phases/08-email-infrastructure/08-HUMAN-UAT.md (donor — env-var setup pattern)
    - CLAUDE.md (entire `## Vercel preview env vars` and `## Playwright specs against preview deploys` and `## Prod admin password rotation` sections)
    - migrations/0048_phase_09_1_net_amount_gbp_not_null.sql (operator-gated NOT-NULL flip pattern — this phase's 0052 follows the same shape)
    - .planning/phases/10-access-control-extended/10-02-…-PLAN.md (the 0052 verification gate SQL)
  </read_first>
  <action>
    Author the runbook with these sections (port the structure from 09.1-HUMAN-UAT.md):

    ```markdown
    # Phase 10: Access Control Extended — Human UAT Runbook

    **Phase:** 10 — Access Control Extended
    **Branch:** `gsd/phase-10-access-control-extended`
    **Status:** code-complete + UAT-pending
    **Last updated:** <DATE>

    ---

    ## Pre-flight: confirm phase branch + lockfile shape

    1. `git status` clean on branch `gsd/phase-10-access-control-extended`.
    2. CI green on the branch — GitHub Actions `npm ci` + lint + unit + integration steps all passed.
       If `npm ci` fails with `Missing: @emnapi/...` or `Cannot find module '@*/binding-linux-x64-gnu'`,
       redo the canonical Docker regen per CLAUDE.md `## npm lockfile must stay in sync` section
       BEFORE proceeding. Lockfile-drift in this phase is most likely from the @casl/ability +
       @casl/react adds in Plan 10-02.
    3. Verify lockfile shape:
       ```bash
       grep -c '"node_modules/@casl/ability"' package-lock.json   # ≥ 1
       grep -c '"node_modules/@casl/react"' package-lock.json     # ≥ 1
       grep -c '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json  # ≥ 1
       grep -c '"node_modules/@tailwindcss/oxide-linux-x64-gnu"' package-lock.json # ≥ 1
       grep -c '"node_modules/@next/swc-linux-x64-gnu"' package-lock.json          # ≥ 1
       ```

    ---

    ## Step 1 — Trigger Vercel preview deploy

    Push the branch and wait for Vercel to build:

    ```bash
    git push origin gsd/phase-10-access-control-extended
    ```

    Note the git-branch alias Vercel mints (NOT the per-deploy `<hash>` URL). Find via:

    ```bash
    vercel alias ls | grep wkg-command-centre-git-gsd-phase-10
    ```

    Expected shape: `wkg-command-centre-git-gsd-phase-10-access-control-extended-vedant-kalbag-wkgs-projects.vercel.app`

    ---

    ## Step 2 — Pin BETTER_AUTH_URL to the git-branch alias (CRITICAL)

    Per CLAUDE.md `## Vercel preview env vars`: BETTER_AUTH_URL must use the git-branch alias.
    Setting it to a per-deploy URL with a `<hash>` breaks every redeploy.

    ```bash
    BRANCH_ALIAS="https://wkg-command-centre-git-gsd-phase-10-access-control-extended-vedant-kalbag-wkgs-projects.vercel.app"
    echo "$BRANCH_ALIAS" | vercel env add BETTER_AUTH_URL preview gsd/phase-10-access-control-extended
    ```

    Trigger a redeploy after env change so the build picks it up.

    ---

    ## Step 3 — Apply migrations 0050 + 0051 (auto-apply via Vercel build)

    Migrations 0050 and 0051 auto-apply in the Vercel preview build pipeline. Confirm via the
    build log: search for `Applying migration: 0050_phase_10_roles_schema` and
    `0051_phase_10_seed_and_backfill`.

    Verify on the preview DB:

    ```bash
    PREVIEW_DB_URL="<preview DATABASE_URL from Vercel>"
    psql "$PREVIEW_DB_URL" -c "SELECT name, kind FROM roles ORDER BY name;"
    # Expected:
    #     name    |  kind
    # ------------+--------
    #  admin      | system
    #  ops-it     | tier
    #  read-only  | tier

    psql "$PREVIEW_DB_URL" -c "SELECT COUNT(*) FROM user_roles;"
    # Expected: same as the COUNT(*) of users with non-NULL user.role text on preview DB

    psql "$PREVIEW_DB_URL" -c "SELECT COUNT(*) FROM user_scopes WHERE role_id IS NULL;"
    # Expected: 0 (Plan 10-02 0051 backfill should have populated all rows)
    ```

    ---

    ## Step 4 — Manually apply migration 0052 (operator-gated NOT-NULL flip)

    Per the 0052 header, this is operator-gated. The verification gate is the COUNT above
    (Step 3 final check). If 0 NULL rows, proceed:

    ```bash
    psql "$PREVIEW_DB_URL" -f migrations/0052_phase_10_user_scopes_role_id_required.sql
    ```

    Idempotent — re-running on already-NOT-NULL is a no-op.

    Verify post-flip:

    ```bash
    psql "$PREVIEW_DB_URL" -c "SELECT is_nullable FROM information_schema.columns WHERE table_name='user_scopes' AND column_name='role_id';"
    # Expected: NO
    ```

    If COUNT was non-zero, do NOT apply 0052 — investigate why backfill missed rows. Likely cause:
    a user had user_scopes rows but no user_roles row (impossible after 0051 unless schema is out of
    sync). Re-run 0051 idempotently first.

    ---

    ## Step 5 — Seed test users on the preview DB

    Plan 10-01's Playwright specs need TEST_OPS_IT and TEST_VIEWER credential rows in the preview
    DB. Run the seed script:

    ```bash
    DATABASE_URL="$PREVIEW_DB_URL" \
    NODE_ENV="preview" \
    TEST_OPS_IT_EMAIL="ops-it.test@weknowgroup.com" \
    TEST_OPS_IT_PASSWORD="<choose a strong password>" \
    TEST_VIEWER_EMAIL="viewer.test@weknowgroup.com" \
    TEST_VIEWER_PASSWORD="<choose a strong password>" \
      npx tsx scripts/seed-test-users.ts
    ```

    Expected output: `Seeded ops-it.test@weknowgroup.com (userId=..., role=member)` and similar
    for viewer. Script REFUSES if NODE_ENV=production OR DATABASE_URL contains 'wkg-command-centre'.
    For preview the URL contains the project name but not 'wkg-command-centre' (preview projects
    have alias-derived URLs). If the refusal triggers spuriously, double-check you're targeting
    the preview DB, NOT the prod project's DB.

    Add the same env vars to Vercel preview (so server-side rendering can match the credential
    paths if any test path needs them):

    ```bash
    vercel env add TEST_OPS_IT_EMAIL preview gsd/phase-10-access-control-extended
    vercel env add TEST_OPS_IT_PASSWORD preview gsd/phase-10-access-control-extended
    vercel env add TEST_VIEWER_EMAIL preview gsd/phase-10-access-control-extended
    vercel env add TEST_VIEWER_PASSWORD preview gsd/phase-10-access-control-extended
    ```

    ---

    ## Step 6 — Run Playwright UAT against the preview alias (MANDATORY merge gate)

    Per CLAUDE.md `## Playwright specs against preview deploys`: `--list` is NOT sufficient evidence.
    Run the specs:

    ```bash
    PLAYWRIGHT_BASE_URL="$BRANCH_ALIAS" \
    TEST_ADMIN_EMAIL="vedant.kalbag@weknowgroup.com" \
    TEST_ADMIN_PASSWORD="<from .env.test or 1Password>" \
    TEST_OPS_IT_EMAIL="ops-it.test@weknowgroup.com" \
    TEST_OPS_IT_PASSWORD="<the password chosen in Step 5>" \
    TEST_VIEWER_EMAIL="viewer.test@weknowgroup.com" \
    TEST_VIEWER_PASSWORD="<the password chosen in Step 5>" \
      npx playwright test tests/access-control/
    ```

    Expected: 4 specs pass. If any fail, fix the regression BEFORE merging.

    Check Playwright report for screenshots on failure (`playwright.config.ts` has
    `use: { screenshot: 'only-on-failure' }`).

    ---

    ## Step 7 — Manual smoke checklist

    Cannot be automated; the operator walks these by hand against `$BRANCH_ALIAS`:

    **As admin (vedant.kalbag@weknowgroup.com):**
    - [ ] Sidebar shows "Configure" nav-group (admin gate via <Can I="manage" a="all">)
    - [ ] User menu shows "Admin" section (admin gate)
    - [ ] /settings hub shows the new "Roles" tile
    - [ ] /settings/roles lists Admin (system, locked) + Ops-IT (tier) + Read-only (tier)
    - [ ] Drill into Ops-IT — rule editor shows the seeded rules; subject multi-select / action chips / field picker / conditions builder all functional
    - [ ] Edit Ops-IT: remove the `read Kiosk` rule. Save triggers diff modal showing "1 removed, 0 added, 0 changed" + N user(s) impacted. Confirm. Toast "Saved" appears.
    - [ ] /settings/users/{some non-admin}/page renders with the Roles assignment block. Assign Ops-IT. Toast appears.
    - [ ] On the SAME user, click revoke (X). Confirmation prompt → revoke succeeds.
    - [ ] Try to revoke YOUR OWN admin role (you are the only admin) — expect "Refusing to save: this change would leave the system with no effective admin..." toast.
    - [ ] /locations/{some location} — admin sees "Merge" button.

    **As TEST_VIEWER (sign out, sign in):**
    - [ ] Sidebar does NOT show "Configure" nav-group
    - [ ] User menu does NOT show "Admin" section
    - [ ] /settings/roles redirects or 403s
    - [ ] /locations/{some location} — Merge button is NOT visible

    **Better Auth admin plugin smoke:**
    - [ ] Admin → /settings/users → "Set role" on a non-admin works (Better Auth set-role endpoint reads user.role text mirror — must still be populated by refreshUserRoleMirror)
    - [ ] Admin → impersonate the TEST_VIEWER → ability is REBUILT off the impersonated identity (operator confirms by visiting /settings — admin tiles hidden under impersonation)

    Restore Ops-IT rules to original after smoke (so subsequent operator runs see the seeded set).
    From admin in /settings/roles/{ops-it}: paste the original rule list back. OR run a one-off
    psql to TRUNCATE role_permissions WHERE role_id=(SELECT id FROM roles WHERE name='ops-it')
    and re-apply 0051 Delta 2.

    ---

    ## Step 8 — Lock-out recovery escape hatch

    If during UAT (or any future op) the system reaches a zero-effective-admin state, the recovery
    is `scripts/reset-admin-password.ts` per CLAUDE.md `## Prod admin password rotation`:

    ```bash
    ADMIN_EMAIL='vedant.kalbag@weknowgroup.com' \
    ADMIN_PASSWORD='<a fresh strong password>' \
    DATABASE_URL='<prod or preview DB URL>' \
      npx tsx scripts/reset-admin-password.ts
    ```

    Important: this script writes to `account` table credentials but does NOT touch user_roles.
    If the operator reset their password but is also missing the admin user_roles row (unlikely
    post-Plan 10 because 0051 backfill grants admin via the existing user.role text), they would
    need a second psql command to insert the row. Document path to recover, the rare case:

    ```sql
    INSERT INTO user_roles (user_id, role_id)
      SELECT (SELECT id FROM "user" WHERE email='vedant.kalbag@weknowgroup.com'),
             (SELECT id FROM roles WHERE name='admin')
      ON CONFLICT DO NOTHING;
    -- Then refresh user.role text mirror manually:
    UPDATE "user" SET role='admin' WHERE email='vedant.kalbag@weknowgroup.com';
    ```

    ---

    ## Step 9 — Phase merge

    Once Steps 1–8 are clean:

    1. Phase-completion summary commit on the branch (per `~/.claude/CLAUDE.md` GSD Workflow Preferences "Phase completion commits").
    2. Open PR `gsd/phase-10-access-control-extended` → `main`.
    3. PR description: link this UAT runbook + summary of all 8 plans + critical reversals from RESEARCH (Q1 user.role preserved).
    4. After review + merge: rotate TEST_OPS_IT_PASSWORD + TEST_VIEWER_PASSWORD on prod IF those env vars were promoted (they should NOT be — they're preview-only). Confirm prod env vars do not include TEST_OPS_IT_*/TEST_VIEWER_* via `vercel env ls production`.

    ---

    ## Aftercare

    Per CLAUDE.md `## Prod admin password rotation` § Aftercare:
    - Do NOT commit the test-user passwords anywhere
    - Hand off via 1Password or similar
    - Consider rotating to a fresh password the operator owns once UAT completes
    ```
  </action>
  <acceptance_criteria>
    - `.planning/phases/10-access-control-extended/10-HUMAN-UAT.md` exists
    - File has all 9 numbered steps + the lock-out recovery escape hatch
    - File explicitly references CLAUDE.md sections by name (`## Vercel preview env vars`, `## Playwright specs against preview deploys`, `## Prod admin password rotation`)
    - File contains the operator verification SQL for migration 0052 (`SELECT COUNT(*) FROM user_scopes WHERE role_id IS NULL`)
    - File contains the canonical Playwright run command with `PLAYWRIGHT_BASE_URL=$BRANCH_ALIAS`
    - File documents the lock-out recovery via `scripts/reset-admin-password.ts`
  </acceptance_criteria>
  <verify>
    <automated>test -f .planning/phases/10-access-control-extended/10-HUMAN-UAT.md && grep -q "BETTER_AUTH_URL" .planning/phases/10-access-control-extended/10-HUMAN-UAT.md && grep -q "PLAYWRIGHT_BASE_URL" .planning/phases/10-access-control-extended/10-HUMAN-UAT.md && grep -q "user_scopes WHERE role_id IS NULL" .planning/phases/10-access-control-extended/10-HUMAN-UAT.md && grep -q "scripts/reset-admin-password.ts" .planning/phases/10-access-control-extended/10-HUMAN-UAT.md && grep -q "git-branch alias" .planning/phases/10-access-control-extended/10-HUMAN-UAT.md</automated>
  </verify>
  <done>10-HUMAN-UAT.md captures every operator step from Vercel env-pin through migration application through Playwright runs through manual smoke through lock-out recovery. The merge gate is now self-serve for the operator.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Phase 10 has reached code-complete status. Plans 10-01..10-07 have shipped:
    - Wave 0 RED tests (10-01)
    - Schema + migrations + audit-extension + lockfile (10-02)
    - CASL ability builder + provider (10-03)
    - rbac.ts shim + 4 redactSensitiveFields call sites (10-04)
    - /settings/roles admin UI (10-05)
    - User-role assignment UI + removeUser lock-out wrap (10-06)
    - <Can> client gates + AbilityProvider in layout (10-07)

    Plan 10-08 has authored 10-HUMAN-UAT.md. The merge gate is now operator-driven.
  </what-built>
  <how-to-verify>
    Operator follows 10-HUMAN-UAT.md end-to-end:

    1. Push the phase branch to origin; wait for Vercel preview to build.
    2. Pin BETTER_AUTH_URL to the git-branch alias (Step 2 of 10-HUMAN-UAT.md).
    3. Verify migrations 0050/0051 auto-applied on preview DB; manually apply 0052 after confirming 0 NULL rows.
    4. Run `scripts/seed-test-users.ts` against the preview DB.
    5. Run all 4 Playwright specs against the preview alias:
       ```bash
       PLAYWRIGHT_BASE_URL=$BRANCH_ALIAS \
       TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... \
       TEST_OPS_IT_EMAIL=... TEST_OPS_IT_PASSWORD=... \
       TEST_VIEWER_EMAIL=... TEST_VIEWER_PASSWORD=... \
         npx playwright test tests/access-control/
       ```
       Expected: 4 specs PASS. If any fail, fix BEFORE merging.
    6. Walk the Step 7 manual smoke checklist (admin + viewer + Better Auth admin plugin smoke).
    7. Confirm lock-out recovery (Step 8) works on a fresh test scratch DB if needed.

    If steps 1-7 are clean, type "approved-uat" to proceed to phase doc closeout (Task 3).
    If anything fails, type "uat-failed" + the failing step + observed behaviour. Plan back into Wave 2/3 for the fix.
  </how-to-verify>
  <resume-signal>
    Type "approved-uat" if Steps 1-7 of 10-HUMAN-UAT.md all clean.
    Type "uat-failed" + step number + failure detail otherwise.
    Type "lockfile-broken" if Step 1 trips the lockfile-shape gate (redo Docker regen).
    Type "migration-stuck" if Steps 3-4 fail (e.g. 0052 NULL count > 0).
  </resume-signal>
</task>

<task type="auto">
  <name>Task 3: Update ROADMAP.md, REQUIREMENTS.md, STATE.md, deferred-items.md (post-UAT close-out)</name>
  <files>
    .planning/ROADMAP.md,
    .planning/REQUIREMENTS.md,
    .planning/STATE.md,
    .planning/phases/10-access-control-extended/deferred-items.md
  </files>
  <read_first>
    - .planning/ROADMAP.md (Phase 10 entry)
    - .planning/REQUIREMENTS.md (AUTH-06 + AUTH-07 entries + Phase 10 traceability table)
    - .planning/STATE.md (current state — full file)
    - .planning/phases/09.1-…/deferred-items.md (donor pattern for deferred-items file)
    - .planning/phases/08-email-infrastructure/deferred-items.md (donor)
  </read_first>
  <action>
    **ROADMAP.md** — find the Phase 10 entry. Update:

    1. Change status from `- [ ]` to `- [x]`.
    2. Append `**MERGED <DATE>** (PR #N, squash <COMMIT-SHA>; ...)` at the end of the Phase 10 line — match Phase 9.1's shape.
    3. In the "Phase Details" section for Phase 10, fill in the Plans block with the 8 PLANs:
       ```
       Plans:
       - [x] 10-01-wave-0-test-scaffolds-PLAN.md — RED test scaffolds (16 files)
       - [x] 10-02-schema-migrations-and-audit-extension-PLAN.md — schema + 3 migrations + audit union widen + CASL deps
       - [x] 10-03-casl-core-ability-builder-PLAN.md — buildAbility + types/subjects/fields/external-invariant/seed/role-mirror/lockout-guard/ability-context
       - [x] 10-04-rbac-shim-and-call-site-cutover-PLAN.md — rbac.ts shim + 4 redactSensitiveFields call sites
       - [x] 10-05-settings-roles-admin-ui-PLAN.md — /settings/roles list + drill-in + diff-preview
       - [x] 10-06-user-role-assignment-ui-and-removeuser-wrap-PLAN.md — /settings/users/[id]/page.tsx + role-actions + deleteUser lockout wrap
       - [x] 10-07-client-can-gates-and-ability-provider-PLAN.md — layout AbilityProvider + 3 <Can> gates
       - [x] 10-08-playwright-uat-and-doc-closeout-PLAN.md — preview Playwright + ops runbook + doc closeout
       ```
    4. Update the Progress table: `| 10. Access Control Extended | 8/8 | Complete (PR #N merged) | <DATE> |`.

    **REQUIREMENTS.md** — find the AUTH-06 + AUTH-07 lines. Tick both:

    - `- [x] **AUTH-06** — ...`
    - `- [x] **AUTH-07** — ...`

    Update the traceability table rows:

    ```
    | AUTH-06 | Phase 10 | SC1+SC2+SC4+SC5 — CASL Ability built in get-user-ctx; admin UI for tier rule editing without deploy; redactSensitiveFields → permittedFieldsOf; existing 3-role coverage preserved | ✓ COMPLETE <DATE> |
    | AUTH-07 | Phase 10 | SC3 — admin UI for creating/editing/cloning custom granular roles + per-(user, role) scope binding | ✓ COMPLETE <DATE> |
    ```

    **STATE.md** — append a new "Phase 10 close (post-execution) <DATE>" subsection. Mirror Phase 9.1's structure. Cover:

    - 8 plans across 6 waves shipped on branch `gsd/phase-10-access-control-extended` (per plan-frontmatter `wave:` fields: 10-01 + 10-02 in Wave 1; 10-03 in Wave 2; 10-04 + 10-05 in Wave 3; 10-06 in Wave 4; 10-07 in Wave 5; 10-08 in Wave 6)
    - Critical reversal documented: **user.role text PRESERVED** (RESEARCH §Q1 reversed CONTEXT decision; Better Auth admin plugin reads it in 12 endpoints)
    - Headline deliverables (port from each PLAN's must_haves):
      - DB schema: 3 new tables (roles, role_permissions, user_roles) + user_scopes.role_id NOT NULL post-0052
      - CASL core: buildAbility react.cache-wrapped, system short-circuit, external-invariant code-level guard, lockout-guard with Path B SQL
      - Admin UI: /settings/roles authoring + /settings/users/[id] role assignment
      - SSR-safe <Can>: AbilityProvider rules-as-prop pattern, 3 client gates migrated
      - Audit log: 5 new metadata kinds (role.create, role.permissions.replace, role.delete, user.roles.assign, user.roles.revoke)
    - Decisions captured during execution (any deviations from CONTEXT/RESEARCH)
    - Operator UAT against preview alias clean (per 10-HUMAN-UAT.md)
    - One deferred item: user.role text DROP in v1.2 once Better Auth admin plugin no longer reads it (e.g. v1.6+ release notes show role-resolver hook OR project writes a customSession plugin). Per-(user, role) scope-edit UI ships in v1.1 via Plan 10-06 Task 4 (NOT deferred).

    Update STATE.md frontmatter:
    - `progress.completed_phases: 4` (was 3)
    - `progress.completed_plans: <N + 8>`
    - `progress.percent: <recompute>`
    - `last_activity: "<DATE> — Phase 10 (Access Control Extended) merged."`
    - `stopped_at: "Phase 10 (Access Control Extended) merged via PR #N (commit <SHA>); ..."`

    Update v1.1 phase index:
    - `- ✓ Phase 10: Access Control Extended — AUTH-06..07 — **MERGED <DATE>** (PR #N, squash <SHA>; ...)`

    **deferred-items.md** — new file. Donor pattern from `.planning/phases/09.1-…/deferred-items.md`:

    ```markdown
    # Phase 10 — Deferred Items

    ## DEFERRED-10-01 — Drop user.role text column

    **Decision:** Per RESEARCH §Q1, Better Auth admin plugin (1.5.x) reads `session.user.role` text
    in 12 endpoint handlers. The text mirror is preserved as denormalised primary-tier indicator,
    refreshed in lock-step with user_roles writes via `refreshUserRoleMirror`. Dropping the column
    requires either Better Auth 1.6+ (if it adds a hookable role-resolver) or replacing the admin
    plugin's role-reads with a custom session augmenter. Out of scope for v1.1.

    **Pre-condition:** Better Auth release notes show role-read can be hooked, OR project decides
    to write a customSession plugin. Then v1.2 can DROP user.role + remove refreshUserRoleMirror.

    **Tracking:** Re-evaluate during v1.2 planning. Confidence on remove path: MEDIUM (depends on
    upstream).

    ## DEFERRED-10-02 — <UAT-discovered gap, if any>

    Populated during operator UAT walk if specific issues are deferred. If clean, this section
    can be removed.
    ```
  </action>
  <acceptance_criteria>
    - `.planning/ROADMAP.md` Phase 10 entry shows `- [x]` + MERGED date + plan list with 8 entries
    - `.planning/ROADMAP.md` Progress table row for Phase 10 shows 8/8 + Complete + completed date
    - `.planning/REQUIREMENTS.md` shows `- [x] **AUTH-06**` and `- [x] **AUTH-07**` (search for them)
    - `.planning/REQUIREMENTS.md` traceability table rows for AUTH-06 + AUTH-07 marked `✓ COMPLETE <DATE>`
    - `.planning/STATE.md` has a Phase 10 close subsection with the headline deliverables + Q1 reversal
    - `.planning/STATE.md` frontmatter `progress.completed_phases` incremented to 4
    - `.planning/phases/10-access-control-extended/deferred-items.md` exists with at least DEFERRED-10-01 and DEFERRED-10-02
    - All four files committed
  </acceptance_criteria>
  <verify>
    <automated>grep -q "Phase 10: Access Control Extended.*MERGED\|10. Access Control Extended.*Complete" .planning/ROADMAP.md && grep -q "\- \[x\] \*\*AUTH-06\*\*" .planning/REQUIREMENTS.md && grep -q "\- \[x\] \*\*AUTH-07\*\*" .planning/REQUIREMENTS.md && grep -q "Phase 10 close" .planning/STATE.md && grep -q "user.role text PRESERVED\|user\\.role.*PRESERVED" .planning/STATE.md && test -f .planning/phases/10-access-control-extended/deferred-items.md && grep -q "DEFERRED-10-01\|DEFERRED-10-02" .planning/phases/10-access-control-extended/deferred-items.md</automated>
  </verify>
  <done>ROADMAP / REQUIREMENTS / STATE / deferred-items updated per the v1.1 close-out shape. Phase 10 reaches "merged" doc state. Q1 reversal (user.role preserved) is the headline in STATE.md so future agents inherit the decision context.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Operator runs scripts/seed-test-users.ts ↔ DATABASE_URL | Two prod-refusal gates (NODE_ENV + URL hint). Operator must double-check the URL. |
| Vercel preview env BETTER_AUTH_URL ↔ git-branch alias | Pinning incorrectly (per-deploy URL with hash) breaks every redeploy. Documented per CLAUDE.md. |
| Test user passwords on preview env ↔ prod env | TEST_OPS_IT_PASSWORD + TEST_VIEWER_PASSWORD must NEVER be promoted to prod env. Step 9 includes the verification. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-08-01 | Information Disclosure | Test user passwords leak via Vercel UI screenshot or shell history | mitigate | 10-HUMAN-UAT.md "Aftercare" instructs operator: do not commit, hand off via 1Password, rotate post-UAT. |
| T-10-08-02 | Tampering | Operator skips Step 6 Playwright runs, relies on `--list` only (CLAUDE.md violation) | mitigate | 10-HUMAN-UAT.md Step 6 explicitly cites CLAUDE.md "## Playwright specs against preview deploys" rule + the historical regression (Phase 6 plan 06-05). Checkpoint Task 2 BLOCKS on operator approval. |
| T-10-08-03 | Denial of Service | 0052 applied before 0051 backfill on prod (Phase 9.1 Pitfall 6 lesson) | mitigate | Step 4 explicitly gates on the COUNT(*) verification SQL returning 0. Idempotency means re-applying 0052 is safe. |
| T-10-08-04 | Repudiation | STATE.md doesn't record the Q1 reversal, future agents repeat the mistake | mitigate | Task 3 explicitly requires "user.role text PRESERVED" headline in the STATE.md close subsection + DEFERRED-10-02 documents the conditions for removal. |
</threat_model>

<verification>
- 10-HUMAN-UAT.md exists with 9 steps + lock-out recovery
- Plan 10-01's 4 Playwright specs PASS against preview alias (operator UAT walk in Task 2)
- ROADMAP / REQUIREMENTS / STATE / deferred-items all updated post-merge
- Phase 10 frontmatter and progress fields reflect completion
- AUTH-06 and AUTH-07 ticked in REQUIREMENTS.md
</verification>

<success_criteria>
- 5 doc files created/updated
- Phase 10 reaches code-complete + UAT-passed + doc-closed-out state
- Operator has self-serve runbook for UAT + lock-out recovery
- 8 plans across 6 waves shipped (Plan 10-01 + 10-02 in Wave 1; 10-03 in Wave 2; 10-04 + 10-05 in Wave 3; 10-06 in Wave 4; 10-07 in Wave 5; 10-08 in Wave 6 — matches each plan's frontmatter `wave:` field)
- Critical reversal (Q1 user.role preserved) documented in STATE.md so future agents inherit context
- One deferred item registered with pre-conditions for v1.2 pickup (user.role text DROP — pending Better Auth admin plugin role-resolver hook)
</success_criteria>

<output>
After completion, create `.planning/phases/10-access-control-extended/10-08-SUMMARY.md` documenting:
- 10-HUMAN-UAT.md authored
- All 4 Playwright specs PASS against preview alias (with the screenshots / report URL if any failed during UAT and were fixed)
- ROADMAP / REQUIREMENTS / STATE / deferred-items updated
- The PR number + squash commit SHA from merge
- The deferred item (user.role text DROP) with pre-conditions for v1.2 pickup
- Final phase status: ✓ MERGED
</output>
