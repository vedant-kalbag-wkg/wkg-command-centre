# Kiosk Management UI Audit

Verification scope: kiosks + locations admin UI; settings pages; user-scope mgmt; cascade behavior; analytics integration. All claims in the previous explorer's draft were re-verified against current code (commit `c2a5cfe`, branch `main`).

---

## Verified gaps (P0)

### P0-1. `locations.locationType` cannot be edited from the location detail/list — analytics filter relies on it

- **Schema**: `src/db/schema.ts:195` — `locationType: text("location_type")`. CHECK constraint enforces `'hotel'|'retail_desk'|'online'|'airport'|'hex_kiosk'`. NULL means "not yet categorised" (per code comment).
- **Where it should live**: `src/components/locations/location-detail-form.tsx` (`ExistingLocationForm` and `NewLocationForm`); `src/components/locations/location-columns.tsx` as an editable column.
- **Where it actually lives**: ONLY editable via `/settings/outlet-types` (`src/app/(app)/settings/outlet-types/actions.ts:37` `setLocationTypeAction` and bulk variant). The admin-only "outlet types" page is the sole entry point.
- **Why it matters**: `src/lib/analytics/queries/shared.ts:97-107` — `buildDimensionFilters` uses `locationType` as the predicate for the analytics "Location Type" filter. A miscategorised location silently distorts portfolio KPIs (sales/rev/AOV by location type, hotel-vs-airport tiering, etc.). Worse, NULL `locationType` rows are NOT excluded — they fall outside every filter bucket, meaning filtered totals do not equal the unfiltered total. There is no UI signal at the location detail level that the field is unset; an admin viewing a single hotel cannot fix the classification without leaving the page and going through the unmapped-outlets flow.
- **Severity**: **P0** — silent analytics distortion, fix requires a workflow the typical operator won't discover.
- **Fix**: surface `locationType` as a select in `ExistingLocationForm` (Info section) and as an editable column in `location-columns.tsx`. Add it to `EDITABLE_LOCATION_FIELDS` in `actions.ts:209`. Reuse `setLocationTypeForActor` to keep `revalidateTag('analytics')` semantics.

### P0-2. Region picker on location create is NOT scoped to user's allowed regions

- **Schema**: `src/db/schema.ts:167-169` — `primaryRegionId` is NOT NULL FK to `regions.id`. The `(primaryRegionId, outletCode)` unique index is the data-quality boundary.
- **Code path**: `src/components/locations/location-detail-form.tsx:152` calls `listRegionOptions()` → `src/app/(app)/locations/actions.ts:642-653`:
  ```
  await requireRole("admin", "member", "viewer");
  const rows = await db.select(...).from(regions).orderBy(regions.name);
  return rows;
  ```
  Gates on role only — does NOT consult `userScopes` for `dimensionType='region'`.
- **Why it matters**: a UK-only `member` user with `userScopes` restricted to `region:UK` can create a location and assign `primaryRegionId='AU'`. That location subsequently appears in their portfolio (since they created it) but its sales records will be region-scoped to AU and they may or may not be allowed to view them. Worse, an external→internal upgrade path (member who used to be UK-scoped) is invisible to the audit log because no scope check happens.
- **Severity**: **P0** — cross-region data write that bypasses the dimension-scoping invariant. Mitigated only because external users cannot reach this page (gated to `/portal/coming-soon` per `src/proxy.ts:30-37`).
- **Fix**: in `listRegionOptions`, filter regions by intersection with caller's `userScopes` rows where `dimensionType='region'`. Admins keep full list. Apply same filter to the outlet-types bulk-region reassign action.

### P0-3. `EDITABLE_LOCATION_FIELDS` includes `"region"` but no `region` column exists on `locations`

- **Code**: `src/app/(app)/locations/actions.ts:228` lists `"region"` in the inline-editable allowlist.
- **Schema**: comment at `src/db/schema.ts:186` confirms the free-text `region` column was DROPPED in migration 0018; the schema has no `region` field on `locations`. (Migration 0018 actually adds `kioskConfigGroupId`; the drop happened in `0022_restructure_salesrecords_region_scoped.sql`.)
- **Behaviour today**: a malicious or buggy client that POSTs `field='region'` to `updateLocationField` hits the validator's `parsed.success === true` branch (region is whitelisted), then `db.update(locations).set({ region: ... })` — Drizzle will raise a "column does not exist" SQL error. Surface symptom: a 500 toast saying "Failed to update field"; no data corruption, but a footgun and a code smell.
- **Severity**: **P0** for hygiene (allowlist references nonexistent column = bug), but **no production data risk**.
- **Fix**: remove `"region"` from `EDITABLE_LOCATION_FIELDS` (`actions.ts:209-239`). Add `primaryRegionId` instead (see P1-1).

---

## Verified gaps (P1)

### P1-1. `locations.primaryRegionId` cannot be re-assigned from the location detail page

- Confirmed: `src/components/locations/location-detail-form.tsx` (`ExistingLocationForm`, lines 423-497 Info section) does NOT render `primaryRegionId`. Only the create form (`NewLocationForm`, line 213) shows it.
- The only path to fix region post-create is `/settings/outlet-types` → `bulkSetPrimaryRegionAction` (`src/app/(app)/settings/outlet-types/actions.ts:90`), which is a bulk admin tool, NOT a per-location workflow.
- **Operational consequence**: a hotel imported into the wrong region (e.g. Live Estate fallback puts a hotel into UK when it belongs to AU) requires an admin to find it in the unmapped-outlets list, which only shows outlets where `locationType IS NULL`. Once classified, the location is no longer surfaced for region correction.
- **Severity**: **P1** — recovery path exists but is non-obvious and assumes the admin knows the outlet-types tool also covers region.

### P1-2. `locations.outletCode` not editable post-create

- `EDITABLE_LOCATION_FIELDS` (`actions.ts:218`) DOES include `"outletCode"`. The detail form (`location-detail-form.tsx:423-497`) does NOT render it.
- The create form (`NewLocationForm:205`) shows it as required, but once saved it disappears from the UI. The list page (`location-columns.tsx`) also does not include outletCode.
- **Operational consequence**: outlet code is the join key from sales CSVs to locations (`(primaryRegionId, outletCode)` is the natural key per `src/db/schema.ts:217-220`). An outlet code typo at create time can silently break sales attribution; the only recovery is direct DB edit or the duplicates merge flow.
- **Severity**: **P1** — backend supports editing, UI doesn't expose it.

### P1-3. List-only fields on `locations` (editable in list, not in detail form)

| Field | List | Detail | Severity |
|---|---|---|---|
| `customerCode` | `location-columns.tsx:248` editable | absent from detail form | P1 |
| `maintenanceFee` | `location-columns.tsx:226` editable | absent from detail form | P1 |
| `locationGroup` | `location-columns.tsx:281` editable | absent from detail form | P1 |
| `status` | `location-columns.tsx:207` editable (Lead/Prospect/Active/Inactive/Churned) | absent from detail form | P1 |
| `internalPocId` | `location-columns.tsx:298` editable user-picker | absent from detail form | P1 |
| `keyContactName` | `location-columns.tsx:265` editable | only via Key Contacts section JSONB editor | P1 |

Confirmed via `grep -n` against `location-detail-form.tsx`. Each field is in `EDITABLE_LOCATION_FIELDS` (allowed by the server) but the detail form does not surface them.

- **Operational consequence**: an admin opening a single location to fix its status finds no `Status` field — must close the detail page, find the row in the list, click a cell and edit. Especially painful for `internalPocId` (assignee) and `status` since these are core lifecycle fields.
- **Severity**: **P1** for each.

### P1-4. Detail-only fields on `locations` (editable in detail, not in list)

Confirmed: `latitude`, `longitude`, `contractStartDate`, `contractEndDate`, `notes` are in `location-detail-form.tsx` but absent from `location-columns.tsx`. (`latitude`/`longitude` not even in the column registry.)

- **Operational consequence**: there is no way to bulk-fix coordinates for, say, a batch of newly-imported hotels — must open each hotel one by one. `notes` not being a list column means an admin cannot scan recent notes from the list view.
- **Severity**: **P1** for `notes` (admin workflow), **P2** for lat/long (rare edit), **P2** for contract dates (sensitive, RBAC-gated).

### P1-5. Kiosks list is missing `deploymentPhaseTags`, `freeTrialEndDate`, `notes`

Confirmed via `grep -n` on `kiosk-columns.tsx`. All three are editable in the kiosk detail form (`kiosk-detail-form.tsx:494-507, 585-600, 601-608`) but absent from the list.

- **Operational consequence**:
  - `deploymentPhaseTags` is the field used for cohort grouping during phased rollouts; not having it in the list view forces detail-page-by-detail-page inspection during a rollout sweep.
  - `freeTrialEndDate` is the trigger date for billing transitions; an admin doing a daily "what trials end this week" check has to filter then click into each row.
  - `notes` not in list view means admin context is invisible at-a-glance.
- **Severity**: **P1** — operational pain, no data risk.

### P1-6. Archived kiosks/locations are unreachable from the UI

- `listKiosks` (`actions.ts:556`) hard-codes `WHERE archivedAt IS NULL`.
- `listLocations` (`actions.ts:385`) same.
- `location-columns.tsx:330-340` defines an `archivedAt` column hidden by default via `locationDefaultColumnVisibility`; same for kiosks (`kioskDefaultColumnVisibility:320`). But the column would only display dates if the rows were returned at all — they aren't. The column is dead code.
- **Operational consequence**: once archived, a location/kiosk is effectively gone — no restore button, no "show archived" toggle. The audit log can show the archive event but not surface the row for unarchive.
- **Severity**: **P1** — recovery requires direct DB edit or shell access.

### P1-7. Archive does NOT cascade — kioskAssignments stay open

- `archiveKiosk` (`src/app/(app)/kiosks/actions.ts:356-387`): only sets `archivedAt` on `kiosks`. Does NOT close any open `kioskAssignments` row (`unassignedAt` stays NULL).
- `archiveLocation` (`src/app/(app)/locations/actions.ts:327-358`): only sets `archivedAt` on `locations`. Does NOT close `kioskAssignments`, does NOT cascade `locationProducts`, does NOT touch any membership join table (`locationHotelGroupMemberships`, `locationRegionMemberships`, `locationGroupMemberships`).
- **Consequence on analytics**:
  - `getActiveLocationIds` (`src/lib/analytics/active-locations.ts:29-46`) selects `FROM ${locations}` with **no** `archivedAt IS NULL` filter. So archived locations still appear in every analytics query as "active outlets" until they're added to `outletExclusions`. This is a silent bug.
  - `kioskLiveDateSubquery` (`src/lib/analytics/queries/shared.ts:117`) computes maturity from `MIN(kioskAssignments.assignedAt)`. If a kiosk is archived without closing its assignment, the location's `currentAssignment` remains set — the kiosk count shown in the locations list (`actions.ts:407` `kioskCount: countMap.get(r.id) ?? 0`) over-counts.
- **Severity**: **P1** — silently inflates "active hotels" / kiosk counts in analytics. Note: P0 for analytics correctness if you weight that — I scored P1 because the practical inflation is small and outletExclusions can be used as an escape hatch.

### P1-8. `locations.freeTrialEndDate` is not used to gate analytics

- Schema: `src/db/schema.ts:182` defines the field. `EDITABLE_LOCATION_FIELDS` includes it. UI: nowhere — the detail form does not render it (only `kiosks.freeTrialEndDate` shows up, on the kiosk side).
- Analytics: `grep -rn "freeTrialEndDate\|free_trial_end_date" src/lib/analytics/` returns zero hits. There is no exclusion of trial-period revenue from KPIs.
- **Operational consequence**: trial revenue (free product, no fee taken) is mixed into "Real customer revenue" without any gating. Any tier the admin builds on top will be inflated by trials. Free-trial-flagged kiosks (`kiosks.freeTrialStatus=true` / endDate set) have the same problem.
- **Severity**: **P1** — analytics distortion. The data exists in the schema; the analytics queries simply don't reference it.

### P1-9. `locations.bankingDetails` JSONB has no field-level audit trail

- `updateBankingDetails` (referenced from `location-detail-form.tsx:365` but not shown above) writes the whole blob; no per-field old/new values land in `auditLogs`.
- Compare against `updateLocationField` (`actions.ts:248-325`) which records `field` + `oldValue` + `newValue`.
- **Operational consequence**: bank account changes — the highest-risk PII edit on the system — have the worst audit granularity.
- **Severity**: **P1** for compliance.

---

## Verified gaps (P2)

### P2-1. `cmsConfigStatus` is `text` in schema but used as boolean in UI

- Schema: `src/db/schema.ts:123` — `cmsConfigStatus: text("cms_config_status")`.
- Server: `kiosks/actions.ts:319-321` — `if cmsConfigStatus → 'configured' : 'not_configured'`.
- UI inline edit: switch component.
- Why it's a gap: any third-party consumer of the column (an analytics query, a CSV export) sees text values that look like an enum but aren't constrained at the DB layer. Future code could write `"yes"` / `"true"` / `"Configured"` and create a slow-burning data-quality bug.
- **Severity**: **P2** — cleanup; convert to boolean column or add a CHECK constraint.

### P2-2. `locations.numRooms` duplicates `roomCount`

- Schema: line 152 `roomCount` and line 205 `numRooms`. Both are `integer`. Both are in `EDITABLE_LOCATION_FIELDS`.
- UI: `roomCount` is in the list (`location-columns.tsx:140-155`) and detail form. `numRooms` is in neither, BUT it's still in the editable allowlist meaning a stale UI cache or a typed POST could write to it.
- **Severity**: **P2** — schema cleanup. Drop `numRooms` (data-dashboard legacy) or alias it to `roomCount`.

### P2-3. `locations.hotelAddress` duplicates `address`

- Schema: line 148 `address: text("address")` and line 206 `hotelAddress: text("hotel_address")`. The detail form uses `address`. `hotelAddress` is in `EDITABLE_LOCATION_FIELDS` but no UI surfaces it.
- **Severity**: **P2**.

### P2-4. `locations.hotelGroup` (free-text) coexists with `operatingGroupId` (FK) AND with `locationHotelGroupMemberships`

- `hotelGroup` (line 170, free-text) is what the detail form edits. `operatingGroupId` (line 171, FK to `hotelGroups`) is editable nowhere. `locationHotelGroupMemberships` (line 526) is the canonical analytics join.
- Schema comment at line 466-472 acknowledges the duplication: "free-text columns coexist with these dimension tables — the tables are used for scoped joins while the free-text columns remain for legacy input".
- The portfolio analytics queries use `locationHotelGroupMemberships` (`src/lib/analytics/queries/shared.ts:71-77`); editing `hotelGroup` in the detail form has zero effect on portfolio scoping.
- **Severity**: **P2** — the editable field is a phantom for analytics. Either wire it up to membership rows or stop showing it as the user-facing "Hotel Group".

### P2-5. Portal lockdown enforcement check is correct

- Verified: `src/proxy.ts:30-37` correctly redirects external users to `/portal/coming-soon` for any path not in `shouldGateExternalUser`'s allowlist (`src/lib/auth/gating.ts`).
- The lockdown is a static feature flag (path-based), NOT a per-user `isLocked` column. No DB changes needed.
- **Risk surface**: the gating is per-path. If a new admin route is added that doesn't start with `/portal/`, external users are blocked — fine. But if a new public page is added under `/portal/` (intended only for staff demos), external users would access it. There is no positive allow-list for portal subpaths.
- **Severity**: **P2** — current state is safe; future-proofing is the gap. Add a portal-route allowlist pattern check in `gating.ts`.

### P2-6. Kiosk archive cascade

- `archiveKiosk` (kiosks/actions.ts:356) does not close the open `kioskAssignments` row.
- Consequence: the location detail page still shows the archived kiosk as "currently assigned" via `assignedKiosks` (locations/actions.ts:171-185 — no archivedAt filter on the `kiosks` join). Same with the active-kiosk-count fragment in analytics (`shared.ts:207-214`).
- **Severity**: **P2** — visual inconsistency for the archived count; not catastrophic since the archived kiosk is hidden from the list, but the number disagrees with reality.

### P2-7. `installations.region` is free-text and orphaned from the regions table

- Schema: `src/db/schema.ts:296` — `region: text("region")` on `installations`. Not joined to `regions.id` anywhere.
- The kiosk-mgmt UI does not surface `installations` directly in this audit's scope, but the data integrity of region rollups is affected.
- **Severity**: **P2** — installations is a separate UI; flagging because it's the same shape of bug.

---

## Verified gaps (P3 — cleanup / unused)

### P3-1. Genuinely unused / legacy fields on `locations`

| Field | Schema line | Used in UI? | Used in analytics? | Notes |
|---|---|---|---|---|
| `liveDate` | 207 | No (in editable list, no UI) | No | data-dashboard legacy |
| `launchPhase` | 208 | No (in editable list, no UI) | No | data-dashboard legacy |
| `keyContactEmail` | 210 | No (in editable list, no UI; `KeyContactsEditor` writes the JSONB field instead) | No | denormalised field unused |
| `financeContact` | 211 | No (in editable list, no UI) | No | data-dashboard legacy |
| `hardwareAssets` | 183 | No (in editable list, no UI) | No | type `text` (free-form), no real consumer |

**Severity**: **P3** — schema cleanup. Either drop these columns in a future migration or build the UI for them; squatting on them in `EDITABLE_LOCATION_FIELDS` is a footgun.

### P3-2. `userViews` table is admin-private

- Schema: `src/db/schema.ts:267-286`. There is no UI to list/manage saved views across users — they're per-user only. Not a gap, just confirming.
- **Severity**: N/A (intentional design).

---

## Refuted claims

### REFUTED-1. "Kiosk archive feature not implemented"

The explorer claimed: `kiosks.archivedAt: archive feature not implemented for kiosks (no archive button)`.

**Refuted by**:
- `src/components/kiosks/kiosk-detail-actions.tsx` — full archive flow with Dialog confirmation.
- `src/app/(app)/kiosks/[id]/page.tsx:61` — `KioskDetailActions` is rendered as part of the page header.
- `src/app/(app)/kiosks/actions.ts:356-387` — `archiveKiosk` server action with audit log.
- Bulk archive: `bulkArchiveKiosks` referenced in `kiosks/bulk-actions.ts` and used by `kiosk-table.tsx`.

The archive feature IS implemented. The actual gap (P1-6) is that archived kiosks are unreachable for restore.

### REFUTED-2. "kiosks.kioskConfigGroupId managed by dedicated flows but no UI found"

Partially correct. There IS `/kiosk-config-groups` (`src/app/(app)/kiosk-config-groups/`) for managing the groups themselves. What's missing is the per-kiosk assignment UI: the kiosk detail form does NOT let you set which group a kiosk belongs to, even though `EDITABLE_KIOSK_FIELDS` (`actions.ts:277`) explicitly includes `"kioskConfigGroupId"`. The server is ready; the UI just never wired up the field.

**Severity adjustment**: P1 (operational pain — the field is a no-op for end users despite backend support).

### REFUTED-3. "kiosks.deploymentPhaseTags missing from list" — confirmed and same severity.

The explorer was correct.

### REFUTED-4. "kiosks.freeTrialEndDate editable in detail (conditional on freeTrialStatus)"

Confirmed at `kiosk-detail-form.tsx:585` (`{kiosk.freeTrialStatus && (...)}`). Note that this conditional renders means an admin who needs to PRE-SET an end-date for a future-trial kiosk has to first toggle `freeTrialStatus=true`, save, then the end-date row appears. Two-step workflow when one would do.

**Severity**: P2 — minor friction.

---

## Additional gaps found

### NEW-1. Audit log treats banking-details edits as a single opaque event

- `updateBankingDetails` (referenced from `actions.ts:362-372` in location-detail-form.tsx and the corresponding server action) writes the whole JSONB blob in one shot. The audit entry doesn't capture which subfield (account name vs sort code) changed.
- Field-level inline edits via `updateLocationField` capture `field`/`oldValue`/`newValue` cleanly (lines 308-318 of `actions.ts`); banking does not.
- **Severity**: **P1** — see P1-9.

### NEW-2. Kiosk detail form's "Audit" tab uses `entityType="kiosk"`; entityId mappings agree

- Verified at `src/components/kiosks/kiosk-detail-form.tsx:647` — `<AuditTimeline entityType="kiosk" entityId={kiosk.id} />`. Server gating in `audit-timeline.tsx` filters on `auditLogs.entityType` + `auditLogs.entityId`. Works correctly.
- **Note**: kiosk audit timeline does NOT show `kioskAssignments` events (assign/reassign) inline — they are written via `writeAuditLog` with `entityType="kiosk"` (good) but the `field="venue"` row only renders for explicit `assign` / `unassign` action types, not for `reassign`. Tested via `audit-timeline.tsx:111-130` switch case. Reassignments DO render correctly because they reuse `action="assign"` with both `oldValue` + `newValue` set (`actions.ts:516-520`). OK, no real gap.

### NEW-3. No tenant_id / org_id field on any table

- `grep -rn "tenant\|tenantId\|orgId\|organizationId" src/db/schema.ts` returned zero hits. The system is single-tenant by design — multi-tenancy is enforced via `userScopes` dimension scoping, not row-level tenant isolation.
- **Cross-tenant risk**: low. The risk vector is the region picker on location create (P0-2) — a non-admin can write a row outside their region scope.
- **Severity**: N/A (architectural intent).

### NEW-4. External user invariant ("must have ≥1 scope") is enforced server-side but not in the UI

- Server: `src/app/(app)/settings/users/[id]/scopes-internal.ts:165-175` — `_removeScopeForActor` correctly prevents removing the last scope from an `external` user.
- UI: there is a "Remove scope" button per row, no client-side disable when the user has only 1 scope. Removing the last scope returns the error toast — the action fails gracefully.
- **Severity**: **P3** — UX polish: disable the remove button when scope count = 1 with a tooltip.

### NEW-5. `outletExclusions` IS wired up to analytics (refutes possible explorer concern)

- `src/lib/analytics/active-locations.ts:29-46` and `src/lib/analytics/queries/shared.ts:15-30` both reference `outletExclusions`. The exclusion patterns (`exact` and `regex`) are applied via the `getActiveLocationIds` cache. Test patterns can be previewed via `testPattern` in `outlet-exclusions/actions.ts:131-168`.

### NEW-6. `businessEvents.startDate` accepts ANY date, including the future — intentional

- `src/app/(app)/settings/business-events/actions.ts:236-277` — `createEvent` does not validate `startDate` against today. This is correct: campaign-style events (e.g. "Summer Promo 2026") are created in advance.
- The event annotation overlay on Portfolio Daily Trends will display them when they fall in the chart window.
- **Severity**: N/A (working as intended).

### NEW-7. Pipeline-stage delete with kiosks reassigns correctly

- `src/app/(app)/settings/pipeline-stages/actions.ts:72-111` — `deleteStage(stageId, reassignToStageId?)` blocks delete when `kioskCount > 0 && !reassignToStageId`, and reassigns when both are passed. Last-stage protection at line 81. Solid.
- **Severity**: N/A.

### NEW-8. `archivedAt` column is exposed in column registry but data path makes it dead code

- `location-columns.tsx:330-340` defines an `archivedAt` column. `kiosk-columns.tsx:294-302` exposes `createdAt` similar pattern. But since `listLocations` and `listKiosks` filter `WHERE archivedAt IS NULL`, the column always renders `—`.
- **Severity**: **P3** — confusing dead code; either remove the column or change the query.

### NEW-9. Audit trail for `userScopes` add/remove uses `entityType="user"` not `"user_scope"`

- `scopes-internal.ts:114-126, 178-191`. The audit timeline filters on entityType=`kiosk|location` only (`audit-timeline.tsx:13` type signature). Searching for "scope changes on user X" works only via the global audit log page.
- **Severity**: **P3** — works, but no per-user timeline view of scope history.

---

## Schema-level findings

These are issues with the schema design itself, not the UI:

1. **Duplicate columns** — `roomCount` vs `numRooms`, `address` vs `hotelAddress`, `hotelGroup` (text) vs `operatingGroupId` (FK) vs `locationHotelGroupMemberships` (join). All three live alongside each other; the analytics queries use ONLY the membership tables, the UI edits ONLY the free-text version. (P2)

2. **Orphaned editable fields** — `EDITABLE_LOCATION_FIELDS` includes `region`, `numRooms`, `hotelAddress`, `liveDate`, `launchPhase`, `keyContactEmail`, `financeContact`, `hardwareAssets` — none of which the UI actually renders. The "region" entry references a column that doesn't exist on `locations`. (P0 for `region`, P3 for the rest)

3. **`cmsConfigStatus: text`** with no DB-level constraint, used as boolean in UI. Either tighten to `boolean` or add a `CHECK (cms_config_status IN ('configured','not_configured'))`. (P2)

4. **`installations.region: text`** is the same anti-pattern as the dropped `locations.region`. Should be `regionId: uuid REFERENCES regions(id)` for consistency. (P2)

5. **No `archivedAt` index on `locations` or `kiosks`** — every list query filters `WHERE archivedAt IS NULL`. Drizzle schema definitions don't show one. Verify via `\d kiosks` on a real DB; if missing, add `CREATE INDEX ... ON kiosks(archived_at) WHERE archived_at IS NULL` (partial index). (P3 — perf nudge)

6. **`businessEvents.scopeValue: text`** with `scopeType` enum is loose — there's no FK from `scopeValue` to `regions`/`hotelGroups`/`locations` tables when `scopeType` is one of those. A renamed region would orphan its events. (P2)

7. **Single-tenant data model** — no `tenant_id` anywhere. Multi-tenancy is via `userScopes` only. Plug-fitting a second customer would require either soft-tenancy (`tenant_id` on every fact + dimension table, ~20 tables) or stand up a separate DB. Worth flagging in any tenancy roadmap. (informational)

---

## Recommendations (prioritized)

### P0 — fix before next admin-onboarding

1. **Surface `locationType` in location detail form + list column.** Reuse `setLocationTypeForActor` so cache revalidation stays correct. Eliminates silent analytics distortion. *(P0-1)*
2. **Region-scope `listRegionOptions` to caller's `userScopes`.** Members must not be able to assign locations to regions outside their scope. *(P0-2)*
3. **Remove `"region"` from `EDITABLE_LOCATION_FIELDS`.** Replace with `primaryRegionId`. *(P0-3)*

### P1 — next sprint

4. **Add `primaryRegionId`, `outletCode`, `customerCode`, `maintenanceFee`, `locationGroup`, `status`, `internalPocId` to the location detail form.** Keep server-side allowlist in sync. *(P1-1, P1-2, P1-3)*
5. **Add `kioskConfigGroupId` to the kiosk detail form** (server already supports it). *(REFUTED-2)*
6. **Add `deploymentPhaseTags`, `freeTrialEndDate`, `notes` to the kiosk list view.** *(P1-5)*
7. **Filter archived locations in `getActiveLocationIds`.** Single-line fix that closes the analytics inflation gap. *(P1-7)*
8. **Cascade kiosk-archive to close `kioskAssignments`.** Wrap in a transaction. *(P1-7)*
9. **Build a "Show archived" toggle + restore action for both kiosks and locations.** Wire to the `archivedAt` column that's already in the schema. *(P1-6)*
10. **Add field-level audit on banking-details edits.** Diff the JSONB before/after, write one audit row per changed subfield. *(P1-9)*
11. **Use `freeTrialEndDate` in revenue-mode analytics**: either exclude trial rows or add a "Trial vs Real" filter. *(P1-8)*

### P2 — quality / hygiene

12. **Tighten `cmsConfigStatus`** to `boolean` or add CHECK constraint. *(P2-1)*
13. **Normalise duplicate columns** — drop `numRooms`, `hotelAddress`; convert `installations.region` to `regionId`. *(P2-2, P2-3, P2-7)*
14. **Decide on the `hotelGroup` (text) vs `operatingGroupId` (FK) split.** Either route the inline edit to write a membership row, or hide the free-text field. *(P2-4)*
15. **Make `freeTrialEndDate` accessible without first toggling `freeTrialStatus`** — render it whenever the field is set OR whenever `freeTrialStatus=true`. *(REFUTED-4)*

### P3 — cleanup

16. **Remove orphaned editable fields** (`liveDate`, `launchPhase`, `keyContactEmail`, `financeContact`, `hardwareAssets`) from the schema (after confirming no external consumers) or build the UI for them. *(P3-1)*
17. **Disable the "Remove scope" button** for external users at scope_count=1 with a tooltip. *(NEW-4)*
18. **Drop the dead `archivedAt` column from list views** until the "Show archived" feature lands. *(NEW-8)*
19. **Surface `userScopes` audit events in a per-user timeline view.** Promote `entityType="user_scope"` if cleaner. *(NEW-9)*

---

## File reference index

| File | Purpose |
|---|---|
| `src/db/schema.ts` | Schema source of truth — all field/column references above |
| `src/components/locations/location-detail-form.tsx` | Location create + edit form (786 LOC) |
| `src/components/locations/location-columns.tsx` | Location list table columns (369 LOC) |
| `src/components/kiosks/kiosk-detail-form.tsx` | Kiosk create + edit form (652 LOC) |
| `src/components/kiosks/kiosk-columns.tsx` | Kiosk list table columns (338 LOC) |
| `src/components/kiosks/kiosk-detail-actions.tsx` | Kiosk archive button + dialog |
| `src/app/(app)/locations/actions.ts` | Location server actions + `EDITABLE_LOCATION_FIELDS` allowlist |
| `src/app/(app)/kiosks/actions.ts` | Kiosk server actions + `EDITABLE_KIOSK_FIELDS` allowlist |
| `src/app/(app)/settings/outlet-types/actions.ts` | The ONLY place `locationType` and `primaryRegionId` are editable post-create |
| `src/app/(app)/settings/users/[id]/scopes-internal.ts` | UserScopes CRUD + last-scope invariant |
| `src/app/(app)/settings/outlet-exclusions/actions.ts` | Outlet exclusion CRUD (wired to analytics) |
| `src/app/(app)/settings/business-events/actions.ts` | Business-event annotations |
| `src/app/(app)/settings/pipeline-stages/actions.ts` | Pipeline stage CRUD with reassign-on-delete |
| `src/lib/analytics/queries/shared.ts` | Where filters are applied — `outletExclusions` wired, `archivedAt` NOT |
| `src/lib/analytics/active-locations.ts` | `getActiveLocationIds` — the location ID cache used by every analytics query |
| `src/lib/auth/gating.ts` | External-user portal-lockdown enforcement |
| `src/proxy.ts` | Middleware wiring for the gating helper |
| `src/components/audit/audit-timeline.tsx` | Per-entity audit timeline (kiosk/location only) |
| `migrations/0025_au_region.sql` | Australia region seed |
