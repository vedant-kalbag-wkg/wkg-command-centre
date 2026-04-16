"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Info } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KioskCard } from "@/components/kiosks/kiosk-card";
import { KioskDetailSheet } from "@/components/kiosks/kiosk-detail-sheet";
import { ManageStagesModal } from "@/components/pipeline/manage-stages-modal";
import { updateKioskField } from "@/app/(app)/kiosks/actions";
import type { KioskListItem } from "@/app/(app)/kiosks/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PipelineStage = {
  id: string;
  name: string;
  position: number;
  color: string | null;
  isDefault: boolean;
};

interface KioskKanbanProps {
  kiosks: KioskListItem[];
  stages: PipelineStage[];
}

// ---------------------------------------------------------------------------
// Grouping options
// ---------------------------------------------------------------------------

const GROUPING_OPTIONS = [
  { value: "pipelineStageId", label: "Pipeline Stage" },
  { value: "regionGroup", label: "Region" },
  { value: "hotelGroup", label: "Hotel Group" },
  { value: "cmsConfigStatus", label: "CMS Config" },
] as const;

type GroupByValue = (typeof GROUPING_OPTIONS)[number]["value"];

const GROUPING_SELECT_ITEMS = GROUPING_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

// ---------------------------------------------------------------------------
// DroppableColumn wrapper
// ---------------------------------------------------------------------------

interface DroppableColumnProps {
  id: string;
  children: React.ReactNode;
}

function DroppableColumn({ id, children }: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={isOver ? "ring-2 ring-wk-azure ring-inset rounded-lg" : ""}
      style={{ minHeight: "100px" }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KioskKanban
// ---------------------------------------------------------------------------

export function KioskKanban({ kiosks: initialKiosks, stages }: KioskKanbanProps) {
  const router = useRouter();
  const [groupBy, setGroupBy] = React.useState<GroupByValue>("pipelineStageId");
  const [localKiosks, setLocalKiosks] = React.useState<KioskListItem[]>(initialKiosks);
  const [activeKioskId, setActiveKioskId] = React.useState<string | null>(null);
  const [selectedKioskId, setSelectedKioskId] = React.useState<string | null>(null);
  const [manageStagesOpen, setManageStagesOpen] = React.useState(false);

  const isDragEnabled = groupBy === "pipelineStageId";

  // Sync external kiosks into local state
  React.useEffect(() => {
    setLocalKiosks(initialKiosks);
  }, [initialKiosks]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts (allows click)
      },
    })
  );

  // ---------------------------------------------------------------------------
  // Build columns based on current groupBy
  // ---------------------------------------------------------------------------

  const columns = React.useMemo(() => {
    if (groupBy === "pipelineStageId") {
      // Order by stage position
      const sortedStages = [...stages].sort((a, b) => a.position - b.position);
      return sortedStages.map((stage) => ({
        id: stage.id,
        label: stage.name,
        color: stage.color,
        kiosks: localKiosks.filter((k) => k.pipelineStageId === stage.id),
      }));
    }

    // Generic grouping by field
    const field = groupBy as keyof KioskListItem;
    const groupMap = new Map<string, KioskListItem[]>();

    for (const kiosk of localKiosks) {
      const rawValue = kiosk[field];
      const key = rawValue !== null && rawValue !== undefined
        ? String(rawValue)
        : "— Not set —";
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(kiosk);
    }

    return Array.from(groupMap.entries()).map(([key, ks]) => ({
      id: key,
      label: key,
      color: null as string | null,
      kiosks: ks,
    }));
  }, [groupBy, stages, localKiosks]);

  // ---------------------------------------------------------------------------
  // Drag handlers
  // ---------------------------------------------------------------------------

  const activeKiosk = activeKioskId
    ? localKiosks.find((k) => k.id === activeKioskId)
    : null;

  const selectedKiosk = selectedKioskId
    ? localKiosks.find((k) => k.id === selectedKioskId) ?? null
    : null;

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveKioskId(event.active.id as string);
  }, []);

  const handleDragEnd = React.useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveKioskId(null);

    if (!over) return;
    if (!isDragEnabled) return;

    const kioskId = active.id as string;
    const newStageId = over.id as string;

    // Find the kiosk being moved
    const kiosk = localKiosks.find((k) => k.id === kioskId);
    if (!kiosk) return;

    const oldStageId = kiosk.pipelineStageId;

    // No-op if same column
    if (oldStageId === newStageId) return;

    // Find stage name for optimistic update
    const newStage = stages.find((s) => s.id === newStageId);
    if (!newStage) return;

    // Optimistic update
    setLocalKiosks((prev) =>
      prev.map((k) =>
        k.id === kioskId
          ? {
              ...k,
              pipelineStageId: newStageId,
              pipelineStageName: newStage.name,
              pipelineStageColor: newStage.color,
            }
          : k
      )
    );

    // Server action
    const result = await updateKioskField(kioskId, "pipelineStageId", newStageId, oldStageId ?? undefined);

    if ("error" in result) {
      // Revert optimistic update
      setLocalKiosks((prev) =>
        prev.map((k) =>
          k.id === kioskId
            ? {
                ...k,
                pipelineStageId: oldStageId,
                pipelineStageName: kiosk.pipelineStageName,
                pipelineStageColor: kiosk.pipelineStageColor,
              }
            : k
        )
      );
      toast.error("Couldn't update stage. Try again.");
    }
  }, [localKiosks, isDragEnabled, stages]);

  const handleStagesChange = React.useCallback(() => {
    router.refresh();
  }, [router]);

  const handleSheetClose = React.useCallback((open: boolean) => {
    if (!open) setSelectedKioskId(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Header bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-wk-night-grey">Group by:</span>
          <Select
            value={groupBy}
            onValueChange={(v) => setGroupBy((v ?? "pipelineStageId") as GroupByValue)}
            items={GROUPING_SELECT_ITEMS}
          >
            <SelectTrigger className="w-[160px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUPING_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isDragEnabled && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-sm"
            onClick={() => setManageStagesOpen(true)}
          >
            Manage Stages
          </Button>
        )}
      </div>

      {/* Info banner for non-stage grouping */}
      {!isDragEnabled && (
        <div className="flex items-center gap-2 px-3 py-2 bg-wk-sky-blue border-l-2 border-wk-azure rounded-r text-sm text-wk-graphite">
          <Info className="h-4 w-4 text-wk-azure flex-shrink-0" />
          Switch to stage grouping to drag cards
        </div>
      )}

      {/* Kanban board */}
      <DndContext
        id="kiosk-kanban-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
          {columns.map((column) => (
            <div key={column.id} className="flex-shrink-0 w-[260px] flex flex-col gap-2">
              {/* Column header */}
              <div className="flex items-center gap-2 px-1">
                {column.color && (
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: column.color }}
                  />
                )}
                <span className="text-sm font-medium text-wk-graphite flex-1 truncate">
                  {column.label}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {column.kiosks.length}
                </Badge>
              </div>

              {/* Column cards */}
              <DroppableColumn id={column.id}>
                <SortableContext
                  items={column.kiosks.map((k) => k.id)}
                  strategy={verticalListSortingStrategy}
                  disabled={!isDragEnabled}
                >
                  <ScrollArea className="max-h-[calc(100vh-280px)]">
                    <div className="flex flex-col gap-2 p-1">
                      {column.kiosks.length === 0 ? (
                        <div className="flex items-center justify-center py-8">
                          <span className="text-xs text-wk-mid-grey">
                            No kiosks in this stage
                          </span>
                        </div>
                      ) : (
                        column.kiosks.map((kiosk) => (
                          <KioskCard
                            key={kiosk.id}
                            id={kiosk.id}
                            kioskId={kiosk.kioskId}
                            venueName={kiosk.venueName}
                            regionGroup={kiosk.regionGroup}
                            cmsConfigStatus={kiosk.cmsConfigStatus}
                            onSelect={setSelectedKioskId}
                          />
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </SortableContext>
              </DroppableColumn>
            </div>
          ))}
        </div>

        {/* DragOverlay — ghost card while dragging */}
        <DragOverlay>
          {activeKiosk && (
            <div className="w-[260px]">
              <KioskCard
                id={activeKiosk.id}
                kioskId={activeKiosk.kioskId}
                venueName={activeKiosk.venueName}
                regionGroup={activeKiosk.regionGroup}
                cmsConfigStatus={activeKiosk.cmsConfigStatus}
                isGhost={true}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Manage Stages Modal — outside DndContext to avoid nesting */}
      <ManageStagesModal
        open={manageStagesOpen}
        onOpenChange={setManageStagesOpen}
        stages={stages}
        onStagesChange={handleStagesChange}
      />

      {/* Kiosk detail sheet — opens when a card is clicked */}
      <KioskDetailSheet
        kiosk={selectedKiosk}
        open={!!selectedKioskId}
        onOpenChange={handleSheetClose}
      />
    </div>
  );
}
