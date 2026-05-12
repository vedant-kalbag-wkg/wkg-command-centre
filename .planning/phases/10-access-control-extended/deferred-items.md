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

## DEFERRED-10-02 — Live UAT-discovered gaps (closed 2026-05-12)

The multi-round live Playwright UAT against the Vercel preview (Plan 10-13 rounds 1-4)
shipped its source-level fixes via Plans 10-14, 10-15, and 10-13 round-4 itself.
Final tally: 7/8 PASS. The one remaining failure is intractable in the current spec
shape and is captured below as `DEFERRED-10-02-A`.

### DEFERRED-10-02-A — `user-role-assignment.spec.ts:61` strict-mode locator

**Decision:** The spec uses `page.getByLabel(/role/i).click()` at line 79 to pick a
role from the inline Select. Once Cluster 1 (Plan 10-13 round-4 commit `fb80f00`)
enables the Assign-role button on initial render, the spec progresses to line 79
and Playwright resolves the locator to **3 elements**:

1. `<section role="region" aria-label="Role assignment">` — the landmark needed by
   spec line 47 (`getByRole("region", { name: /role assignment/i })`, PASSING).
2. `<button role="combobox" aria-label="Role">` — the Select trigger the spec wants.
3. `<button aria-label="Assign role">` — the submit button (currently labelled
   "Assign role" both via visible text AND via redundant aria-label).

The section MUST keep an accessible name containing "role assignment" for spec line
47 to match. Any such name necessarily contains "role", so `getByLabel(/role/i)`
on line 79 always matches at least 2 elements (section + Select trigger).
Strict-mode violation is therefore unavoidable in product source — the spec needs
to be tightened.

**Recommended spec re-shape (out of v1.1 Phase 10 scope):**

- Narrow regex: change line 79 to `getByLabel("Role", { exact: true })` or `/^Role$/i`.
- Scope locator: `page.getByRole("region", { name: /role assignment/i }).getByLabel(/role/i)`.
- Add a Test-ID: `getByTestId("role-select")` (requires adding `data-testid` to the
  SelectTrigger in `src/app/(app)/settings/users/[id]/role-assignment-client.tsx`).

**Pre-condition:** Spec re-shape can land in any future v1.1 close-out plan or v1.2
test-resilience pass. The underlying role-assignment + scope flow is implemented
and unit-tested (`tests/rbac/*` + `tests/access-control/user-role-assignment.spec.ts:41`
PASSES the region-landmark check).

**Tracking:** Re-evaluate during v1.2 spec hardening, OR when any spec touching the
inline role-assignment widget is re-edited.
