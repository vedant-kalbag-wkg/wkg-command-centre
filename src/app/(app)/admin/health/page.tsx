/**
 * Phase 7 Plan 07-04 (DATA-03 / DATA-04 D-08, UI-SPEC Surface 5) — admin
 * system-health page. Two status cards:
 *
 *   1. Duplicate location names — count of same-name groups via
 *      `detectSameNameGroups`. Status pill: "Action required" when N>0,
 *      "Clean" otherwise. CTA links to `/locations?filter=same-name`.
 *   2. Unmatched kiosks — count of distinct active kiosks attached to the
 *      LOCATION_NEEDED sentinel via `kiosk_assignments`. CTA links to the
 *      sentinel detail page so the operator can triage orphans inline.
 *
 * Admin-only via `requireRole("admin")`. Non-admin viewers get the standard
 * Forbidden error from the RBAC layer (caught by the parent error boundary).
 */

import Link from "next/link";
import { and, eq, isNull, sql } from "drizzle-orm";

import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/db";
import { kioskAssignments, kiosks } from "@/db/schema";
import { detectSameNameGroups } from "@/lib/locations/same-name-detection";
import { requireRole } from "@/lib/rbac";
import { getSentinelLocationId } from "@/lib/sentinel";

export default async function AdminHealthPage() {
  await requireRole("admin");

  // ── Surface 5 Card 1 — duplicate location names ─────────────────────────
  const sameNameGroups = await detectSameNameGroups();
  const sameNameCount = sameNameGroups.length;

  // ── Surface 5 Card 2 — unmatched kiosks (sentinel orphans) ──────────────
  // Phase 07-06 — the sentinel is now resolved by (name, GLOBAL region) via
  // `getSentinelLocationId`. The helper throws if the sentinel row is
  // missing (e.g. fresh dev DB pre-runbook); we tolerate that and surface a
  // Clean state — there's nothing to be orphaned to.
  let sentinelId: string | null = null;
  try {
    sentinelId = await getSentinelLocationId(db);
  } catch {
    sentinelId = null;
  }

  let orphanCount = 0;
  if (sentinelId) {
    // Distinct active kiosks pointed at the sentinel. We count distinct
    // kiosk_id rather than distinct assignment rows — a kiosk could have
    // multiple historical assignments to the sentinel (assigned, then
    // unassigned, then re-assigned), and we care about the count of kiosks
    // currently in the orphan bucket, not the assignment history depth.
    const orphanResult = await db
      .select({
        c: sql<number>`COUNT(DISTINCT ${kioskAssignments.kioskId})::int`,
      })
      .from(kioskAssignments)
      .innerJoin(kiosks, eq(kiosks.id, kioskAssignments.kioskId))
      .where(
        and(
          eq(kioskAssignments.locationId, sentinelId),
          isNull(kioskAssignments.unassignedAt),
          isNull(kiosks.archivedAt),
        ),
      );
    orphanCount = orphanResult[0]?.c ?? 0;
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="System Health"
        description="Real-time view of data-quality invariants. Each card surfaces a known failure mode that a route-load query can detect cheaply."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <HealthCard
            title="Duplicate location names"
            status={sameNameCount === 0 ? "ok" : "warn"}
            body={
              sameNameCount === 0
                ? "No duplicate names detected."
                : `${sameNameCount} group${sameNameCount === 1 ? "" : "s"} with same name`
            }
            ctaLabel="Resolve in Locations"
            ctaHref="/locations?filter=same-name"
          />
          <HealthCard
            title="Unmatched kiosks"
            status={orphanCount === 0 ? "ok" : "warn"}
            body={
              orphanCount === 0
                ? "All kiosks assigned."
                : `${orphanCount} kiosk${orphanCount === 1 ? "" : "s"} awaiting location assignment`
            }
            ctaLabel="Review orphans"
            ctaHref={sentinelId ? `/locations/${sentinelId}` : "/locations"}
          />
        </div>
      </div>
    </div>
  );
}

function HealthCard({
  title,
  status,
  body,
  ctaLabel,
  ctaHref,
}: {
  title: string;
  status: "ok" | "warn";
  body: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  // Pill colour tokens locked by 07-UI-SPEC.md Surface 5. Do NOT switch to
  // shadcn Badge variants — the spec calls for these specific HSLs and
  // contrast ratios.
  const pillClass =
    status === "ok"
      ? "bg-[#68D871]/10 text-[#2E7D32]"
      : "bg-[#F4BA1E]/10 text-[#8A6B0E]";
  const pillLabel = status === "ok" ? "Clean" : "Action required";
  return (
    <div className="border rounded-xl p-4 space-y-3 bg-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold tracking-[-0.01em]">{title}</h2>
        <span
          className={`${pillClass} rounded-full px-2 py-0.5 text-xs font-bold tracking-[-0.01em]`}
        >
          {pillLabel}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{body}</p>
      <Link href={ctaHref} className="text-sm text-primary underline">
        {ctaLabel}
      </Link>
    </div>
  );
}
