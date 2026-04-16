"use client";

import type { InstallationWithRelations } from "@/app/(app)/installations/actions";
import { GanttView } from "@/components/gantt/gantt-view";

interface GanttTabProps {
  installations: InstallationWithRelations[];
}

/**
 * GanttTab — client component wrapper for the Gantt view.
 *
 * Receives installations data (serialised from the server component that
 * fetches it at page load) and renders the full GanttView component.
 *
 * Usage: imported by the Kiosks page in Plan 03-05 for the Gantt tab content.
 */
export function GanttTab({ installations }: GanttTabProps) {
  return <GanttView installations={installations} />;
}
