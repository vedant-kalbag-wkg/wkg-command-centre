"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { KioskTable } from "@/components/kiosks/kiosk-table";
import { KioskKanban } from "@/components/kiosks/kiosk-kanban";
import { GanttTab } from "./gantt-tab";
import { CalendarTab } from "./calendar-tab";
import type { KioskListItem } from "@/app/(app)/kiosks/actions";
import type { InstallationWithRelations } from "@/app/(app)/installations/actions";

interface ViewTabsClientProps {
  activeView: string;
  kiosks: KioskListItem[];
  // Inlined from schema — listPipelineStages returns the full table row
  stages: {
    id: string;
    name: string;
    position: number;
    color: string | null;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
  }[];
  installations: InstallationWithRelations[];
}

export function ViewTabsClient({
  activeView,
  kiosks,
  stages,
  installations,
}: ViewTabsClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function handleTabChange(value: string) {
    startTransition(() => {
      router.push(`${pathname}?view=${value}`, { scroll: false });
    });
  }

  return (
    <Tabs value={activeView} onValueChange={handleTabChange}>
      <TabsList variant="line" className="mb-4">
        <TabsTrigger value="table">Table</TabsTrigger>
        <TabsTrigger value="kanban">Kanban</TabsTrigger>
        <TabsTrigger value="gantt">Gantt</TabsTrigger>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
      </TabsList>

      <div className="relative">
        {isPending && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 pointer-events-none">
            <Loader2 className="animate-spin size-5 text-wk-azure" />
            <span className="sr-only">Loading…</span>
          </div>
        )}
        <div className={isPending ? "opacity-50 pointer-events-none" : undefined}>
          <TabsContent value="table">
            <KioskTable data={kiosks} />
          </TabsContent>
          <TabsContent value="kanban">
            <KioskKanban kiosks={kiosks} stages={stages} />
          </TabsContent>
          <TabsContent value="gantt">
            <GanttTab installations={installations} />
          </TabsContent>
          <TabsContent value="calendar">
            <CalendarTab installations={installations} kiosks={kiosks} />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
