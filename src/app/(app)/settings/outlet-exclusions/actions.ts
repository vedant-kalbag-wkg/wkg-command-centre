"use server";

import { db } from "@/db";
import {
  kioskAssignments,
  kiosks,
  locations,
  outletExclusions,
  regions,
  user,
} from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Outlet exclusion server actions — admin only
// ---------------------------------------------------------------------------

export type ExclusionRow = {
  id: string;
  outletCode: string;
  patternType: "exact" | "regex";
  label: string | null;
  regionId: string;
  regionCode: string;
  regionName: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type RegionOption = {
  id: string;
  code: string;
  name: string;
};

export async function listRegions(): Promise<
  { regions: RegionOption[] } | { error: string }
> {
  try {
    await requireRole("admin");
    const rows = await db
      .select({ id: regions.id, code: regions.code, name: regions.name })
      .from(regions)
      .orderBy(asc(regions.code));
    return { regions: rows };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list regions";
    return { error: message };
  }
}

export async function listExclusions(): Promise<
  { exclusions: ExclusionRow[] } | { error: string }
> {
  try {
    await requireRole("admin");

    const rows = await db
      .select({
        id: outletExclusions.id,
        outletCode: outletExclusions.outletCode,
        patternType: outletExclusions.patternType,
        label: outletExclusions.label,
        regionId: outletExclusions.regionId,
        regionCode: regions.code,
        regionName: regions.name,
        createdBy: outletExclusions.createdBy,
        createdByName: user.name,
        createdAt: outletExclusions.createdAt,
      })
      .from(outletExclusions)
      .innerJoin(regions, eq(outletExclusions.regionId, regions.id))
      .leftJoin(user, eq(outletExclusions.createdBy, user.id))
      .orderBy(outletExclusions.createdAt);

    const exclusions: ExclusionRow[] = rows.map((r) => ({
      id: r.id,
      outletCode: r.outletCode,
      patternType: r.patternType as "exact" | "regex",
      label: r.label,
      regionId: r.regionId,
      regionCode: r.regionCode,
      regionName: r.regionName,
      createdBy: r.createdBy,
      createdByName: r.createdByName ?? null,
      createdAt: r.createdAt.toISOString(),
    }));

    return { exclusions };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list exclusions";
    return { error: message };
  }
}

export async function createExclusion(data: {
  outletCode: string;
  patternType: "exact" | "regex";
  regionId: string;
  label?: string;
}): Promise<{ success: true; id: string } | { error: string }> {
  try {
    const session = await requireRole("admin");

    if (!data.regionId) {
      return { error: "Region is required" };
    }

    const [row] = await db
      .insert(outletExclusions)
      .values({
        outletCode: data.outletCode,
        patternType: data.patternType,
        regionId: data.regionId,
        label: data.label || null,
        createdBy: session.user.id,
      })
      .returning({ id: outletExclusions.id });

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "outlet_exclusion",
      entityId: row.id,
      entityName: data.outletCode,
      action: "create",
    });

    return { success: true, id: row.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create exclusion";
    return { error: message };
  }
}

export async function deleteExclusion(
  id: string,
): Promise<{ success: true } | { error: string }> {
  try {
    const session = await requireRole("admin");

    // Fetch for audit log before deletion
    const [existing] = await db
      .select({ outletCode: outletExclusions.outletCode })
      .from(outletExclusions)
      .where(eq(outletExclusions.id, id));

    await db.delete(outletExclusions).where(eq(outletExclusions.id, id));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "outlet_exclusion",
      entityId: id,
      entityName: existing?.outletCode ?? id,
      action: "delete",
    });

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete exclusion";
    return { error: message };
  }
}

/**
 * Test a pattern against the outlet codes in a single region. Region-scoped
 * to mirror how the exclusion will actually be evaluated at query time
 * (Task 1.9 / PR-6 Part F): an exclusion only matches outlets sharing its
 * region_id.
 */
export async function testPattern(
  pattern: string,
  patternType: "exact" | "regex",
  regionId: string,
): Promise<{ matches: string[] } | { error: string }> {
  try {
    await requireRole("admin");

    if (!regionId) {
      return { error: "Region is required" };
    }

    // Phase 07-06 — outlet codes live on `kiosks` (per-SSM), not on
    // locations. Scan currently-assigned kiosks via kiosk_assignments to
    // get the set of outlet codes that would be matched by an exclusion in
    // this region. Distinct by code so the preview shows each unique code
    // once even if multiple kiosks share it (shouldn't happen, but safe).
    const allCodeRows = await db
      .selectDistinct({ outletCode: kiosks.outletCode })
      .from(kiosks)
      .innerJoin(kioskAssignments, eq(kioskAssignments.kioskId, kiosks.id))
      .innerJoin(locations, eq(locations.id, kioskAssignments.locationId))
      .where(
        and(
          isNotNull(kiosks.outletCode),
          isNull(kioskAssignments.unassignedAt),
          eq(locations.primaryRegionId, regionId),
        ),
      );

    const codes = allCodeRows
      .map((r) => r.outletCode)
      .filter((c): c is string => c !== null);

    let matches: string[];

    if (patternType === "exact") {
      matches = codes.filter((c) => c === pattern);
    } else {
      // Regex match — validate the pattern first
      try {
        const re = new RegExp(pattern);
        matches = codes.filter((c) => re.test(c));
      } catch {
        return { error: "Invalid regular expression" };
      }
    }

    return { matches };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to test pattern";
    return { error: message };
  }
}
