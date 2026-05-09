---
plan_id: 06-06
plan_name: geocoding
phase: 6
wave: 4
depends_on: []
requirements_addressed: [SC4, SC10]
files_modified:
  - package.json
  - package-lock.json
  - src/lib/geocoding/google.ts
  - src/lib/geocoding/pipeline.ts
  - src/lib/geocoding/__tests__/pipeline.test.ts
  - src/app/(app)/settings/geocoding/page.tsx
  - src/app/(app)/settings/geocoding/actions.ts
  - src/app/(app)/settings/geocoding/geocoding-client.tsx
  - tests/settings-geocoding/full-flow.spec.ts
  - tasks/todo.md
autonomous: false
estimated_tasks: 5
user_setup:
  - service: google_maps
    why: "Geocoding API to populate locations.latitude/longitude on ~392 outlets"
    env_vars:
      - name: GOOGLE_MAPS_API_KEY
        source: "Google Cloud Console → APIs & Services → Credentials → API Keys (enable Geocoding API on the project first)"
    dashboard_config:
      - task: "Enable the Geocoding API on the Google Cloud project linked to the API key (APIs & Services → Library → 'Geocoding API' → Enable)"
        location: "Google Cloud Console"
      - task: "Set HTTP-referrer or IP restrictions on the API key — production should restrict to the Vercel deployment IP range or use an unrestricted server-side key with billing alerts at $5"
        location: "Google Cloud Console → API Keys → restrictions"
      - task: "Add GOOGLE_MAPS_API_KEY to Vercel env vars (Production + Preview)"
        location: "Vercel Dashboard → wkg-command-centre → Settings → Environment Variables"
---

<must_haves>
**Phase 6 is verified for SC4 ONLY when:** an admin UI at `/settings/geocoding` exists; clicking "Dry-run" produces a preview table showing all ~392 NULL-coord locations with proposed lat/lng, geocoder confidence, and any failures; clicking "Apply" populates `locations.latitude` + `locations.longitude` for ≥390 of those rows; one `audit_logs` row per populated location with `entity_type='location'`, `field='latitude,longitude'`, `metadata.script='scripts/geocode-locations.ts'` (CONTEXT D-15); re-running the apply skips rows that already have `latitude IS NOT NULL` (CONTEXT D-14); a "Re-geocode all" checkbox forces overwrite.

**SC10 contribution:** `tasks/todo.md` line 108 (6.7) is checked `[x]` after this plan completes.

**CRITICAL — npm lockfile regen before commit:** This plan adds a Google Maps SDK dependency. Per `CLAUDE.md` (project), the lockfile MUST be regenerated inside a `linux/amd64` Docker container before push. Skipping this step is the most-repeated CI failure on this repo. See Task 5.
</must_haves>

<objective>
Greenfield admin UI + library for geocoding ~392 active locations whose `latitude`/`longitude` are NULL. Per CONTEXT D-11, the provider is Google Maps Geocoding API; per D-12 invocation is via admin UI button (no CLI-only path); per D-13 the dry-run shows a full preview table for all 392 rows; per D-14 idempotency skips already-populated rows by default with a "Re-geocode all" override; per D-15 audit-log per row.

Per RESEARCH.md "Critical findings #5": adding the dep triggers the npm/lockfile Docker regen procedure (CLAUDE.md lines 3–65). This is the most-cited CI failure on the repo and gets its own dedicated task at the end of the plan.

Per CONTEXT D-19, this plan ships as PR 4 (its own PR; not bundled).

Output: 1 new dep (`@googlemaps/google-maps-services-js`); 4 new src files (`lib/geocoding/google.ts`, `lib/geocoding/pipeline.ts`, page+actions+client at `/settings/geocoding`); 1 vitest unit-test file; 1 Playwright spec; regenerated `package-lock.json` from a linux/amd64 container.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-CONTEXT.md
@.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-RESEARCH.md
@CLAUDE.md
@src/db/schema.ts
@src/lib/audit.ts
@src/app/(app)/settings/data-import/sales/pipeline.ts
@src/app/(app)/settings/data-import/sales/page.tsx
</context>

<interfaces>
<!-- locations.latitude/longitude (src/db/schema.ts:152-153) -->
```typescript
latitude: doublePrecision("latitude"),
longitude: doublePrecision("longitude"),
```
Both nullable; ~392 rows are NULL today (per CONTEXT).

<!-- writeAuditLog signature (src/lib/audit.ts) — see plan 06-01 for full signature -->

<!-- Canonical six-state pipeline pattern from src/app/(app)/settings/data-import/sales/pipeline.ts -->
- `_stageImportForActor(source, actor, db, opts)` — fetches data, validates, writes staging rows
- `_commitImportForActor(...)` — moves staging to live + audit-log
- `_cancelImportForActor(...)` — discards staging
Server actions in `./actions.ts` gate via `requireRole("admin")` and accept `actor: { id, name }` from the session.

<!-- Idempotency (CONTEXT D-14): skip rows where latitude IS NOT NULL by default; force-overwrite via explicit checkbox -->

<!-- Rate limit: Google's default ~50 req/sec. RESEARCH.md says no throttling needed but add 100ms politeness delay between calls. -->

<!-- Env-var convention (RESEARCH.md): no centralised src/lib/env.ts; pipeline functions take key as parameter; actions.ts reads process.env.GOOGLE_MAPS_API_KEY -->
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Add Google Maps dep + thin geocoder wrapper</name>
  <files>
    package.json,
    src/lib/geocoding/google.ts
  </files>
  <read_first>
    - package.json (current dependency list — confirm `@googlemaps/google-maps-services-js` is NOT already present)
    - CLAUDE.md (lines 3–65 — npm lockfile drift procedure; DO NOT regen lockfile in this task; that's Task 5)
    - .planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-RESEARCH.md (lines 322–360 for the env-var convention + audit-log shape)
  </read_first>
  <action>
**(A) Add the Google Maps Services dep.** Add to `package.json` `dependencies`:
```json
"@googlemaps/google-maps-services-js": "^3.4.0"
```

DO NOT run `npm install` at this point on macOS — per CLAUDE.md "Do NOT run `npm install` on macOS between the Docker regen and the commit". Editing `package.json` is fine; lockfile regen is Task 5.

For local development you need `node_modules` populated. Run `npm install` ONLY if `node_modules/@googlemaps/google-maps-services-js` is absent — and only AFTER Task 5 has produced the correct lockfile in a Docker container, OR run `npm install --no-save` to populate `node_modules` without rewriting the lockfile.

**(B) Thin wrapper at `src/lib/geocoding/google.ts`.** This is the swappable I/O boundary — pipeline.ts depends on this interface, not on the SDK directly:

```typescript
import { Client, Status } from "@googlemaps/google-maps-services-js";

export type GeocodeResult =
  | {
      status: "ok";
      latitude: number;
      longitude: number;
      formattedAddress: string;
      // Google's confidence proxy: location_type ∈ {ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER, APPROXIMATE}
      locationType: string;
      placeId: string;
    }
  | {
      status: "no_results";
      address: string;
    }
  | {
      status: "error";
      address: string;
      errorMessage: string;
    };

export type Geocoder = {
  geocode: (address: string) => Promise<GeocodeResult>;
};

/**
 * Construct a Geocoder backed by Google Maps Geocoding API.
 * Caller is responsible for reading process.env.GOOGLE_MAPS_API_KEY at the
 * action layer and passing it in. The pipeline (Task 2) accepts a Geocoder
 * dependency so tests can inject a stub without touching the real network.
 */
export function makeGoogleGeocoder(apiKey: string): Geocoder {
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is required to construct the geocoder");
  const client = new Client({});

  return {
    geocode: async (address: string): Promise<GeocodeResult> => {
      try {
        const res = await client.geocode({ params: { address, key: apiKey } });
        if (res.data.status === Status.ZERO_RESULTS) {
          return { status: "no_results", address };
        }
        if (res.data.status !== Status.OK) {
          return {
            status: "error",
            address,
            errorMessage: res.data.error_message ?? `Google Maps status: ${res.data.status}`,
          };
        }
        const top = res.data.results[0];
        if (!top) return { status: "no_results", address };
        return {
          status: "ok",
          latitude: top.geometry.location.lat,
          longitude: top.geometry.location.lng,
          formattedAddress: top.formatted_address,
          locationType: top.geometry.location_type,
          placeId: top.place_id,
        };
      } catch (err) {
        return {
          status: "error",
          address,
          errorMessage: err instanceof Error ? err.message : "Unknown geocoder error",
        };
      }
    },
  };
}
```

The deliberate two-layer split (`Geocoder` interface + `makeGoogleGeocoder` factory) is so Task 2's pipeline tests can inject a stub `Geocoder` without mocking the SDK.
  </action>
  <verify>
    <automated>
grep -c "@googlemaps/google-maps-services-js" package.json && npm run typecheck
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "@googlemaps/google-maps-services-js" package.json` returns ≥ 1.
    - File `src/lib/geocoding/google.ts` exists.
    - `grep -c "^export" src/lib/geocoding/google.ts` returns ≥ 3 (`Geocoder` type, `GeocodeResult` type, `makeGoogleGeocoder` function).
    - `grep -c "GOOGLE_MAPS_API_KEY" src/lib/geocoding/google.ts` returns 0 (env var is read at the action layer, not here — pure DI).
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    Google Maps SDK is a dependency; thin DI-friendly wrapper around it at `src/lib/geocoding/google.ts`. Lockfile is NOT yet regenerated (Task 5).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Geocoding pipeline (dry-run + apply) with stubbed-geocoder unit tests</name>
  <files>
    src/lib/geocoding/pipeline.ts,
    src/lib/geocoding/__tests__/pipeline.test.ts
  </files>
  <read_first>
    - src/app/(app)/settings/data-import/sales/pipeline.ts (lines 1–100 — the canonical six-state pipeline pattern: `_stageX`, `_commitX`, `_cancelX`)
    - src/lib/geocoding/google.ts (post-Task 1)
    - src/db/schema.ts (lines 145–230 — `locations` table, particularly latitude/longitude columns)
    - src/lib/audit.ts (writeAuditLog signature)
  </read_first>
  <behavior>
    **`pipeline.test.ts` covers:**

    Test 1 (dry-run skip-existing): seed 3 locations — one with lat/lng populated, two NULL. Stub geocoder returns OK for both NULL rows. Call `_stageGeocodeForActor(actor, db, geocoder, { forceRerun: false })`. Assert: returned summary has 2 candidates, 0 skipped-because-already-populated entries in the candidates list (the populated row is NOT in the stage), 0 errors.

    Test 2 (force-rerun overwrites): same seed; call with `{ forceRerun: true }`. Assert: 3 candidates in the stage (all rows including the previously-populated one).

    Test 3 (geocoder error): seed 2 NULL rows; stub geocoder returns `{ status: 'error', errorMessage: 'rate limit' }` for one and `{ status: 'ok', ... }` for the other. Assert: stage has 1 ok + 1 error; both surface in the preview list; no DB write.

    Test 4 (apply happy path): pre-populate stage with 2 ok candidates. Call `_commitGeocodeForActor(actor, db, stagingId)`. Assert: `locations.latitude` and `locations.longitude` set on both rows; 2 audit_logs rows with `field='latitude,longitude'`, `metadata.script='scripts/geocode-locations.ts'`, `metadata.provider='google'`.

    Test 5 (apply skips error rows): stage has 1 ok + 1 error. Apply runs. Assert: only 1 row updated in `locations`; only 1 audit_logs row written; the error row is left untouched (NULL stays NULL).

    Test 6 (cancel discards stage): apply has not run; call `_cancelGeocodeForActor(stagingId)`. Assert: stage rows deleted; locations table unchanged; no audit_logs rows.

    Test 7 (idempotency on apply): apply run once; apply run again with the same stagingId. Assert second apply is a no-op (the staging rows have `applied_at` set; second call writes 0 new audit_logs rows).
  </behavior>
  <action>
**(A) Pipeline at `src/lib/geocoding/pipeline.ts`.** Follow the six-state shape from `data-import/sales/pipeline.ts`. The "staging" data is a small in-memory artefact (not a separate DB table) since dry-run state for 392 rows is < 50KB — keep it as a server-side React state OR as rows in a NEW lightweight `geocodingStagings` table if persistence across page refresh is needed.

**Decision (lock):** persist as rows in a new `geocoding_stagings` table. CONTEXT D-13's "preview table showing all 392 rows" means the user might leave the page open for hours while reviewing; an in-memory staging dies on every nav. Schema migration is needed; bundle into Task 3 (where the page is built) since the table only matters there. For pipeline.ts, define the shape but DON'T add the migration — Task 3 owns it.

```typescript
import { writeAuditLog } from "@/lib/audit";
import type { Geocoder, GeocodeResult } from "./google";

export type GeocodeActor = { id: string; name: string };

export type StageGeocodeOptions = { forceRerun: boolean };

export type GeocodeStagedRow = {
  locationId: string;
  locationName: string;
  address: string;
  currentLat: number | null;
  currentLng: number | null;
  result: GeocodeResult;
};

export type GeocodeStageSummary = {
  totalCandidates: number;
  okCount: number;
  noResultsCount: number;
  errorCount: number;
  rows: GeocodeStagedRow[];
};

export type GeocodeCommitResult = {
  rowsUpdated: number;
  auditLogsWritten: number;
};

export const GEOCODE_SCRIPT_TAG = "scripts/geocode-locations.ts";

/**
 * Dry-run: fetches all candidate locations (NULL lat/lng OR all rows if
 * forceRerun), calls the geocoder for each (with 100ms politeness delay),
 * and returns the staged result for UI display. Does NOT write to locations.
 */
export async function _stageGeocodeForActor(
  actor: GeocodeActor,
  db: AnyDb,
  geocoder: Geocoder,
  opts: StageGeocodeOptions,
): Promise<GeocodeStageSummary> {
  // 1. Select active locations: `archivedAt IS NULL` AND (forceRerun OR latitude IS NULL).
  // 2. For each, call geocoder.geocode(address). If address is null/empty,
  //    record `result = { status: 'error', errorMessage: 'address missing' }`.
  // 3. Insert one geocoding_stagings row per result.
  // 4. Return summary.
}

export async function _commitGeocodeForActor(
  actor: GeocodeActor,
  db: AnyDb,
  stagingId: string,
): Promise<GeocodeCommitResult> {
  // 1. Load all geocoding_stagings rows for this stagingId where result.status === 'ok' and applied_at IS NULL.
  // 2. db.transaction:
  //    a. UPDATE locations SET latitude=?, longitude=? WHERE id=? for each ok row.
  //    b. writeAuditLog per row with metadata = { script: GEOCODE_SCRIPT_TAG, provider: 'google',
  //       confidence: <locationType>, formattedAddress: <result.formattedAddress> }.
  //    c. UPDATE geocoding_stagings SET applied_at=NOW() WHERE id=?.
  // 3. Return counts.
}

export async function _cancelGeocodeForActor(
  db: AnyDb,
  stagingId: string,
): Promise<{ rowsDeleted: number }> {
  // DELETE FROM geocoding_stagings WHERE staging_id = ? AND applied_at IS NULL.
}
```

**(B) Tests at `src/lib/geocoding/__tests__/pipeline.test.ts`.** Use Vitest integration project (Testcontainers Postgres) — the pipeline writes to real DB tables, mocking `db` produces too much fragility. Pattern: spin up Postgres, run drizzle migrations, seed minimal `locations` + `regions` rows, inject a stubbed `Geocoder`. The geocoder stub is per-test (not module-mock):

```typescript
const stubGeocoder: Geocoder = {
  geocode: vi.fn().mockImplementation(async (address) => ({
    status: "ok",
    latitude: 51.5,
    longitude: -0.1,
    formattedAddress: address,
    locationType: "ROOFTOP",
    placeId: "stub",
  })),
};
```

Tests 1–7 from `<behavior>` above. Each test resets DB state in `beforeEach`.
  </action>
  <verify>
    <automated>
npm run typecheck && npx vitest run --project integration src/lib/geocoding/__tests__/pipeline.test.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - File `src/lib/geocoding/pipeline.ts` exists.
    - `grep -c "^export " src/lib/geocoding/pipeline.ts` returns ≥ 5 (3 functions + types + constant).
    - `grep -c "GEOCODE_SCRIPT_TAG\|geocode-locations.ts" src/lib/geocoding/pipeline.ts` returns ≥ 2.
    - File `src/lib/geocoding/__tests__/pipeline.test.ts` exists with ≥ 7 tests.
    - `npx vitest run --project integration src/lib/geocoding/__tests__/pipeline.test.ts` exits 0.
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    Pipeline is library-grade (transactional, idempotent, DI-friendly); 7 integration tests cover stage/commit/cancel + skip-existing/force-rerun/error/idempotency.
  </done>
</task>

<task type="auto">
  <name>Task 3: Admin UI page + actions + Playwright spec</name>
  <files>
    drizzle/0039_create_geocoding_stagings.sql,
    drizzle/meta/_journal.json,
    src/db/schema.ts,
    src/app/(app)/settings/geocoding/page.tsx,
    src/app/(app)/settings/geocoding/actions.ts,
    src/app/(app)/settings/geocoding/geocoding-client.tsx,
    tests/settings-geocoding/full-flow.spec.ts
  </files>
  <read_first>
    - src/app/(app)/settings/data-import/sales/page.tsx (chrome reference for the data-import admin UI)
    - src/app/(app)/settings/duplicates/duplicates-client.tsx (six-state UI pattern: scan → preview → apply)
    - src/lib/geocoding/pipeline.ts (post-Task 2 — the staged-row shape and the three pipeline functions)
    - drizzle/meta/_journal.json (post-plan-06-01 latest idx; this plan adds the next idx — 39 if 06-01 added 38)
  </read_first>
  <action>
**(A) Migration `drizzle/0039_create_geocoding_stagings.sql`:**

```sql
CREATE TABLE "geocoding_stagings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "staging_id" uuid NOT NULL,  -- groups rows belonging to one dry-run session
  "location_id" uuid NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  "location_name" text NOT NULL,
  "address" text,
  "current_latitude" double precision,
  "current_longitude" double precision,
  "result_status" text NOT NULL CHECK ("result_status" IN ('ok', 'no_results', 'error')),
  "result_latitude" double precision,
  "result_longitude" double precision,
  "result_formatted_address" text,
  "result_location_type" text,
  "result_place_id" text,
  "result_error_message" text,
  "actor_id" text NOT NULL,
  "staged_at" timestamptz NOT NULL DEFAULT now(),
  "applied_at" timestamptz
);
CREATE INDEX "geocoding_stagings_staging_id_idx" ON "geocoding_stagings" ("staging_id");
CREATE INDEX "geocoding_stagings_applied_idx" ON "geocoding_stagings" ("applied_at");
```

Update `drizzle/meta/_journal.json` (next idx). Add `geocodingStagings` to `src/db/schema.ts`.

**(B) Server actions at `src/app/(app)/settings/geocoding/actions.ts`:**

```typescript
"use server";

import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import { makeGoogleGeocoder } from "@/lib/geocoding/google";
import {
  _stageGeocodeForActor,
  _commitGeocodeForActor,
  _cancelGeocodeForActor,
} from "@/lib/geocoding/pipeline";

export async function dryRunGeocoding(opts: { forceRerun: boolean }) {
  const session = await requireRole("admin");
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { error: "GOOGLE_MAPS_API_KEY env var is not set on this deployment" };
  }
  const geocoder = makeGoogleGeocoder(apiKey);
  const summary = await _stageGeocodeForActor(
    { id: session.user.id, name: session.user.name },
    db,
    geocoder,
    opts,
  );
  return { success: true, summary };
}

export async function applyGeocoding(stagingId: string) {
  const session = await requireRole("admin");
  return _commitGeocodeForActor(
    { id: session.user.id, name: session.user.name },
    db,
    stagingId,
  );
}

export async function cancelGeocoding(stagingId: string) {
  await requireRole("admin");
  return _cancelGeocodeForActor(db, stagingId);
}
```

**(C) Page at `src/app/(app)/settings/geocoding/page.tsx`** (server component, mirrors `/settings/duplicates/page.tsx`):

```typescript
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/lib/rbac";
import { GeocodingClient } from "./geocoding-client";

export default async function GeocodingPage() {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Location Geocoding"
        description="Populate latitude/longitude on locations via Google Maps. Dry-run shows all candidates with proposed coordinates; Apply writes them with a per-row audit log."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <GeocodingClient />
      </div>
    </div>
  );
}
```

**(D) Client component at `src/app/(app)/settings/geocoding/geocoding-client.tsx`:**

State machine (six-state, mirroring sales import):
- `idle` — Re-geocode-all checkbox + "Run Dry-Run" button
- `staging` — loading spinner while dry-run runs (this can take ~40 seconds for 392 rows × 100ms politeness delay)
- `preview` — table of all candidates: location name, address, current coords, proposed coords, confidence, error (if any). "Apply" / "Cancel" buttons in sticky footer.
- `applying` — loading spinner while apply runs
- `complete` — success panel with row counts; "Run another" button to return to idle
- `error` — error panel with retry

Use existing UI primitives: `<Card>`, `<Button>`, `<Checkbox>`, `<Table>` from `@/components/ui/*`. Sticky footer pattern from `duplicates-client.tsx`.

The 392-row preview table: use a virtualized list if performance becomes an issue, but for 392 rows a plain `<table>` with `overflow-auto max-h-[600px]` is fine.

**(E) Playwright spec at `tests/settings-geocoding/full-flow.spec.ts`:**

```typescript
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

// This spec validates the UI surface without making real Google Maps calls.
// The dry-run server action returns an error if GOOGLE_MAPS_API_KEY is not set
// (which is the test-env state). The spec asserts the error path renders, not
// the happy path. Real-API verification is in Task 4 (manual UAT on staging).

test("@geocoding page loads and shows the run-dry-run form", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/settings/geocoding");
  await expect(page.getByRole("heading", { name: "Location Geocoding", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /run dry.run/i })).toBeVisible();
  await expect(page.getByLabel(/re.geocode all/i)).toBeVisible();
});

test("@geocoding dry-run without API key shows configuration error", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/settings/geocoding");
  await page.getByRole("button", { name: /run dry.run/i }).click();
  // Expect the API-key-missing error to surface (test env doesn't set GOOGLE_MAPS_API_KEY)
  await expect(page.getByText(/GOOGLE_MAPS_API_KEY/i)).toBeVisible({ timeout: 10_000 });
});
```

If the test env DOES have `GOOGLE_MAPS_API_KEY` set (e.g. CI configures one for integration use), the second test must be adapted to skip OR to verify the happy path. Default assumption: not set.
  </action>
  <verify>
    <automated>
npm run db:generate && npm run typecheck && npx playwright test tests/settings-geocoding/full-flow.spec.ts --reporter=list
    </automated>
  </verify>
  <acceptance_criteria>
    - File `drizzle/0039_create_geocoding_stagings.sql` exists.
    - `grep -n "geocodingStagings" src/db/schema.ts` returns ≥ 1 line.
    - File `src/app/(app)/settings/geocoding/page.tsx` exists; `grep -c 'requireRole("admin")' src/app/\(app\)/settings/geocoding/page.tsx` returns ≥ 1.
    - File `src/app/(app)/settings/geocoding/actions.ts` exists; `grep -c "^export async function" src/app/\(app\)/settings/geocoding/actions.ts` returns ≥ 3.
    - File `src/app/(app)/settings/geocoding/geocoding-client.tsx` exists; contains literal `"use client"` on line 1.
    - File `tests/settings-geocoding/full-flow.spec.ts` exists with ≥ 2 tests.
    - `npx playwright test tests/settings-geocoding/full-flow.spec.ts` exits 0.
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    Admin UI scaffolded; dry-run / apply / cancel actions wired; Playwright covers the page-load + missing-API-key paths. Real-API verification deferred to Task 4 (manual UAT).
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Manual UAT — staging dry-run + apply against real Google Maps API</name>
  <what-built>
    Tasks 1–3 ship the Google Maps SDK dep, the geocoder wrapper, the pipeline, the admin UI, and Playwright coverage. The dry-run/apply path against the real Google Maps API has NOT yet run.
  </what-built>
  <how-to-verify>
    Operator (admin):

    **Pre-flight:**
    1. Confirm `GOOGLE_MAPS_API_KEY` is set in Vercel staging env (Settings → Environment Variables → Preview).
    2. Confirm the Geocoding API is enabled on the linked Google Cloud project (APIs & Services → Library → Geocoding API).
    3. Trigger a Vercel preview deploy of the plan branch.

    **Dry-run:**
    4. Open `/settings/geocoding` on the preview deploy.
    5. Leave "Re-geocode all" UNCHECKED (default — skip-existing).
    6. Click "Run Dry-Run". Wait ~40s (392 rows × 100ms politeness delay).
    7. Inspect the preview table: assert ≥ ~390 rows show `status=ok` with proposed lat/lng; ≤ ~5 rows show `no_results` or `error`. Note any error rows for follow-up.

    **Apply:**
    8. Click "Apply". Confirm in the dialog.
    9. After completion, run on the staging DB:
       ```sql
       SELECT count(*) FROM locations WHERE archived_at IS NULL AND latitude IS NOT NULL;
       SELECT count(*) FROM audit_logs
        WHERE entity_type = 'location'
          AND field = 'latitude,longitude'
          AND metadata->>'script' = 'scripts/geocode-locations.ts';
       ```
       The two counts should match (one audit_logs row per populated location).

    **Spot-check 5 random rows:**
    10. Pick 5 of the populated rows; copy their addresses; manually paste into Google Maps web UI; assert the returned coordinates match the populated `latitude`/`longitude` to ~3 decimal places.

    **Idempotency:**
    11. Click "Run Dry-Run" again with "Re-geocode all" UNCHECKED. Expected: 0 candidates (all already populated).
    12. Tick "Re-geocode all". Re-run dry-run. Expected: ~all active rows surface again.
    13. Click "Cancel" on the dry-run preview to discard. Confirm `geocoding_stagings` rows are deleted (or marked discarded).

    **Production apply:**
    14. After staging passes, the operator runs the same Apply on production. Verification SQL on prod must match staging shape (count of rows with `latitude IS NOT NULL` jumps from 0 to ≥390).

    Resume signal: "approved with rows populated: dry-run=N, applied=M, audit_logs=K, spot-check=clean" — OR — describe specific failures (e.g. address parsing edge cases, rate-limit hits, etc.).
  </how-to-verify>
  <resume-signal>Type "approved" with the row counts above, or describe issues</resume-signal>
</task>

<task type="auto">
  <name>Task 5: Regenerate package-lock.json in linux/amd64 Docker container + close todo.md</name>
  <files>
    package-lock.json,
    tasks/todo.md
  </files>
  <read_first>
    - CLAUDE.md (lines 3–65 — the canonical Docker regen procedure; this task implements it literally)
    - package.json (post-Task 1 — should now list `@googlemaps/google-maps-services-js`)
  </read_first>
  <action>
**CRITICAL:** This task is what makes CI pass. Skipping it = deterministic CI failure with `npm error Missing: @emnapi/...` or runtime `Cannot find module '@*/binding-linux-x64-gnu'`.

Per project `CLAUDE.md` lines 30–55, run the canonical Docker command from the repo root:

```bash
docker run --rm --platform linux/amd64 -v "$PWD":/src node:22-bookworm bash -lc '
  set -e
  mkdir -p /build && cp /src/package.json /build/package.json
  cd /build
  npm install --package-lock-only
  npm ci --dry-run
  cp /build/package-lock.json /src/package-lock.json
'
```

After it completes:

1. **Do NOT run `npm install` on macOS.** Per CLAUDE.md "Do NOT run `npm install` on macOS between the Docker regen and the commit" — this would silently rewrite the lockfile back to the macOS shape and re-break CI.

2. **Verify the regen worked:**
   ```bash
   git diff --stat package-lock.json
   ```
   Expected diff: changes confined to the `wasm32-wasi` / `@emnapi` / `@napi-rs` / `lightningcss` / `tailwind-oxide` / `@googlemaps/*` (the new dep) sections. Red flags (per CLAUDE.md): unintended major-version changes to `next`, `react`, `drizzle`, `@neondatabase`, `typescript`, `vitest`, `playwright`. If those appear, ABORT — investigate first.

3. **Verify the new dep made it into the lockfile:**
   ```bash
   grep -c "node_modules/@googlemaps/google-maps-services-js" package-lock.json
   ```
   Should return ≥ 1. If 0, the regen didn't see the package.json change — restart the procedure.

4. **Verify x64 binding entries are present (the bug shape from CLAUDE.md):**
   ```bash
   grep -c '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json
   grep -c '"node_modules/@tailwindcss/oxide-linux-x64-gnu"' package-lock.json
   grep -c '"node_modules/@next/swc-linux-x64-gnu"' package-lock.json
   ```
   Each should return ≥ 1. If any returns 0, the regen ran on arm64 (wrong) — restart with explicit `--platform linux/amd64` and confirm with `uname -m` inside the container.

5. **Close `tasks/todo.md` line 108** (Phase 6.7):
   Change:
   ```
   - [ ] **6.7** Lat/lng population: geocode `locations.address` via Google Maps (or OpenStreetMap Nominatim). (P2 — **deferred to follow-up PR**: ...)
   ```
   to:
   ```
   - [x] **6.7** Lat/lng population: geocoded `locations.address` via Google Maps Geocoding API; admin UI at `/settings/geocoding` with dry-run + skip-existing + force-rerun + per-row audit log. ~392 outlets populated on staging YYYY-MM-DD, prod YYYY-MM-DD. Phase 6 plan 06-06 (PR #NN).
   ```

Per-plan summary commit on the plan's branch (`gsd/phase-06-geocoding`): `feat(geocoding): Google Maps + admin UI + 392 outlets populated (SC4)`.

The commit MUST include `package-lock.json` from the Docker regen — `git diff --stat package-lock.json` should show changes; if it shows none, the regen failed silently.
  </action>
  <verify>
    <automated>
test "$(grep -c '"node_modules/@googlemaps/google-maps-services-js"' package-lock.json)" -ge 1 && test "$(grep -c '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json)" -ge 1 && test "$(grep -c '"node_modules/@next/swc-linux-x64-gnu"' package-lock.json)" -ge 1 && grep -c '^- \[x\] \*\*6\.7\*\*' tasks/todo.md
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c '"node_modules/@googlemaps/google-maps-services-js"' package-lock.json` returns ≥ 1.
    - `grep -c '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json` returns ≥ 1.
    - `grep -c '"node_modules/@tailwindcss/oxide-linux-x64-gnu"' package-lock.json` returns ≥ 1.
    - `grep -c '"node_modules/@next/swc-linux-x64-gnu"' package-lock.json` returns ≥ 1.
    - `git diff --stat package-lock.json` shows non-zero diff and confines changes to the wasm32-wasi / @emnapi / @napi-rs / lightningcss / tailwind-oxide / @googlemaps forest (no major version changes to next, react, drizzle, etc.).
    - `grep -c '^- \[x\] \*\*6\.7\*\*' tasks/todo.md` returns 1.
    - The plan branch's most recent commit subject contains the literal string `geocod` and references SC4 (or 6.7).
    - The CI pipeline (Vercel build + GitHub Actions if any) passes on the plan branch.
  </acceptance_criteria>
  <done>
    Lockfile is regen'd from a linux/amd64 container; CI builds succeed; todo.md 6.7 ticked; PR ready to merge.
  </done>
</task>

</tasks>

<verification>
- `npm run typecheck` exits 0
- `npx vitest run --project integration src/lib/geocoding` exits 0
- `npx playwright test tests/settings-geocoding` exits 0
- After prod apply: ≥390 of 392 NULL-coord locations populated
- After prod apply: matching `audit_logs` count with `metadata.script='scripts/geocode-locations.ts'`
- CI build green on the plan branch
- `tasks/todo.md` line 108 (6.7) ticked
</verification>

<success_criteria>
1. SC4 — `/settings/geocoding` admin UI ships; dry-run shows all 392 candidates with proposed lat/lng + confidence + errors; apply populates `locations.latitude/longitude` for ≥390 rows; skip-existing default; force-rerun checkbox available; per-row audit log.
2. SC10 contribution — `tasks/todo.md` line 108 (6.7) ticked.
3. CI passes on the plan branch (lockfile correctly regen'd).
</success_criteria>

<output>
After completion, create `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-06-SUMMARY.md`: dep added; row counts populated on staging + prod; spot-check results for 5 random addresses; lockfile regen verification; PR # + merge SHA.
</output>
