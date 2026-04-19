"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { KioskTable } from "@/components/kiosks/kiosk-table";

const KioskKanban = dynamic(
  () => import("@/components/kiosks/kiosk-kanban").then((m) => ({ default: m.KioskKanban })),
  { loading: () => <TabLoadingPlaceholder />, ssr: false }
);

function TabLoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="animate-spin size-5 text-primary" />
    </div>
  );
}

import type { KioskListItem } from "@/app/(app)/kiosks/actions";

interface ViewTabsClientProps {
  activeView: string;
  kiosks: KioskListItem[];
  stages: {
    id: string;
    name: string;
    position: number;
    color: string | null;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
  }[];
}

export function ViewTabsClient({
  activeView,
  kiosks,
  stages,
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
            {activeView === "table" && <KioskTable data={kiosks} />}
          </TabsContent>
          <TabsContent value="kanban">
            {activeView === "kanban" && <KioskKanban kiosks={kiosks} stages={stages} />}
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
