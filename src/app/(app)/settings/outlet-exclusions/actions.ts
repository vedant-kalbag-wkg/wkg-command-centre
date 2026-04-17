"use server";

import { db } from "@/db";
import { outletExclusions, locations, user } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { eq, isNotNull, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Outlet exclusion server actions — admin only
// ---------------------------------------------------------------------------

export type ExclusionRow = {
  id: string;
  outletCode: string;
  patternType: "exact" | "regex";
  label: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

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
        createdBy: outletExclusions.createdBy,
        createdByName: user.name,
        createdAt: outletExclusions.createdAt,
      })
      .from(outletExclusions)
      .leftJoin(user, eq(outletExclusions.createdBy, user.id))
      .orderBy(outletExclusions.createdAt);

    const exclusions: ExclusionRow[] = rows.map((r) => ({
      id: r.id,
      outletCode: r.outletCode,
      patternType: r.patternType as "exact" | "regex",
      label: r.label,
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
  label?: string;
}): Promise<{ success: true; id: string } | { error: string }> {
  try {
    const session = await requireRole("admin");

    const [row] = await db
      .insert(outletExclusions)
      .values({
        outletCode: data.outletCode,
        patternType: data.patternType,
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
 * Test a pattern against all known outlet codes.
 * Returns the list of matching outlet codes.
 */
export async function testPattern(
  pattern: string,
  patternType: "exact" | "regex",
): Promise<{ matches: string[] } | { error: string }> {
  try {
    await requireRole("admin");

    // Fetch all outlet codes from locations
    const allCodes = await db
      .select({ outletCode: locations.outletCode })
      .from(locations)
      .where(isNotNull(locations.outletCode));

    const codes = allCodes
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
