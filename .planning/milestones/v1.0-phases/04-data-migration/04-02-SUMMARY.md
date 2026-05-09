---
phase: 04-data-migration
plan: 02
subsystem: settings/data-import
tags: [ui, data-migration, import-wizard, monday-com]
dependency_graph:
  requires: [04-01]
  provides: [settings-data-import-page]
  affects: [settings-page]
tech_stack:
  added: []
  patterns: [6-state-machine, server-action-polling, base-ui-select-with-items]
key_files:
  created:
    - src/app/(app)/settings/data-import/page.tsx
    - src/app/(app)/settings/data-import/data-import-client.tsx
  modified:
    - src/app/(app)/settings/page.tsx
decisions:
  - "Select onValueChange receives string | null — handler must guard against null"
  - "vitest installed via npm install — was in package.json but not in node_modules, causing TS error"
  - "Cherry-picked 04-00/04-01 commits (9f1497c, 5e28595, bb6e3b1, aa62ff6) with -n flag into worktree branch"
metrics:
  duration: ~25min
  completed: 2026-04-01
  completed_plans: 1
  files: 3
---

# Phase 04 Plan 02: Data Import UI Summary

**One-liner:** 6-state import wizard at /settings/data-import — board connect, field mapping table with editable selects, dry-run preview with sample records and subitem data, full import with live progress bar and scrollable log, completion summary.

## What Was Built

### Settings Page Card
- `Database` lucide icon added
- Admin-gated card at `/settings/data-import` matching existing card pattern
- Copy per UI-SPEC: "Data Import" / "Import kiosk and location records from Monday.com."

### Data Import Page (server component)
- `requireRole("admin")` guard
- Pre-fills `defaultBoardId` from `MONDAY_BOARD_ID` env var
- Renders `DataImportClient`

### DataImportClient (client component — 6 states)

| State | Trigger | Key Elements |
|-------|---------|--------------|
| S1: connect | Page load | Board ID input, Connect Board button, empty state text |
| S2: fetching | Submit board ID | Skeleton loaders in mapping table, spinner |
| S3: mapping | Columns loaded | Editable mapping table (base-ui Select with `items` prop), Run Preview CTA |
| S4: preview | Run Preview | Summary stats bar, new stages alert, products/providers section, sample records table, Import Records CTA |
| S5: importing | Import confirmed | Progress bar (wk-azure fill), ScrollArea log feed, auto-scroll, 1500ms polling |
| S6: complete | Import done | Success/partial/zero copy variants, error badge, full log, "Run another import" link |

### Step Indicator
- Three-step horizontal stepper: Connect Board / Review Mapping / Preview & Import
- Active step: Azure text + border-bottom, number badge with Azure bg
- Completed steps: CheckIcon in Azure
- Future steps: mid-grey text

### Confirmation Dialog
- Destructive border styling
- Copy per UI-SPEC: "Import {N} records?" heading
- "This will create new kiosk and location records…" body
- Import Records + Cancel buttons

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing dependency files in worktree**
- **Found during:** Task 1 verification
- **Issue:** The worktree branch `worktree-agent-af7d741c` was based on the Phase 3 merge commit and lacked all Phase 4 files (schema, monday-client, field-mapper, server actions)
- **Fix:** Cherry-picked commits `9f1497c`, `5e28595`, `bb6e3b1`, `aa62ff6` with `-n` flag, then committed as `chore(04-02): cherry-pick 04-00/04-01 dependencies`
- **Commit:** c14f0b6

**2. [Rule 3 - Blocking] vitest module missing from node_modules**
- **Found during:** Build after cherry-pick
- **Issue:** `vitest` was listed in `package.json` but not installed — TypeScript picked up `vitest.config.ts` and failed to resolve `vitest/config`
- **Fix:** Ran `npm install` in main repo — vitest installed
- **No code change needed**

**3. [Rule 1 - Bug] Select onValueChange null type mismatch**
- **Found during:** TypeScript build
- **Issue:** base-ui `Select.Root.onValueChange` callback receives `string | null`, not `string`. Handler signature caused TS error
- **Fix:** Changed `handleMappingChange(columnId: string, newValue: string)` to accept `string | null` with early return guard
- **Files modified:** `data-import-client.tsx`

## Known Stubs

None — all 6 states are fully wired to server actions. No hardcoded empty values or placeholder text.

## Self-Check: PASSED

Files created:
- [x] src/app/(app)/settings/data-import/page.tsx — FOUND
- [x] src/app/(app)/settings/data-import/data-import-client.tsx — FOUND
- [x] src/app/(app)/settings/page.tsx (modified) — FOUND

Commits:
- [x] c14f0b6 — cherry-pick dependencies — FOUND
- [x] 6ba4b5f — feat(04-02): data import UI — FOUND

Build: `npx next build` — PASSED (route `/settings/data-import` listed in output)
