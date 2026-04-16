"use client";

import type { InstallationWithRelations } from "@/app/(app)/installations/actions";
import { GanttView } from "@/components/gantt/gantt-view";

interface GanttTabProps {
  installations: InstallationWithRelations[];
}

export function GanttTab({ installations }: GanttTabProps) {
  return <GanttView installations={installations} />;
}
