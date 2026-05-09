"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { locations } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";

// Phase 9 (hotel-level rewrite, post PR #38) — Admin-only per-hotel silencing
// of weekly POC underperformance alerts. Mirrors the legacy kiosk-side
// actions (now deleted) but writes to `locations.alert_silenced_*` columns
// added by migration 0045.

const SILENCE_INPUT = z.object({
  locationId: z.string().uuid(),
  reason: z
    .string()
    .min(3, "Reason must be at least 3 characters")
    .max(500, "Reason must be at most 500 characters"),
});

const UNSILENCE_INPUT = z.object({
  locationId: z.string().uuid(),
  reason: z
    .string()
    .max(500, "Reason must be at most 500 characters")
    .optional(),
});

type ActionResult = { ok: true } | { ok: false; error: string };

export async function silenceLocation(
  locationId: string,
  reason: string,
): Promise<ActionResult> {
  let session;
  try {
    session = await requireRole("admin");
  } catch {
    return { ok: false, error: "Forbidden" };
  }

  const parsed = SILENCE_INPUT.safeParse({ locationId, reason });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const rows = await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(eq(locations.id, parsed.data.locationId))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false, error: "Location not found" };
  }

  const location = rows[0];

  await db
    .update(locations)
    .set({
      alertSilencedAt: new Date(),
      alertSilencedReason: parsed.data.reason,
    })
    .where(eq(locations.id, parsed.data.locationId));

  await writeAuditLog({
    actorId: session.user.id,
    actorName: session.user.name,
    entityType: "location",
    entityId: location.id,
    entityName: location.name,
    action: "silence_alerts",
    metadata: { reason: parsed.data.reason },
  });

  revalidatePath(`/locations/${parsed.data.locationId}`);

  return { ok: true };
}

export async function unsilenceLocation(
  locationId: string,
  reason?: string,
): Promise<ActionResult> {
  let session;
  try {
    session = await requireRole("admin");
  } catch {
    return { ok: false, error: "Forbidden" };
  }

  const parsed = UNSILENCE_INPUT.safeParse({ locationId, reason });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const rows = await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(eq(locations.id, parsed.data.locationId))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false, error: "Location not found" };
  }

  const location = rows[0];

  await db
    .update(locations)
    .set({
      alertSilencedAt: null,
      alertSilencedReason: null,
    })
    .where(eq(locations.id, parsed.data.locationId));

  await writeAuditLog({
    actorId: session.user.id,
    actorName: session.user.name,
    entityType: "location",
    entityId: location.id,
    entityName: location.name,
    action: "unsilence_alerts",
    metadata: parsed.data.reason ? { reason: parsed.data.reason } : undefined,
  });

  revalidatePath(`/locations/${parsed.data.locationId}`);

  return { ok: true };
}
