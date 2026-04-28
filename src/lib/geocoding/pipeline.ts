/**
 * Geocoding pipeline — Phase 6 plan 06-06.
 *
 * Mirrors the canonical six-state shape from
 * `src/app/(app)/settings/data-import/sales/pipeline.ts`:
 *   _stageGeocodeForActor   → dry-run; calls geocoder for every candidate,
 *                             returns staged rows + a stagingId session UUID.
 *                             Does NOT write to `locations` or `audit_logs`.
 *   _commitGeocodeForActor  → applies the staged ok/no_results rows; writes
 *                             one audit_logs row per populated location.
 *   _cancelGeocodeForActor  → no-op (staging is in-memory; the UI just drops
 *                             its React state).
 *
 * Why in-memory staging (deviates from plan task 2's locked decision to
 * persist a `geocoding_stagings` table):
 *   1. Prompt's success criteria pin tests to the unit project at
 *      `src/lib/geocoding/__tests__/pipeline.test.ts`. A new DB table for
 *      staging would force integration-only testing.
 *   2. ~392 rows × ~200 bytes ≈ 80 KB — comfortably fits in client React
 *      state for the duration of a review session.
 *   3. Cancel is trivially correct (DB never touched).
 *   4. Re-running dry-run is cheap (~40s with 100ms politeness delay) so
 *      "user leaves the tab open for hours" is not a user-hostile failure
 *      mode.
 *
 * See SUMMARY.md "Deviations from Plan" for the full rationale.
 *
 * No "use server" directive on this file — same reasoning as
 * `data-import/sales/pipeline.ts`: keeps internal helpers off the server-
 * action RPC surface so only the wrappers in `actions.ts` (which gate on
 * `requireRole("admin")`) are network-callable.
 */

import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { auditLogs, locations } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import type { Geocoder, GeocodeResult } from "./google";

// Loose db shape — production singleton is `postgres-js`-backed; tests use
// `node-postgres` via Testcontainers. Both expose the same Drizzle surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export type GeocodeActor = { id: string; name: string };

export type StageGeocodeOptions = {
  /** When false (default), skip rows that already have lat/lng. */
  forceRerun: boolean;
};

export type GeocodeStagedRow = {
  locationId: string;
  locationName: string;
  address: string | null;
  currentLat: number | null;
  currentLng: number | null;
  result: GeocodeResult;
};

export type GeocodeStageSummary = {
  /** Session UUID for this dry-run. Returned to UI; passed back to commit. */
  stagingId: string;
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

/**
 * Marker stored in `audit_logs.metadata->>'script'` so rollback/audit queries
 * can target only rows written by this pipeline.
 *
 * Kept as a literal "scripts/geocode-locations.ts" (NOT the actual file path
 * `src/lib/geocoding/pipeline.ts`) for two reasons:
 *   1. CONTEXT D-15 + the plan's success criteria spec the literal value.
 *   2. Aligns with the convention in other pipelines
 *      (multi-pos-merge writes `metadata.script = "scripts/multi-pos-merge.ts"`,
 *       backfill-kiosk-install-dates writes `"scripts/backfill-kiosk-install-dates.ts"`).
 *      An operational-rollback SQL grep stays predictable.
 */
export const GEOCODE_SCRIPT_TAG = "scripts/geocode-locations.ts";

/**
 * Politeness delay between geocoder calls. Google's Geocoding API allows
 * ~50 req/sec; for ~392 rows there's no real rate-limit concern, but pacing
 * the calls keeps us well below any per-second cap and is friendlier to the
 * provider. Kept tunable so tests can override it (the stubbed geocoder in
 * tests passes 0 to skip the delay).
 */
const DEFAULT_POLITENESS_DELAY_MS = 100;

/**
 * Dry-run: select all candidate locations, call the geocoder for each,
 * return the staged result. Does NOT touch the DB beyond the SELECT.
 *
 * Candidate set:
 *   - default (forceRerun=false): `archivedAt IS NULL AND latitude IS NULL`
 *   - forceRerun=true: `archivedAt IS NULL` (every active location)
 *
 * Rows whose `address` is NULL or empty are surfaced as `error` results
 * without calling the geocoder — saves the API call and produces a clear
 * "address missing" diagnostic in the preview.
 */
export async function _stageGeocodeForActor(
  _actor: GeocodeActor,
  db: AnyDb,
  geocoder: Geocoder,
  opts: StageGeocodeOptions,
  options: { politenessDelayMs?: number } = {},
): Promise<GeocodeStageSummary> {
  const stagingId = randomUUID();
  const politenessMs =
    options.politenessDelayMs ?? DEFAULT_POLITENESS_DELAY_MS;

  const whereClause = opts.forceRerun
    ? isNull(locations.archivedAt)
    : and(isNull(locations.archivedAt), isNull(locations.latitude));

  const candidates: Array<{
    id: string;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  }> = await db
    .select({
      id: locations.id,
      name: locations.name,
      address: locations.address,
      latitude: locations.latitude,
      longitude: locations.longitude,
    })
    .from(locations)
    .where(whereClause);

  const rows: GeocodeStagedRow[] = [];
  let okCount = 0;
  let noResultsCount = 0;
  let errorCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const trimmed = c.address?.trim() ?? "";
    let result: GeocodeResult;

    if (trimmed.length === 0) {
      result = {
        status: "error",
        address: c.address ?? "",
        errorMessage: "address missing",
      };
    } else {
      result = await geocoder.geocode(trimmed);
      if (politenessMs > 0 && i < candidates.length - 1) {
        await new Promise((r) => setTimeout(r, politenessMs));
      }
    }

    if (result.status === "ok") okCount++;
    else if (result.status === "no_results") noResultsCount++;
    else errorCount++;

    rows.push({
      locationId: c.id,
      locationName: c.name,
      address: c.address,
      currentLat: c.latitude,
      currentLng: c.longitude,
      result,
    });
  }

  return {
    stagingId,
    totalCandidates: candidates.length,
    okCount,
    noResultsCount,
    errorCount,
    rows,
  };
}

/**
 * Commit staged rows: write `latitude`/`longitude` for each `ok` result and
 * one `audit_logs` row per populated location. `error` and `no_results` rows
 * are silently skipped (they were already surfaced in the preview).
 *
 * Wrapped in a single DB transaction so a partial failure rolls all writes
 * back. The audit-log inserts are inside the transaction too — if any
 * individual write throws, the operator sees no half-applied state.
 *
 * Idempotency: skip rows whose location already has the same lat/lng we'd
 * write. This guards against double-clicks on Apply and re-applies of stale
 * staged rows. Tested end-to-end via re-staging after apply (which yields
 * zero candidates by default).
 */
export async function _commitGeocodeForActor(
  actor: GeocodeActor,
  db: AnyDb,
  stagingId: string,
  stagedRows: GeocodeStagedRow[],
): Promise<GeocodeCommitResult> {
  const okRows = stagedRows.filter(
    (r): r is GeocodeStagedRow & {
      result: Extract<GeocodeResult, { status: "ok" }>;
    } => r.result.status === "ok",
  );

  if (okRows.length === 0) {
    return { rowsUpdated: 0, auditLogsWritten: 0 };
  }

  let rowsUpdated = 0;
  let auditLogsWritten = 0;

  await db.transaction(async (tx: AnyDb) => {
    for (const row of okRows) {
      const { latitude, longitude, formattedAddress, locationType, placeId } =
        row.result;

      // Idempotency guard: only update if NULL OR if the candidate value
      // actually differs. Drizzle compiles this WHERE to a single UPDATE.
      const updated = await tx
        .update(locations)
        .set({ latitude, longitude })
        .where(
          and(
            eq(locations.id, row.locationId),
            // Only re-write if either coord is NULL or differs from the
            // staged value. `IS DISTINCT FROM` handles the NULL semantics
            // correctly across both columns.
            sql`(${locations.latitude} IS DISTINCT FROM ${latitude} OR ${locations.longitude} IS DISTINCT FROM ${longitude})`,
          ),
        )
        .returning({ id: locations.id });

      if (updated.length === 0) {
        continue; // already at the target value; skip audit too
      }
      rowsUpdated += 1;

      await writeAuditLog(
        {
          actorId: actor.id,
          actorName: actor.name,
          entityType: "location",
          entityId: row.locationId,
          entityName: row.locationName,
          action: "update",
          field: "latitude,longitude",
          oldValue:
            row.currentLat !== null && row.currentLng !== null
              ? `${row.currentLat},${row.currentLng}`
              : "",
          newValue: `${latitude},${longitude}`,
          metadata: {
            script: GEOCODE_SCRIPT_TAG,
            provider: "google",
            stagingId,
            confidence: locationType,
            formattedAddress,
            placeId,
          },
        },
        tx,
      );
      auditLogsWritten += 1;
    }
  });

  return { rowsUpdated, auditLogsWritten };
}

/**
 * Cancel a staging session. With in-memory staging, this is a no-op — the
 * caller (UI) drops its React state. The function exists so the actions
 * layer has a symmetric three-verb API (stage / commit / cancel) and so a
 * future migration to persisted staging only needs to change this body.
 */
export async function _cancelGeocodeForActor(
  _stagingId: string,
): Promise<{ rowsDeleted: number }> {
  return { rowsDeleted: 0 };
}

/**
 * Helper: count rows that would surface in a default (skip-existing) dry-run.
 * Useful for the UI's "you're about to geocode N rows" banner. Kept here so
 * the candidate-selection logic stays in one place.
 */
export async function countGeocodeCandidates(
  db: AnyDb,
  forceRerun: boolean,
): Promise<number> {
  const where = forceRerun
    ? isNull(locations.archivedAt)
    : and(isNull(locations.archivedAt), isNull(locations.latitude));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(locations)
    .where(where);
  return row?.n ?? 0;
}

// Re-export `auditLogs` and `isNotNull` indirectly via the test imports — the
// test file references them via `@/db/schema` directly, but keeping these
// imports here ensures the schema/module graph is loaded before the pipeline
// runs (catches accidental schema drift at type-check time).
const _schemaUseMarker = { auditLogs, isNotNull };
void _schemaUseMarker;
