"use client";

import { CalendarView } from "@/components/calendar/calendar-view";
import type { InstallationWithRelations } from "@/app/(app)/installations/actions";
import type { KioskListItem } from "@/app/(app)/kiosks/actions";

interface CalendarTabProps {
  installations: InstallationWithRelations[];
  kiosks: KioskListItem[];
}

export function CalendarTab({ installations, kiosks }: CalendarTabProps) {
  return <CalendarView installations={installations} kiosks={kiosks} />;
}
