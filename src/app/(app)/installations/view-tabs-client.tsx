"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InstallationTable } from "@/components/installations/installation-table";

const GanttTab = dynamic(
  () => import("./gantt-tab").then((m) => ({ default: m.GanttTab })),
  { loading: () => <TabLoadingPlaceholder />, ssr: false }
);

const CalendarTab = dynamic(
  () => import("./calendar-tab").then((m) => ({ default: m.CalendarTab })),
  { loading: () => <TabLoadingPlaceholder />, ssr: false }
);

function TabLoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="animate-spin size-5 text-primary" />
    </div>
  );
}

import type { InstallationWithRelations } from "@/app/(app)/installations/actions";
import type { KioskListItem } from "@/app/(app)/kiosks/actions";

interface InstallationViewTabsClientProps {
  activeView: string;
  installations: InstallationWithRelations[];
  kiosks: KioskListItem[];
}

export function InstallationViewTabsClient({
  activeView,
  installations,
  kiosks,
}: InstallationViewTabsClientProps) {
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
        <TabsTrigger value="gantt">Gantt</TabsTrigger>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
      </TabsList>

      <div className="relative">
        {isPending && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 pointer-events-none">
            <Loader2 className="animate-spin size-5 text-primary" />
            <span className="sr-only">Loading...</span>
          </div>
        )}
        <div className={isPending ? "opacity-50 pointer-events-none" : undefined}>
          <TabsContent value="table">
            {activeView === "table" && <InstallationTable data={installations} />}
          </TabsContent>
          <TabsContent value="gantt">
            {activeView === "gantt" && <GanttTab installations={installations} />}
          </TabsContent>
          <TabsContent value="calendar">
            {activeView === "calendar" && <CalendarTab installations={installations} kiosks={kiosks} />}
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
