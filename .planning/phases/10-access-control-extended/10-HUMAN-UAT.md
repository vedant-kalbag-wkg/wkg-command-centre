# Phase 10: Access Control Extended — Human UAT Runbook

**Phase:** 10 — Access Control Extended
**Branch:** `gsd/phase-10-access-control-extended`
**Status:** code-complete + UAT-pending
**Last updated:** 2026-05-10

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
   grep -c '"node_modules/@casl/ability"' package-lock.json   # >= 1
   grep -c '"node_modules/@casl/react"' package-lock.json     # >= 1
   grep -c '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json  # >= 1
   grep -c '"node_modules/@tailwindcss/oxide-linux-x64-gnu"' package-lock.json # >= 1
   grep -c '"node_modules/@next/swc-linux-x64-gnu"' package-lock.json          # >= 1
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
Setting it to a per-deploy URL with a `<hash>` breaks every redeploy because Vercel mints
a new `<hash>` each build and the stale `BETTER_AUTH_URL` no longer matches the request origin,
causing all `/api/auth/*` calls to return `403 Invalid origin`.

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

Idempotent — re-running on an already-NOT-NULL column is a no-op.

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
- [ ] Sidebar shows "Configure" nav-group (admin gate via `<Can I="manage" a="all">`)
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

1. Phase-completion summary commit on the branch (per `~/.claude/CLAUDE.md` GSD Workflow Preferences
   "Phase completion commits").
2. Open PR `gsd/phase-10-access-control-extended` → `main`.
3. PR description: link this UAT runbook + summary of all 8 plans + critical reversals from
   RESEARCH (Q1 user.role preserved).
4. After review + merge: rotate TEST_OPS_IT_PASSWORD + TEST_VIEWER_PASSWORD on prod IF those
   env vars were promoted (they should NOT be — they're preview-only). Confirm prod env vars do
   not include TEST_OPS_IT_*/TEST_VIEWER_* via `vercel env ls production`.

---

## Aftercare

Per CLAUDE.md `## Prod admin password rotation` section, Aftercare:
- Do NOT commit the test-user passwords anywhere
- Hand off via 1Password or similar
- Consider rotating to a fresh password the operator owns once UAT completes
