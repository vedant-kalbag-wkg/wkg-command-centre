---
phase: 10
plan: 14
subsystem: access-control-extended
tags: [gap-closure, playwright-uat, null-guard, a11y, selector-alignment, wave-8]
requires: [10-12, 10-11, 10-06, 10-05]
provides: [unblock-10-13]
affects:
  - src/app/(app)/locations/[id]/page.tsx
  - src/app/(app)/settings/roles/role-list-client.tsx
  - src/app/(app)/settings/roles/[id]/role-editor-client.tsx
  - src/app/(app)/settings/users/[id]/role-assignment-client.tsx
tech_stack:
  added: []
  patterns: [rsc-derived-field-backfill, computed-aria-label-row, optional-textarea-undefined]
key_files:
  created:
    - .planning/phases/10-access-control-extended/10-14-SUMMARY.md
  modified:
    - src/app/(app)/locations/[id]/page.tsx
    - src/app/(app)/settings/roles/role-list-client.tsx
    - src/app/(app)/settings/roles/[id]/role-editor-client.tsx
    - src/app/(app)/settings/users/[id]/role-assignment-client.tsx
    - .planning/STATE.md
    - .planning/ROADMAP.md
decisions:
  - "RSC-boundary backfill chosen over server-action edit: preserves getLocation's field-redaction contract; backfills hotelGroupMemberships/assignedKiosks/internalPocName at consumer entry instead."
  - "Subject-first join in RuleRow accessibleName: produces 'Kiosk read' which matches /kiosk.*read/i; action-first would silently miss."
  - "Description sent as undefined when empty (not empty string): matches createRole's `description?: string` optional shape, no schema change."
  - "Add scope aria-label deliberately replaces the title-only affordance for screen-reader / Playwright consumers; visible icon-only UX unchanged."
metrics:
  duration_minutes: 9
  tasks_completed: 4
  files_modified: 4
  completed_date: 2026-05-11
---

# Phase 10 Plan 14: Gap-closure Round 2 — Source Fixes (a11y + null-guard) Summary

Surgical source-level closure of the 2 root-cause clusters captured in `10-13-PARTIAL.md`. Four files modified across four atomic commits; zero touches to migrations, CASL substrate, server actions, or the LocationDetailForm consumer. Unblocks the resumed Plan 10-13 Playwright run via `/gsd-execute-phase 10 --gaps-only --wave 8`.

## Task-by-task

### Task 1 — `fix(10-14): null-guard …` — commit `589c979`

**File:** `src/app/(app)/locations/[id]/page.tsx`
**Lines inserted:** 28 (rename `location` → `rawLocation`) + 30-46 (backfill block, 19 net new lines)

BEFORE:
```tsx
const { location } = locationResult;
const allowed = new Set(readableFields(ctx.ability, "Location"));
const canSeeSensitive = allowed.has("bankingDetails");
```

AFTER:
```tsx
const { location: rawLocation } = locationResult;
const allowed = new Set(readableFields(ctx.ability, "Location"));
const canSeeSensitive = allowed.has("bankingDetails");

// Plan 10-14 / Cluster A — readableFields(ability, "Location") returns the Drizzle
// column set… Backfill safe defaults here at the RSC boundary so the consumer's
// signature (LocationWithRelations) is honoured without changing getLocation's
// contract or the field-redaction semantics.
const location = {
  ...rawLocation,
  hotelGroupMemberships: rawLocation.hotelGroupMemberships ?? [],
  assignedKiosks: rawLocation.assignedKiosks ?? [],
  internalPocName: rawLocation.internalPocName ?? null,
};
```

Cluster A confirmation: `getLocation` server contract preserved; `git diff src/app/(app)/locations/actions.ts` is empty. `LocationDetailForm` consumer was NOT edited (`git diff src/components/locations/location-detail-form.tsx` is empty — all 5+ `.map()` call sites at lines 373/385/389/940 are now safe because the RSC backfills before the form ever sees the data). The Plan 10-12 `<Can I="merge" a="Location">` wrapper at lines 62-71 (post-insert) is intact.

### Task 2 — `feat(10-14): row+remove a11y …` — commit `f0136df`

**File:** `src/app/(app)/settings/roles/[id]/role-editor-client.tsx`
**Lines inserted:** 462-475 (subject-first accessibleName block + role/aria-label on the outer div) + line 519 (`aria-label="Remove"`) + line 521 (`aria-hidden="true"`)

BEFORE (Change A, line 462-463):
```tsx
return (
  <div className="rounded-lg border border-border bg-card">
```

AFTER:
```tsx
const accessibleName = [
  (subject as string) ?? "",
  ((actions as string[]) ?? []).filter(Boolean).join(" "),
]
  .filter(Boolean)
  .join(" ")
  .trim() || `rule-${index + 1}`;

return (
  <div
    role="row"
    aria-label={accessibleName}
    className="rounded-lg border border-border bg-card"
  >
```

BEFORE (Change B, lines ~500-508):
```tsx
<button … title="Remove rule">
  <Trash2 className="size-3.5" />
</button>
```

AFTER:
```tsx
<button … title="Remove rule" aria-label="Remove">
  <Trash2 className="size-3.5" aria-hidden="true" />
</button>
```

**Cluster B Task 2 confirmation — `/kiosk.*read/i` regex check:** For the Ops-IT seed row `('read', 'Kiosk', NULL)` (migration 0051, line 39), `subject = "Kiosk"` and `actions = ["read"]`, so `accessibleName = "Kiosk read"`. Verified at the shell:

```
$ node -e 'console.log(/kiosk.*read/i.test("Kiosk read"));'
true
```

If the array order is ever swapped to action-first the produced label would be `"read Kiosk"` and `/kiosk.*read/i` would fail because `.*` cannot reorder the input — the awk gate `awk '/const accessibleName = \[/,/\.filter\(Boolean\)/' role-editor-client.tsx | head -3 | grep -q '(subject as string)'` is what locks this invariant.

### Task 3 — `feat(10-14): add Description Textarea …` — commit `99699be`

**File:** `src/app/(app)/settings/roles/role-list-client.tsx`
**Lines inserted:** new import after line 22; `createDescription` state line 67; `description` payload + reset in `handleCreate` lines 88, 96 (+ surrounding context); new `<Label>` + `<Textarea>` block lines 302-317 between display-name and role-name.

Change A — import:
```tsx
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
```

Change B — state:
```tsx
const [createDescription, setCreateDescription] = useState("");
```

Change C — handleCreate (BEFORE/AFTER hunks):

```tsx
// BEFORE
const result = await createRole({
  name: createName.trim(),
  displayName: createDisplayName.trim(),
  rules: [],
});
…
setCreateName("");
setCreateDisplayName("");
```

```tsx
// AFTER
const result = await createRole({
  name: createName.trim(),
  displayName: createDisplayName.trim(),
  description: createDescription.trim() || undefined,
  rules: [],
});
…
setCreateName("");
setCreateDisplayName("");
setCreateDescription("");
```

Change D — dialog body insertion between display-name and role-name blocks:
```tsx
<div className="flex flex-col gap-1.5">
  <Label htmlFor="create-description">
    Description{" "}
    <span className="text-muted-foreground text-xs font-normal">(optional)</span>
  </Label>
  <Textarea
    id="create-description"
    placeholder="What does this role do? Who should have it?"
    value={createDescription}
    onChange={(e) => setCreateDescription(e.target.value)}
    rows={2}
    maxLength={500}
  />
</div>
```

**Cluster B Task 3 confirmation — Clone NOT touched:** `awk '/Clone role dialog/,/<\/Dialog>/' role-list-client.tsx | grep -c create-description` → `0`. The `createRole` server-action signature in `src/app/(app)/settings/roles/actions.ts:56` already accepts `description?: string`; `git diff src/app/(app)/settings/roles/actions.ts` is empty. Empty Description submits as `undefined` (not `""`) so the server-side optional default stays clean.

### Task 4 — `feat(10-14): aria-labels on role picker + scope-editor button …` — commit `210dc4f`

**File:** `src/app/(app)/settings/users/[id]/role-assignment-client.tsx`
**Lines modified:** line 137 (`aria-label="Add scope"` on Button), line 146 (`aria-hidden="true"` on SlidersHorizontal), line 166 (`aria-label="Role"` on SelectTrigger).

BEFORE (Change A — role picker):
```tsx
<SelectTrigger className="w-[300px]">
```

AFTER:
```tsx
<SelectTrigger className="w-[300px]" aria-label="Role">
```

BEFORE (Change B — scope-edit icon button):
```tsx
<Button … title="Edit scopes for this role" onClick={…}>
  <SlidersHorizontal className="h-4 w-4" />
</Button>
```

AFTER:
```tsx
<Button … title="Edit scopes for this role" aria-label="Add scope" onClick={…}>
  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
</Button>
```

**Cluster B Task 4 honest-scope note:** Playwright's `selectOption()` targets native `<select>` elements. Radix `Select` is NOT a native select — it's a button/listbox composite. Adding `aria-label="Role"` makes `page.getByLabel(/role/i)` resolve cleanly to the SelectTrigger (locator binding is fixed) but `selectOption({ label: "ops-it" })` chained on top of it is still expected to fail at runtime because Radix does not implement the HTMLSelectElement options API.

**Expected failure modes for the resumed 10-13 (record for downstream operators):**

- `user-role-assignment.spec.ts:76` — likely STILL fails at `selectOption` on the Radix role picker. The failure mode is now deterministic (`Element is not a <select>` from Playwright) instead of `Element not found by accessible name`. This distinction matters: the fix is a Plan 10-15 hidden-native-select test affordance, NOT another aria-label change.
- `user-role-assignment.spec.ts:79` — `getByRole('button', { name: /add scope/i })` resolves cleanly when an assignment row exists, but the row only exists if step 76's assignment succeeded. If 76 fails, 79 never reaches its locator regardless of aria-label fix.
- `role-editor.spec.ts:32` (`admin creates a custom role…`) — still likely TIMES OUT at line 46-48 (`getByLabel(/action/i).selectOption("read")` / `getByLabel(/subject/i).selectOption("Location")`). The role editor uses chip buttons for actions and Radix Selects for subjects — same `selectOption`-on-non-native limitation. Description Textarea unblocks line 45 only; downstream is unchanged.

ManageScopesDialog and the Assign-role button were NOT touched: `git diff src/components/admin/manage-scopes-dialog.tsx` empty; the Assign-role button at lines 177-188 still carries Plan 10-11's `aria-label="Assign role"`.

## Preservation invariants (proof)

```
$ git diff --stat 866dfef..HEAD -- migrations/ src/lib/casl/ \
    'src/app/(app)/locations/actions.ts' src/components/locations/ \
    'src/components/admin/manage-scopes-dialog.tsx' \
    'src/app/(app)/settings/roles/actions.ts' \
    'src/app/(app)/settings/users/[id]/page.tsx'

(empty — zero lines changed in any protected path)
```

Commit 7497c12 (migration 0054 from gap-closure round 1) is preserved verbatim. No SQL, no seed, no CASL types, no server-action signature changed.

## Final verification gates

```
$ npx tsc --noEmit -p tsconfig.json
TypeScript: No errors found

$ ./node_modules/.bin/playwright test tests/access-control/can-component.spec.ts --list
Total: 3 tests in 1 file

$ ./node_modules/.bin/playwright test tests/access-control/edit-tier.spec.ts --list
Total: 1 test in 1 file

$ ./node_modules/.bin/playwright test tests/access-control/role-editor.spec.ts --list
Total: 2 tests in 1 file

$ ./node_modules/.bin/playwright test tests/access-control/user-role-assignment.spec.ts --list
Total: 2 tests in 1 file
```

8 tests across 4 spec files list cleanly post-edit.

## Resume reminder

Once this plan's 5 commits push to `gsd/phase-10-access-control-extended` and the Vercel preview auto-rebuilds against the latest HEAD, the operator runs:

```
/gsd-execute-phase 10 --gaps-only --wave 8
```

to re-pick `10-13-PLAN.md`. The Vercel git-branch alias survives across rebuilds (per CLAUDE.md `## Vercel preview env vars`) so `BETTER_AUTH_URL` does NOT need re-setting. The resumed 10-13 then drives the live Playwright run against the preview alias per CLAUDE.md `## Playwright specs against preview deploys` — `--list` passing in this plan is necessary but not sufficient evidence.

Acceptance gate for the resumed 10-13 stays at ≥6/8 PASS (target 8/8). Realistic estimate post-this-plan: 6/8 minimum (Cluster A removes the null.map flake on can-component + Plan 10-12's Can gate finally renders, Cluster B Task 2 unblocks edit-tier row/remove, Cluster B Task 3 unblocks role-editor description, Cluster B Task 4 makes user-role-assignment selectors deterministic-fail rather than flaky). 7/8 likely. 8/8 requires the Radix/selectOption deeper fix outside this plan's scope.

## Operational note — worktree-harness bug avoided this run

First dispatch attempt on 2026-05-11 was spawned with `isolation="worktree"` and the Claude Code harness created the worktree against a stale ref `af24d24` (a Phase-9.1-era squash-merge commit) instead of the current phase-branch HEAD `866dfef`. That worktree was missing 3 of the 4 target files (only `src/app/(app)/locations/[id]/page.tsx` existed) and the previous agent correctly halted without committing rather than fabricate edits against the wrong tree.

This re-dispatch ran SEQUENTIAL on the main working tree at the correct HEAD, bypassing the harness bug. Future operators should expect that single-commit phase branches (where the only commit on the branch is the plan-add) trigger this race more often than multi-commit branches, because the worktree-ref resolver appears to pick up some stale reflog entry. The mitigation is exactly what was used here: re-dispatch sequential, then return to worktree isolation once the branch has more than one commit on it.

## Self-Check

- File: `src/app/(app)/locations/[id]/page.tsx` — exists ✓; `rawLocation` rename + 3 backfill lines present.
- File: `src/app/(app)/settings/roles/[id]/role-editor-client.tsx` — exists ✓; `role="row"`, `aria-label={accessibleName}`, subject-first array order, `aria-label="Remove"` all present.
- File: `src/app/(app)/settings/roles/role-list-client.tsx` — exists ✓; Textarea import, createDescription state, `htmlFor="create-description"`, `id="create-description"`, `createDescription.trim() || undefined`, `setCreateDescription("")` all present.
- File: `src/app/(app)/settings/users/[id]/role-assignment-client.tsx` — exists ✓; `aria-label="Role"`, `aria-label="Add scope"`, plus Plan 10-11 invariants `role="region"`, `aria-label="Role assignment"`, `aria-label="Assign role"` all present.
- Commit `589c979` (Task 1) — present in `git log` ✓
- Commit `f0136df` (Task 2) — present in `git log` ✓
- Commit `99699be` (Task 3) — present in `git log` ✓
- Commit `210dc4f` (Task 4) — present in `git log` ✓
- `npx tsc --noEmit -p tsconfig.json` exits 0 ✓
- Protected paths diff stat is empty across migrations/, src/lib/casl/, locations/actions.ts, src/components/locations/, manage-scopes-dialog.tsx, settings/roles/actions.ts, settings/users/[id]/page.tsx ✓

## Self-Check: PASSED
