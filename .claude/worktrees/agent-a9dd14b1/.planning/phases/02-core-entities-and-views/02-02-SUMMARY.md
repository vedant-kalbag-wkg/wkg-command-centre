---
phase: 02-core-entities-and-views
plan: "02"
subsystem: locations
tags: [crud, inline-edit, s3-upload, rbac, jsonb, playwright, soft-delete]
dependency_graph:
  requires: ["02-01"]
  provides: ["location-crud", "contract-upload", "key-contacts-editor", "banking-rbac"]
  affects: ["02-03", "02-04", "02-05"]
tech_stack:
  added: []
  patterns:
    - "canAccessSensitiveFields computed in server component — rbac.ts imports next/headers (cannot run in client components)"
    - "canSeeSensitive boolean passed as prop to client component — avoids re-importing server-only rbac helpers"
    - "S3 presigned PUT upload via XHR for real progress tracking — fetch() does not support upload progress"
    - "Banking form uses save button (not inline edit) — structured JSONB with multiple fields requires explicit save"
    - "KeyContactsEditor debounces 500ms before calling updateKeyContacts — avoids saving on every keypress"
key_files:
  created:
    - src/app/(app)/locations/actions.ts
    - src/app/(app)/locations/[id]/page.tsx
    - src/app/(app)/locations/new/page.tsx
    - src/components/locations/location-detail-form.tsx
    - src/components/locations/location-kiosks-tab.tsx
    - src/components/locations/contract-documents.tsx
    - src/components/locations/key-contacts-editor.tsx
  modified:
    - src/app/(app)/locations/page.tsx
    - tests/locations/location-crud.spec.ts
    - tests/locations/location-rbac.spec.ts
    - tests/locations/location-kiosks-tab.spec.ts
    - tests/locations/location-contract.spec.ts
decisions:
  - "canAccessSensitiveFields moved to server components only — rbac.ts imports next/headers which cannot be used in client components"
  - "canSeeSensitive passed as boolean prop — server page computes it, client component receives result"
  - "Banking uses explicit save button not inline edit — JSONB with 4 fields needs coordinated save"
  - "S3 upload uses XHR not fetch — XHR supports upload progress events, fetch does not"
metrics:
  duration: "~28 minutes"
  completed_date: "2026-03-19"
  tasks_completed: 2
  tasks_total: 2
  files_created: 7
  files_modified: 4
---

# Phase 02 Plan 02: Location CRUD and Detail Pages Summary

Complete location CRUD with inline editing, S3 presigned URL contract uploads, key contacts JSONB editor, banking details with role-based redaction, and a Kiosks tab showing temporal assignments.

## What Was Built

**Task 1 — Location server actions** (`ba93524`)
- `src/app/(app)/locations/actions.ts` — 10 server actions: createLocation, getLocation, updateLocationField, archiveLocation, listLocations, getContractUploadUrl, saveContractDocument, removeContractDocument, updateKeyContacts, updateBankingDetails
- All mutations call `writeAuditLog()`; all mutations `requireRole("admin", "member")` except updateBankingDetails which requires `admin` only
- `getLocation` applies `redactSensitiveFields()` for viewer role (nullifies bankingDetails, contractValue, contractTerms, contractDocuments)
- `getContractUploadUrl` returns graceful error if `AWS_S3_BUCKET` env var not set — no crash
- Zod v4 validation on all inputs; follows kiosks/actions.ts pattern exactly

**Task 2 — Location UI components and route pages** (`05219d9`)
- `src/components/locations/location-detail-form.tsx` — Client component with Tabs (Details/Kiosks/Audit), 4 collapsible sections (Info/Key Contacts/Contract/Banking). Details tab uses InlineEditField for all scalar fields. Banking section shows restricted badge for viewers; contract value/terms show restricted badge for viewers. Archive dialog per UI-SPEC.
- `src/components/locations/key-contacts-editor.tsx` — JSONB array editor: add/remove contact rows with name, role, email, phone inputs; debounced 500ms auto-save via `updateKeyContacts`
- `src/components/locations/contract-documents.tsx` — File list with upload: get presigned URL → PUT via XHR with progress → save doc record. Client-side 10 MB check. Inline remove confirmation. Progress bar using base-ui Progress component.
- `src/components/locations/location-kiosks-tab.tsx` — Table of current and historical kiosk assignments: Kiosk ID (linked to /kiosks/[id]), Status (current/historical), Assigned Date, Unassigned Date, Reason
- `src/app/(app)/locations/[id]/page.tsx` — Server component fetching location + session, computing `canSeeSensitive`, passing to form
- `src/app/(app)/locations/new/page.tsx` — Create form page
- `src/app/(app)/locations/page.tsx` — Card grid list with kiosk counts and hotel group
- 12/14 Playwright E2E tests passing; 2 fixme (viewer RBAC tests pending db:seed viewer user)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Moved canAccessSensitiveFields to server components only**
- **Found during:** Task 2 — Next.js dev overlay showed Build Error: "You're importing a component that needs 'next/headers'. That only works in a Server Component"
- **Issue:** `location-detail-form.tsx` (client component) was importing `canAccessSensitiveFields` from `src/lib/rbac.ts`, which imports `next/headers` — a server-only API
- **Fix:** Removed the `canAccessSensitiveFields` import from the client component. Server page now computes `canSeeSensitive` boolean and passes it as a prop to the client component
- **Files modified:** src/components/locations/location-detail-form.tsx, src/app/(app)/locations/[id]/page.tsx, src/app/(app)/locations/new/page.tsx
- **Commit:** 05219d9 (included in Task 2 commit)

**2. [Rule 1 - Bug] Fixed strict mode violation in LOC-01 Playwright test**
- **Found during:** Task 2 Playwright run — `getByText('Details')` resolved to 2 elements (Details tab + "Save banking details" button text)
- **Fix:** Changed to `getByRole('tab', { name: 'Details' })` — targets only the tab element
- **Files modified:** tests/locations/location-crud.spec.ts

## Self-Check: PASSED

Files created:
- [x] src/app/(app)/locations/actions.ts
- [x] src/app/(app)/locations/[id]/page.tsx
- [x] src/app/(app)/locations/new/page.tsx
- [x] src/components/locations/location-detail-form.tsx
- [x] src/components/locations/location-kiosks-tab.tsx
- [x] src/components/locations/contract-documents.tsx
- [x] src/components/locations/key-contacts-editor.tsx

Commits:
- [x] ba93524 feat(02-02): add location server actions with audit logging and S3 upload
- [x] 05219d9 feat(02-02): location detail pages with inline editing, contract upload, key contacts, banking, kiosks tab

Tests: 12 passed, 2 skipped (fixme)
