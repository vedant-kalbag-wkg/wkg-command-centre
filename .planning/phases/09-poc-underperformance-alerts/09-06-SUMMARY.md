---
phase: "09"
plan: "06"
subsystem: kiosks/alert-silencing
tags: [server-actions, rbac, audit-log, admin-ui, integration-tests, playwright]
dependency_graph:
  requires: ["09-01"]
  provides: ["kiosk-silence-ui", "silence-server-actions", "silence-audit-log"]
  affects: ["kiosks/[id]/page.tsx", "lib/audit.ts"]
tech_stack:
  added: []
  patterns: [server-actions, zod-validation, drizzle-update, sonner-toasts, useTransition, testcontainers-vitest]
key_files:
  created:
    - src/app/(app)/kiosks/[id]/silence-actions.ts
    - src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx
    - tests/kiosks/silence-toggle.integration.test.ts
    - tests/kiosks/silence.spec.ts
  modified:
    - src/lib/audit.ts
    - src/app/(app)/kiosks/[id]/page.tsx
    - src/app/(app)/kiosks/actions.ts
decisions:
  - "Admin panel rendered server-side (RSC gate + client component) rather than full RSC to allow useTransition pending state"
  - "silenceKiosk / unsilenceKiosk use try/catch around requireRole to return ok:false instead of throwing — consistent ActionResult shape"
  - "Test UUIDs must use RFC 4122 version 1-8 format (Zod v4 rejects version-0 UUIDs)"
  - "writeAuditLog accepts optional db param — server actions pass implicit default; no test stub needed for audit"
metrics:
  duration: "~35 minutes (across two sessions)"
  completed_date: "2026-05-09"
  tasks_completed: 5
  files_created: 4
  files_modified: 3
---

# Phase 09 Plan 06: Kiosk Alert-Silencing Admin UI Summary

Admin-only kiosk silencing UI: server actions with Zod + RBAC + audit log, client panel with WeKnow brand colours, integration tests (6 cases, Testcontainers), and authored Playwright E2E spec.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Extend audit.ts action union | `da7e3b2` | src/lib/audit.ts |
| 2 | silence-actions.ts server actions | `b2a7ca3` | src/app/(app)/kiosks/[id]/silence-actions.ts |
| 3 | KioskAdminPanel + page.tsx wiring | `7eeac19` | kiosk-admin-panel.tsx, page.tsx, actions.ts |
| 4 | Integration tests (6 cases, all pass) | `088e375` | tests/kiosks/silence-toggle.integration.test.ts |
| 5 | Playwright spec authored (not run) | `b08f6f6` | tests/kiosks/silence.spec.ts |

## What Was Built

**`silence-actions.ts`** — Two `"use server"` actions:
- `silenceKiosk(kioskId, reason)`: validates UUID + reason (min 3, max 500 chars), updates `alertSilencedAt` + `alertSilencedReason`, writes `silence_alerts` audit log entry, revalidates path.
- `unsilenceKiosk(kioskId, reason?)`: clears both fields, writes `unsilence_alerts` audit entry, revalidates path.
- Both return `{ ok: true } | { ok: false; error: string }` — auth failures, validation errors, and not-found all flow through the same shape.
- Defence-in-depth RBAC: page RSC gate (`session.user.role === "admin"`) + server-action-level `requireRole("admin")`.

**`kiosk-admin-panel.tsx`** — Client component:
- Unsilenced state: textarea (reason), "Silence alerts" button disabled if `reason.trim().length < 3`, variant=destructive.
- Silenced state: Azure info banner (`#00A6D3` border, `#CCEDF6` bg), current reason shown, "Unsilence alerts" button.
- `useTransition` for pending state, `sonner` toasts for success/error feedback.

**`page.tsx`** — Updated to fetch `session` in parallel `Promise.all`, conditionally renders `<KioskAdminPanel>` for admin users only.

**Integration tests** — 6 vitest cases using Testcontainers Postgres:
1. silenceKiosk sets alertSilencedAt + reason in DB
2. unsilenceKiosk clears both fields
3. silenceKiosk rejects reason < 3 chars
4. silenceKiosk rejects invalid UUID
5. silenceKiosk returns error for non-existent kiosk
6. unsilenceKiosk accepts optional reason

**Playwright spec** (`silence.spec.ts`) — 5 E2E scenarios authored:
- Admin sees the panel, silence button disabled when empty, enabled at 3+ chars, full silence/unsilence happy path with toast assertions, silenced-state panel assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing fields on KioskWithRelations type**
- **Found during:** Task 3
- **Issue:** `KioskWithRelations` in `actions.ts` had no `alertSilencedAt` / `alertSilencedReason` fields. TypeScript error when accessing `kiosk.alertSilencedAt` in `page.tsx`.
- **Fix:** Added `alertSilencedAt: Date | null;` and `alertSilencedReason: string | null;` to the manually-typed interface (the DB columns were added in plan 09-01 but the type was not updated).
- **Files modified:** src/app/(app)/kiosks/actions.ts
- **Commit:** `7eeac19`

**2. [Rule 1 - Bug] vi.mock hoisting issue — ADMIN_SESSION constant**
- **Found during:** Task 4 (first test run)
- **Issue:** `vi.mock` factories are hoisted before variable declarations; `ADMIN_SESSION` constant was `undefined` at mock time.
- **Fix:** Inlined the session object literal directly inside the factory functions.
- **Files modified:** tests/kiosks/silence-toggle.integration.test.ts
- **Commit:** `088e375`

**3. [Rule 1 - Bug] Invalid UUID format for test fixtures (Zod v4)**
- **Found during:** Task 4 (second test run — 5 failures)
- **Issue:** `f1000000-0000-0000-0000-000000000001` uses version nibble `0` which Zod v4 rejects (requires 1-8). Caused Zod uuid() to return "Invalid UUID" for all tests that hit the server action.
- **Fix:** Changed test UUIDs to `f1000000-0000-4000-8000-000000000001` and `99999999-0000-4000-8000-000000000099` (version 4, variant 8).
- **Files modified:** tests/kiosks/silence-toggle.integration.test.ts
- **Commit:** `088e375`

## Known Stubs

None. The admin panel wires directly to server actions which write to the DB.

## Threat Flags

No new network endpoints or auth paths introduced. The server actions are guarded by `requireRole("admin")` at the action level in addition to the RSC page gate.

## Self-Check: PASSED

- src/app/(app)/kiosks/[id]/silence-actions.ts: FOUND
- src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx: FOUND
- tests/kiosks/silence-toggle.integration.test.ts: FOUND
- tests/kiosks/silence.spec.ts: FOUND
- Commits da7e3b2 b2a7ca3 7eeac19 088e375 b08f6f6: all present in git log
