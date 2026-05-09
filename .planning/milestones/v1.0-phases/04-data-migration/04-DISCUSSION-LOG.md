# Phase 4: Data Migration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-01
**Phase:** 04-data-migration
**Areas discussed:** Board discovery & field mapping, Migration UI & admin experience, Conflict & duplicate handling, Error recovery & resilience

---

## Board Discovery & Field Mapping

### Board Organization

| Option | Description | Selected |
|--------|-------------|----------|
| Single board | All kiosks in one board, locations derived from kiosk fields | ✓ |
| Two separate boards | One board for kiosks, one for locations/hotels | |
| Multiple boards by region | Kiosks split across regional boards | |

**User's choice:** Single board
**Notes:** None

### Field Mapping Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-detect + review | Fetch columns, auto-map by name similarity, admin confirms/adjusts | ✓ |
| Hardcoded mapping | Developer writes fixed mapping config after inspection | |
| Full mapping UI | Drag-and-drop or dropdown interface for manual mapping | |

**User's choice:** Auto-detect + review
**Notes:** None

### Location Extraction

| Option | Description | Selected |
|--------|-------------|----------|
| Extract from kiosk columns | Location info lives as kiosk columns, deduplicate by hotel name | ✓ |
| Separate Monday.com group/board | Locations exist as their own items | |
| Discover during exploration | Let Plan 04-01 figure out where location data lives | |

**User's choice:** Extract from kiosk columns
**Notes:** None

### Pipeline Stage Mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-create missing stages | Create new stages for unmatched Monday.com statuses | ✓ |
| Map to existing stages only | Only map to pre-configured stages, flag unmapped as warnings | |
| You decide | Claude's discretion | |

**User's choice:** Auto-create missing stages
**Notes:** None

---

## Migration UI & Admin Experience

### Feature Location

| Option | Description | Selected |
|--------|-------------|----------|
| Settings > Data Import | New card on Settings page, /settings/data-import, admin-only | ✓ |
| Dedicated top-level page | Separate /migration page in sidebar nav | |
| CLI/script only | No UI, Node.js script from terminal | |

**User's choice:** Settings > Data Import
**Notes:** None

### Dry-Run Preview

| Option | Description | Selected |
|--------|-------------|----------|
| Summary table with warnings | Total records, mapped/warned counts, sample of 10-20 records | ✓ |
| Full record-by-record preview | Scrollable table showing every record with mapped fields | |
| JSON diff view | Side-by-side raw vs mapped data | |

**User's choice:** Summary table with warnings
**Notes:** None

### Import Progress

| Option | Description | Selected |
|--------|-------------|----------|
| Progress bar + live log | X/total bar with scrollable action log, in-browser via polling/SSE | ✓ |
| Background job + notification | Server-side job, admin navigates away, notified on completion | |
| You decide | Claude's discretion | |

**User's choice:** Progress bar + live log
**Notes:** None

---

## Conflict & Duplicate Handling

### Duplicate Kiosk IDs

| Option | Description | Selected |
|--------|-------------|----------|
| Skip and log warning | Existing records untouched, duplicates flagged in dry-run | ✓ |
| Overwrite with Monday.com data | Monday.com data replaces existing records | |
| Merge (fill empty fields only) | Only populate currently empty fields | |

**User's choice:** Skip and log warning
**Notes:** None

### Unmapped Columns

| Option | Description | Selected |
|--------|-------------|----------|
| Store in notes field + warn | Unmapped values concatenated into notes as key:value pairs | ✓ |
| Discard silently | Unmapped columns ignored | |
| Store as JSON metadata | Add mondayMetadata JSONB column for original data | |

**User's choice:** Store in notes field + warn
**Notes:** None

---

## Error Recovery & Resilience

### Rate Limit Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Exponential backoff + retry | Wait 1s, 2s, 4s... cap at 5 retries, log each retry | ✓ |
| Fixed delay between requests | 500ms delay between every API call | |
| You decide | Claude's discretion | |

**User's choice:** Exponential backoff + retry
**Notes:** None

### Partial Failure Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Continue + collect errors | Import continues, failures collected in error summary at end | ✓ |
| Stop on first error | Import halts immediately on failure | |
| Transaction rollback | All-or-nothing DB transaction | |

**User's choice:** Continue + collect errors
**Notes:** None

---

## Claude's Discretion

- Monday.com API client implementation details (GraphQL queries, pagination)
- Exact UI layout of data import page and mapping review table
- SSE vs polling for progress updates
- Field mapping heuristics
- Dry-run sample size and table columns
- Error summary format

## Deferred Ideas

None — discussion stayed within phase scope
