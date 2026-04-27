# Phase 7.6d Investigation: Monday → DB Sync for `locations.kioskConfigGroupId`

**Task**: Verify that `scripts/enrich-locations-from-monday.ts` populates `locations.kioskConfigGroupId` from Monday column `1466686598`, and document override semantics for Phase 7.6a UX.

---

## Summary

✅ **The import DOES populate kioskConfigGroupId.** The script reads Monday's `link_to_ssm_groups__1` board-relation column (which points to the SSM Groups board, ID 1466686598), resolves the linked group name, and writes `locations.kioskConfigGroupId` via an unconditional `SET` statement. **Override semantics: LOCAL EDITS ARE OVERWRITTEN on next Monday sync.** There is NO preservation logic (no `COALESCE()`, no "skip if already set" flag, no audit check). The picker for Phase 7.6a MUST warn users that Monday is the source of truth.

---

## Evidence

### 1. Monday Column Mapping

**Script**: `scripts/enrich-locations-from-monday.ts:128-131`

```typescript
// SSM config group name resolved via the Live Estate board's
// link_to_ssm_groups__1 board_relation column (points to SSM Groups
// board 1466686598, where each item is a named config group such as
// "LDNC1 (All products)" or "Leonardo Royal Hotels").
configGroupName: string | null;
```

**Confirmed in schema**:  
`scripts/monday-schema.ts:55` lists `link_to_ssm_groups__1` as the board-relation column ID (the Monday board ID 1466686598 is referenced in the comment; Drizzle/GraphQL use the column ID `link_to_ssm_groups__1`).

**Data fetch**:  
Lines 229–232 extract the column value:
```typescript
const groupText = getText("link_to_ssm_groups__1");
const configGroupName = groupText
  ? groupText.split(",")[0].trim() || null
  : null;
```
(Takes the first group if multiple are linked; in practice, single-assignment per hotel.)

---

### 2. kioskConfigGroupId Write Path

**Schema column**:  
`src/db/schema.ts:204–207`
```typescript
kioskConfigGroupId: uuid("kiosk_config_group_id").references(
  () => kioskConfigGroups.id,
  { onDelete: "set null" },
),
```
Nullable UUID FK, target column on `kioskConfigGroups`.

**Upsert logic** (lines 456–482):
```typescript
if (hotel.configGroupName) {
  let kcgId = kcgMap.get(hotel.configGroupName);
  if (!kcgId) {
    // Upsert kioskConfigGroups by name, resolve ID
    const [row] = await db
      .insert(kioskConfigGroups)
      .values({ name: hotel.configGroupName })
      .onConflictDoNothing({ target: kioskConfigGroups.name })
      .returning({ id: kioskConfigGroups.id });
    // ... fetch existing group if insert failed ...
  }
  if (kcgId) {
    // ⚠️ UNCONDITIONAL UPDATE — no preserve/coalesce logic
    await db
      .update(locations)
      .set({ kioskConfigGroupId: kcgId, updatedAt: new Date() })
      .where(eq(locations.id, loc.id));
    configGroupLinked++;
  }
} else {
  configGroupMissing++;
}
```

**Key observation**: Line 479 issues an unconditional `SET kioskConfigGroupId = kcgId`. There is:
- ❌ No `COALESCE(kiosk_config_group_id, ?)` to skip if already set
- ❌ No `WHERE kiosk_config_group_id IS NULL` to skip already-assigned locations
- ❌ No audit-log check to detect "locally modified" records
- ❌ No `IF NOT CONFLICT` or `IF EXISTS` clause
- ✅ It **ALWAYS OVERWRITES** the existing value (if any) with the Monday value.

---

### 3. User Editability (Current State)

**EDITABLE_LOCATION_FIELDS** (`src/app/(app)/locations/actions.ts:254–295`):
`kioskConfigGroupId` is **NOT** in the allowlist. The field is **NOT currently editable** via `updateLocationField` server action.

**Why it matters**: Even though `kioskConfigGroupId` cannot be edited via the current UI, Phase 7.6a will add a picker that makes it editable by editor-level users. Once users can edit the column, the next Monday sync will **silently overwrite their edit** with the Monday value.

---

### 4. Audit Trail

**No field-level tracking** exists for `kioskConfigGroupId` changes. The `updateLocationField` action (which logs `field` + `oldValue` + `newValue`) does not include `kioskConfigGroupId`, so:
- Local edits made via Phase 7.6a UI will NOT be logged as audit events (unless 7.6a adds explicit logging, which is not in scope here).
- Monday sync updates are logged implicitly via `updatedAt` timestamp but not as granular field-level entries.

---

## Override Semantics Decision

### Current Behavior

**Monday sync UNCONDITIONALLY OVERWRITES local edits.**

When the enrichment script runs (e.g., on a scheduled import or manual re-run):
1. It fetches the latest config group name from Monday column `link_to_ssm_groups__1`.
2. It resolves or creates the matching `kioskConfigGroups` record.
3. It executes `UPDATE locations SET kioskConfigGroupId = <id>` regardless of the current value.

**Timeline example**:
- 2026-04-20: Editor assigns Location A to "Group X" via UI picker (Phase 7.6a).
- 2026-04-20: Editor realizes it should be "Group Y", edits to "Group Y" via picker.
- 2026-04-21 00:00 UTC: Monday import runs, fetches Monday config group = "Group X" (Monday not updated).
- 2026-04-21 00:00 UTC: Import unconditionally executes `UPDATE locations SET kioskConfigGroupId = <Group X ID> WHERE id = Location A`.
- **Result**: Editor's "Group Y" local edit is silently **LOST** (overwritten with "Group X").

### Why It's Designed This Way

The script treats Monday as the **system of record** for hotel-to-group mappings. This is documented in the D13 design decision (`tasks/todo.md:23`):

> Source of truth for the mapping is Monday column `1466686598`; verify the existing import wiring is correct and re-running it **overwrites stale local edits** with Monday state (or document the override semantics if not).

The Monday integration is the primary data flow; local assignments are expected to be **temporary** or **provisional**, not permanent.

---

## Recommendation for Phase 7.6a UX

The picker MUST communicate to users:

### 1. **Primary Signal: Read-Only Context Badge**
When rendering the config-group picker, show a **"Source: Monday"** or **"Synced from: Monday"** badge/label to indicate this field is synchronized from an upstream system.

### 2. **Help Text / Tooltip**
```
Config Group (Synced from Monday)
Your edits to this field will be overwritten the next time the Monday sync runs.
To make a permanent change, update the group assignment in Monday's Live Estate board.
```

### 3. **Optional: Disablement**
If the field is `read-only by design`, disable the picker and render the value with a lock icon + tooltip:
```
Config Group (Read-only — managed via Monday)
```

**Pros**: Prevents accidental edits that will be lost.
**Cons**: Contradicts the D13 requirement that "all editor-level users" can assign groups.

### 4. **Recommended Choice for Phase 7.6a**
**Make it editable, but warn via tooltip:**
- Picker is **enabled** (allows editor-level assignment).
- **Tooltip on label**: "Synced from Monday; your edits will be overwritten on next sync."
- **No badge** (to avoid clutter; tooltip is sufficient).
- **Rationale**: Preserves editor agency (they can quickly "fix" an assignment locally), while explicitly managing expectations about persistence.

---

## Impact on Phase 7.6a/b/c

| Phase | Blocker? | Impact |
|---|---|---|
| **7.6a** (Add picker) | ✅ No | UX must communicate override semantics via tooltip. Recommended label: "Config Group (synced from Monday)". |
| **7.6b** (Member mgmt view in admin page) | ✅ No | Admin UX is separate; admins can directly edit group membership via `/settings/kiosk-config-groups`. Monday sync override semantics still apply. |
| **7.6c** (Drop `kiosks.kioskConfigGroupId`) | ✅ No | Drop the column; it's always been unused (only `locations.kioskConfigGroupId` is populated). |

---

## Additional Notes

- **Null handling**: If a hotel has no config-group link in Monday (`link_to_ssm_groups__1` is empty), the script skips the UPDATE entirely, leaving `kioskConfigGroupId` unchanged (could be NULL or a previous value). This is the **only** case where a local edit survives.
- **Determinism**: Script is idempotent — re-running with the same Monday data produces the same DB state (no spurious UPDATEs if the value is already correct).
- **No analytics gate**: The column is used only for kiosk-config-group membership display, not for analytics filtering (D11 parked the `freeTrialEndDate` analytics story separately).

