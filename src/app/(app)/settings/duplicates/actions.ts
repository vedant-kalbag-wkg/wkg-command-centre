"use server";

import { db } from "@/db";
import { locations, duplicateDismissals } from "@/db/schema";
import { eq, isNull } from "drizzle-orm";
import { requireRole, getSessionOrThrow } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { scorePair, type PairScore } from "@/lib/duplicates/similarity";

export interface DuplicateCandidate {
  a: { id: string; name: string; address: string | null; customerCode: string | null; hotelGroup: string | null };
  b: { id: string; name: string; address: string | null; customerCode: string | null; hotelGroup: string | null };
  score: number;
  reasons: PairScore["reasons"];
  distanceMeters: number | null;
}

const MIN_NAME_SIMILARITY = 0.4; // pre-filter to keep O(n²) tractable

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function scanDuplicateLocations(): Promise<
  { candidates: DuplicateCandidate[] } | { error: string }
> {
  try {
    await requireRole("admin");

    const rows = await db
      .select({
        id: locations.id,
        name: locations.name,
        address: locations.address,
        customerCode: locations.customerCode,
        hotelGroup: locations.hotelGroup,
        latitude: locations.latitude,
        longitude: locations.longitude,
      })
      .from(locations)
      .where(isNull(locations.archivedAt));

    const dismissed = await db
      .select({
        a: duplicateDismissals.locationAId,
        b: duplicateDismissals.locationBId,
      })
      .from(duplicateDismissals);

    const dismissedSet = new Set(dismissed.map((d) => `${d.a}|${d.b}`));

    const candidates: DuplicateCandidate[] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        const [pa, pb] = canonicalPair(a.id, b.id);
        if (dismissedSet.has(`${pa}|${pb}`)) continue;

        const score = scorePair(a, b);
        if (score.nameSimilarity < MIN_NAME_SIMILARITY) continue;

        candidates.push({
          a: {
            id: a.id,
            name: a.name,
            address: a.address,
            customerCode: a.customerCode,
            hotelGroup: a.hotelGroup,
          },
          b: {
            id: b.id,
            name: b.name,
            address: b.address,
            customerCode: b.customerCode,
            hotelGroup: b.hotelGroup,
          },
          score: score.score,
          reasons: score.reasons,
          distanceMeters: score.distanceMeters,
        });
      }
    }

    candidates.sort((x, y) => y.score - x.score);
    return { candidates };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to scan duplicates" };
  }
}

export async function dismissDuplicatePair(
  locationAId: string,
  locationBId: string
): Promise<{ success: true } | { error: string }> {
  try {
    await requireRole("admin");
    if (locationAId === locationBId) {
      return { error: "Cannot dismiss a pair of the same location" };
    }
    const session = await getSessionOrThrow();
    const [a, b] = canonicalPair(locationAId, locationBId);

    const inserted = await db
      .insert(duplicateDismissals)
      .values({
        locationAId: a,
        locationBId: b,
        dismissedBy: session.user.id,
        dismissedByName: session.user.name,
      })
      .onConflictDoNothing()
      .returning({ id: duplicateDismissals.id });

    if (inserted.length > 0) {
      const [nameA] = await db
        .select({ name: locations.name })
        .from(locations)
        .where(eq(locations.id, a));
      const [nameB] = await db
        .select({ name: locations.name })
        .from(locations)
        .where(eq(locations.id, b));

      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "location",
        entityId: a,
        entityName: nameA?.name ?? "",
        action: "update",
        field: "duplicatePair",
        newValue: `dismissed: ${nameB?.name ?? b} (${b})`,
      });
    }

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to dismiss pair" };
  }
}
