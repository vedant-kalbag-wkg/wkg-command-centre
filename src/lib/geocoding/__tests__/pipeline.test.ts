/**
 * Phase 6 plan 06-06 — geocoding pipeline tests.
 *
 * Lives under `src/lib/geocoding/__tests__/` so the file matches the prompt's
 * success-criterion path (`npx vitest run --project unit
 * src/lib/geocoding/__tests__/pipeline.test.ts`). The unit project picks up
 * `src/**\/__tests__/**\/*.test.ts`. We override `testTimeout` and
 * `hookTimeout` inline because spinning up a Testcontainers Postgres needs
 * far more than the unit project's 5s default.
 *
 * Pipeline design (decision lock):
 *   - Staging is in-memory — `_stageGeocodeForActor` returns the staged rows.
 *     The UI holds them in client React state; commit takes them back as a
 *     parameter. No `geocoding_stagings` DB table. See SUMMARY.md "Deviations
 *     from Plan" (Rule 3) for why we overruled the plan's locked decision.
 *
 * Tests (mirroring plan task 2 <behavior>):
 *   1. dry-run skip-existing — populated rows excluded by default
 *   2. force-rerun — all active rows surface
 *   3. geocoder error — error rows surface in stage but commit skips them
 *   4. apply happy path — locations.{lat,lng} set + audit_logs per row
 *   5. apply skips error rows — only ok rows written
 *   6. cancel — no-op since staging is in-memory
 *   7. apply idempotency — second commit on same staged rows is a no-op
 *      (rows already populated, so a refreshed dry-run yields zero candidates)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../../../../tests/helpers/test-db";
import { auditLogs, locations, regions, user } from "@/db/schema";
import {
  _cancelGeocodeForActor,
  _commitGeocodeForActor,
  _stageGeocodeForActor,
  GEOCODE_SCRIPT_TAG,
  type GeocodeStagedRow,
} from "../pipeline";
import type { Geocoder } from "../google";

describe("geocoding pipeline", () => {
  let ctx: TestDbContext;
  let regionId: string;
  const ACTOR = { id: "test-actor-id", name: "Test Actor" };

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // FK-ordered cleanup. Audit logs and locations are FK-isolated from each
    // other but share user/region.
    await ctx.db.delete(auditLogs);
    await ctx.db.delete(locations);
    await ctx.db.delete(regions);
    await ctx.db.delete(user);

    await ctx.db.insert(user).values({
      id: ACTOR.id,
      name: ACTOR.name,
      email: "test-actor@example.com",
    });

    const [region] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK", azureCode: "GB" })
      .returning({ id: regions.id });
    regionId = region.id;
  });

  // Helper: stub geocoder that returns deterministic ok results unless told
  // otherwise via per-address override map.
  function makeStubGeocoder(
    overrides: Record<string, "no_results" | "error"> = {},
  ): Geocoder {
    return {
      geocode: vi.fn(async (address: string) => {
        if (overrides[address] === "no_results") {
          return { status: "no_results" as const, address };
        }
        if (overrides[address] === "error") {
          return {
            status: "error" as const,
            address,
            errorMessage: "stubbed-error",
          };
        }
        return {
          status: "ok" as const,
          // Deterministic but address-derived so different rows get different
          // coords — confirms the per-row write hits the right location.
          latitude: 51.5 + (address.length % 5) * 0.01,
          longitude: -0.1 + (address.length % 7) * 0.01,
          formattedAddress: `${address}, formatted`,
          locationType: "ROOFTOP",
          placeId: `place-${address.replace(/\s+/g, "-")}`,
        };
      }),
    };
  }

  test(
    "dry-run skips rows that already have lat/lng (idempotency default)",
    async () => {
      // Three locations: one populated, two NULL.
      await ctx.db.insert(locations).values([
        {
          name: "Already Populated",

          primaryRegionId: regionId,
          address: "1 Already Lane, London",
          latitude: 51.5,
          longitude: -0.1,
        },
        {
          name: "Empty One",

          primaryRegionId: regionId,
          address: "1 Empty Street, London",
        },
        {
          name: "Empty Two",

          primaryRegionId: regionId,
          address: "2 Empty Street, London",
        },
      ]);

      const summary = await _stageGeocodeForActor(
        ACTOR,
        ctx.db,
        makeStubGeocoder(),
        { forceRerun: false },
      );

      expect(summary.totalCandidates).toBe(2);
      expect(summary.okCount).toBe(2);
      expect(summary.noResultsCount).toBe(0);
      expect(summary.errorCount).toBe(0);
      expect(summary.rows).toHaveLength(2);
      const names = summary.rows.map((r) => r.locationName).sort();
      expect(names).toEqual(["Empty One", "Empty Two"]);
      expect(summary.stagingId).toMatch(/^[0-9a-f-]{36}$/);
    },
    60_000,
  );

  test(
    "force-rerun stages all active locations including already-populated ones",
    async () => {
      await ctx.db.insert(locations).values([
        {
          name: "Already Populated",

          primaryRegionId: regionId,
          address: "1 Already Lane, London",
          latitude: 51.5,
          longitude: -0.1,
        },
        {
          name: "Empty One",

          primaryRegionId: regionId,
          address: "1 Empty Street, London",
        },
        {
          name: "Empty Two",

          primaryRegionId: regionId,
          address: "2 Empty Street, London",
        },
      ]);

      const summary = await _stageGeocodeForActor(
        ACTOR,
        ctx.db,
        makeStubGeocoder(),
        { forceRerun: true },
      );

      expect(summary.totalCandidates).toBe(3);
      expect(summary.rows).toHaveLength(3);
    },
    60_000,
  );

  test(
    "geocoder errors surface in stage but commit only writes ok rows",
    async () => {
      await ctx.db.insert(locations).values([
        {
          name: "Will Error",

          primaryRegionId: regionId,
          address: "Bad Address",
        },
        {
          name: "Will Succeed",

          primaryRegionId: regionId,
          address: "Good Address",
        },
      ]);

      const summary = await _stageGeocodeForActor(
        ACTOR,
        ctx.db,
        makeStubGeocoder({ "Bad Address": "error" }),
        { forceRerun: false },
      );

      expect(summary.totalCandidates).toBe(2);
      expect(summary.okCount).toBe(1);
      expect(summary.errorCount).toBe(1);
      const errorRow = summary.rows.find(
        (r) => r.result.status === "error",
      ) as GeocodeStagedRow;
      expect(errorRow.locationName).toBe("Will Error");

      const commit = await _commitGeocodeForActor(
        ACTOR,
        ctx.db,
        summary.stagingId,
        summary.rows,
      );
      expect(commit.rowsUpdated).toBe(1);
      expect(commit.auditLogsWritten).toBe(1);

      const allLocations = await ctx.db
        .select({
          name: locations.name,
          latitude: locations.latitude,
          longitude: locations.longitude,
        })
        .from(locations);
      const errorLoc = allLocations.find((l) => l.name === "Will Error");
      const okLoc = allLocations.find((l) => l.name === "Will Succeed");
      expect(errorLoc?.latitude).toBeNull();
      expect(errorLoc?.longitude).toBeNull();
      expect(okLoc?.latitude).not.toBeNull();
      expect(okLoc?.longitude).not.toBeNull();
    },
    60_000,
  );

  test(
    "apply writes lat/lng + one audit_logs row per populated location",
    async () => {
      const inserted = await ctx.db
        .insert(locations)
        .values([
          {
            name: "First",

            primaryRegionId: regionId,
            address: "First Address",
          },
          {
            name: "Second",

            primaryRegionId: regionId,
            address: "Second Address",
          },
        ])
        .returning({ id: locations.id, name: locations.name });

      const summary = await _stageGeocodeForActor(
        ACTOR,
        ctx.db,
        makeStubGeocoder(),
        { forceRerun: false },
      );
      const result = await _commitGeocodeForActor(
        ACTOR,
        ctx.db,
        summary.stagingId,
        summary.rows,
      );

      expect(result.rowsUpdated).toBe(2);
      expect(result.auditLogsWritten).toBe(2);

      // Locations populated.
      const after = await ctx.db
        .select({
          id: locations.id,
          name: locations.name,
          latitude: locations.latitude,
          longitude: locations.longitude,
        })
        .from(locations);
      for (const loc of after) {
        expect(loc.latitude).not.toBeNull();
        expect(loc.longitude).not.toBeNull();
      }

      // Audit-log shape per spec.
      const logs = await ctx.db
        .select()
        .from(auditLogs)
        .where(
          sql`${auditLogs.entityType} = 'location' AND ${auditLogs.field} = 'latitude,longitude' AND ${auditLogs.metadata}->>'script' = ${GEOCODE_SCRIPT_TAG}`,
        );
      expect(logs).toHaveLength(2);
      for (const log of logs) {
        expect(log.action).toBe("update");
        expect(log.actorId).toBe(ACTOR.id);
        expect(log.actorName).toBe(ACTOR.name);
        expect(
          (log.metadata as { provider?: string }).provider,
        ).toBe("google");
        expect(log.newValue).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
      }
      const loggedIds = new Set(logs.map((l) => l.entityId));
      for (const inserted_loc of inserted) {
        expect(loggedIds.has(inserted_loc.id)).toBe(true);
      }
    },
    60_000,
  );

  test(
    "apply skips no_results rows just like error rows",
    async () => {
      await ctx.db.insert(locations).values([
        {
          name: "No Results",

          primaryRegionId: regionId,
          address: "Nowhere",
        },
        {
          name: "Will Succeed",

          primaryRegionId: regionId,
          address: "Good Address",
        },
      ]);

      const summary = await _stageGeocodeForActor(
        ACTOR,
        ctx.db,
        makeStubGeocoder({ Nowhere: "no_results" }),
        { forceRerun: false },
      );
      expect(summary.noResultsCount).toBe(1);
      expect(summary.okCount).toBe(1);

      const commit = await _commitGeocodeForActor(
        ACTOR,
        ctx.db,
        summary.stagingId,
        summary.rows,
      );
      expect(commit.rowsUpdated).toBe(1);
      expect(commit.auditLogsWritten).toBe(1);
    },
    60_000,
  );

  test(
    "cancel is a no-op when staging is in-memory (no rows persisted)",
    async () => {
      await ctx.db.insert(locations).values({
        name: "Untouched",

        primaryRegionId: regionId,
        address: "Some Address",
      });

      const summary = await _stageGeocodeForActor(
        ACTOR,
        ctx.db,
        makeStubGeocoder(),
        { forceRerun: false },
      );
      expect(summary.totalCandidates).toBe(1);

      const cancelResult = await _cancelGeocodeForActor(summary.stagingId);
      expect(cancelResult.rowsDeleted).toBe(0);

      // Confirm DB untouched.
      const [loc] = await ctx.db
        .select({ latitude: locations.latitude, longitude: locations.longitude })
        .from(locations)
        .where(eq(locations.name, "Untouched"));
      expect(loc.latitude).toBeNull();
      expect(loc.longitude).toBeNull();

      const allLogs = await ctx.db.select().from(auditLogs);
      expect(allLogs).toHaveLength(0);
    },
    60_000,
  );

  test(
    "re-staging after apply yields zero candidates (idempotency end-to-end)",
    async () => {
      await ctx.db.insert(locations).values({
        name: "Once",

        primaryRegionId: regionId,
        address: "Once Address",
      });

      const first = await _stageGeocodeForActor(
        ACTOR,
        ctx.db,
        makeStubGeocoder(),
        { forceRerun: false },
      );
      expect(first.totalCandidates).toBe(1);
      const firstApply = await _commitGeocodeForActor(
        ACTOR,
        ctx.db,
        first.stagingId,
        first.rows,
      );
      expect(firstApply.rowsUpdated).toBe(1);

      // Re-stage with skip-existing default — should find no candidates.
      const second = await _stageGeocodeForActor(
        ACTOR,
        ctx.db,
        makeStubGeocoder(),
        { forceRerun: false },
      );
      expect(second.totalCandidates).toBe(0);
      expect(second.rows).toHaveLength(0);

      // Audit-log count stays at 1 (only the first apply wrote one).
      const logs = await ctx.db
        .select()
        .from(auditLogs)
        .where(
          sql`${auditLogs.metadata}->>'script' = ${GEOCODE_SCRIPT_TAG}`,
        );
      expect(logs).toHaveLength(1);
    },
    60_000,
  );

  test(
    "archived locations are excluded from candidates (active-only)",
    async () => {
      await ctx.db.insert(locations).values([
        {
          name: "Archived",

          primaryRegionId: regionId,
          address: "Archived Address",
          archivedAt: new Date(),
        },
        {
          name: "Active",

          primaryRegionId: regionId,
          address: "Active Address",
        },
      ]);

      const summary = await _stageGeocodeForActor(
        ACTOR,
        ctx.db,
        makeStubGeocoder(),
        { forceRerun: false },
      );

      expect(summary.totalCandidates).toBe(1);
      expect(summary.rows[0].locationName).toBe("Active");
    },
    60_000,
  );

  test(
    "rows with NULL/empty addresses surface as errors (cannot geocode)",
    async () => {
      await ctx.db.insert(locations).values([
        {
          name: "No Address",

          primaryRegionId: regionId,
          address: null,
        },
        {
          name: "Empty Address",

          primaryRegionId: regionId,
          address: "",
        },
        {
          name: "Has Address",

          primaryRegionId: regionId,
          address: "Real Address",
        },
      ]);

      const summary = await _stageGeocodeForActor(
        ACTOR,
        ctx.db,
        makeStubGeocoder(),
        { forceRerun: false },
      );
      expect(summary.totalCandidates).toBe(3);
      expect(summary.errorCount).toBe(2);
      expect(summary.okCount).toBe(1);
    },
    60_000,
  );
});
