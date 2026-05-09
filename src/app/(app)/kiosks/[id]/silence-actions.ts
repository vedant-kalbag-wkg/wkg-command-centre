"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { kiosks } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";

const SILENCE_INPUT = z.object({
  kioskId: z.string().uuid(),
  reason: z.string().min(3, "Reason must be at least 3 characters").max(500, "Reason must be at most 500 characters"),
});

const UNSILENCE_INPUT = z.object({
  kioskId: z.string().uuid(),
  reason: z.string().max(500, "Reason must be at most 500 characters").optional(),
});

type ActionResult = { ok: true } | { ok: false; error: string };

export async function silenceKiosk(
  kioskId: string,
  reason: string,
): Promise<ActionResult> {
  let session;
  try {
    session = await requireRole("admin");
  } catch {
    return { ok: false, error: "Forbidden" };
  }

  const parsed = SILENCE_INPUT.safeParse({ kioskId, reason });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const rows = await db
    .select({ id: kiosks.id, kioskId: kiosks.kioskId })
    .from(kiosks)
    .where(eq(kiosks.id, parsed.data.kioskId))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false, error: "Kiosk not found" };
  }

  const kiosk = rows[0];

  await db
    .update(kiosks)
    .set({
      alertSilencedAt: new Date(),
      alertSilencedReason: parsed.data.reason,
    })
    .where(eq(kiosks.id, parsed.data.kioskId));

  await writeAuditLog({
    actorId: session.user.id,
    actorName: session.user.name,
    entityType: "kiosk",
    entityId: kiosk.id,
    entityName: kiosk.kioskId,
    action: "silence_alerts",
    metadata: { reason: parsed.data.reason },
  });

  revalidatePath(`/kiosks/${parsed.data.kioskId}`);

  return { ok: true };
}

export async function unsilenceKiosk(
  kioskId: string,
  reason?: string,
): Promise<ActionResult> {
  let session;
  try {
    session = await requireRole("admin");
  } catch {
    return { ok: false, error: "Forbidden" };
  }

  const parsed = UNSILENCE_INPUT.safeParse({ kioskId, reason });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const rows = await db
    .select({ id: kiosks.id, kioskId: kiosks.kioskId })
    .from(kiosks)
    .where(eq(kiosks.id, parsed.data.kioskId))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false, error: "Kiosk not found" };
  }

  const kiosk = rows[0];

  await db
    .update(kiosks)
    .set({
      alertSilencedAt: null,
      alertSilencedReason: null,
    })
    .where(eq(kiosks.id, parsed.data.kioskId));

  await writeAuditLog({
    actorId: session.user.id,
    actorName: session.user.name,
    entityType: "kiosk",
    entityId: kiosk.id,
    entityName: kiosk.kioskId,
    action: "unsilence_alerts",
    metadata: parsed.data.reason ? { reason: parsed.data.reason } : undefined,
  });

  revalidatePath(`/kiosks/${parsed.data.kioskId}`);

  return { ok: true };
}
