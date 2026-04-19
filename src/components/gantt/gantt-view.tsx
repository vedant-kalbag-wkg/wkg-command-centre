"use client";

import { useRef, useCallback, useMemo, useEffect } from "react";
import { Gantt, Willow } from "@svar-ui/react-gantt";
import "@svar-ui/react-gantt/style.css";
import Link from "next/link";
import type { InstallationWithRelations } from "@/app/(app)/installations/actions";
import { buildGanttTasks, GANTT_SCALES } from "@/lib/gantt-utils";
import { useGanttStore } from "@/lib/stores/gantt-store";
import { GanttToolbar } from "./gantt-toolbar";
import { GanttPendingBar } from "./gantt-pending-bar";
import { MilestoneQuickAddPopover } from "./milestone-quick-add-popover";

// ---------------------------------------------------------------------------
// Resource cell — renders member names in the Team column
// ---------------------------------------------------------------------------

function ResourceCell({ row }: { row: { members?: { userId: string; userName: string; role: string }[] } }) {
  const members = row.members ?? [];
  if (members.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const displayed = members.slice(0, 2).map((m) => m.userName);
  const extra = members.length > 2 ? ` +${members.length - 2}` : "";
  return (
    <span className="text-xs text-foreground truncate">
      {displayed.join(", ")}
      {extra && <span className="text-muted-foreground">{extra}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function GanttEmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
      <div className="pointer-events-auto text-center">
        <h3 className="text-base font-semibold text-foreground tracking-tight">
          No installations yet
        </h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">
          Create an installation to start planning deployment timelines.
          Installations group your kiosks by project and region.
        </p>
        <Link
          href="/installations/new"
          className="mt-4 inline-flex items-center px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Add installation
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const ganttColumns = [
  { id: "text", header: "Installation", flexgrow: 1, resize: true },
  {
    id: "team",
    header: "Team",
    width: 120,
    resize: false,
    sort: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cell: (row: any) => <ResourceCell row={row} />,
  },
];

// ---------------------------------------------------------------------------
// GanttView
// ---------------------------------------------------------------------------

interface GanttViewProps {
  installations: InstallationWithRelations[];
}

export function GanttView({ installations }: GanttViewProps) {
  const groupBy = useGanttStore((s) => s.groupBy);
  const zoom = useGanttStore((s) => s.zoom);
  const setPendingChange = useGanttStore((s) => s.setPendingChange);
  const pendingChange = useGanttStore((s) => s.pendingChange);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  const installationsRef = useRef(installations);
  useEffect(() => { installationsRef.current = installations; }, [installations]);

  const ganttTasks = useMemo(
    () => buildGanttTasks(installations, groupBy),
    [installations, groupBy]
  );

  const currentScales = GANTT_SCALES[zoom];

  const init = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api: any) => {
      apiRef.current = api;

      // Intercept drag-update:
      // - inProgress=true: drag still in progress — let through so bar visually tracks mouse
      // - inProgress=false/undefined: final drop — capture into pending state and block library save
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api.intercept("update-task", (ev: any) => {
        if (ev.inProgress) return; // allow visual tracking during drag

        // Only intercept task bars (not summary or milestone rows)
        const task = ganttTasks.find((t) => t.id === ev.id);
        if (!task || task.type !== "task") return;

        // Find the original installation to get its name and current dates
        const originalInstallation = installationsRef.current.find((i) => i.id === ev.id);
        if (!originalInstallation) return;

        if (ev.task?.start && ev.task?.end) {
          setPendingChange({
            taskId: ev.id,
            installationName: originalInstallation.name,
            originalStart: originalInstallation.plannedStart instanceof Date
              ? originalInstallation.plannedStart
              : new Date(originalInstallation.plannedStart!),
            originalEnd: originalInstallation.plannedEnd instanceof Date
              ? originalInstallation.plannedEnd
              : new Date(originalInstallation.plannedEnd!),
            newStart: ev.task.start,
            newEnd: ev.task.end,
            duration: ev.task.duration ?? 0,
          });
        }

        return false; // block the library from auto-saving
      });
    },
    [ganttTasks, setPendingChange]
  );

  const hasDatedInstallations = ganttTasks.length > 0;

  return (
    <div className="gantt-wk relative flex flex-col h-[calc(100vh-200px)]">
      <GanttToolbar />

      {/* Milestone quick-add toolbar — visible only when installations exist */}
      {hasDatedInstallations && installations.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-1">
          {installations.slice(0, 3).map((inst) => (
            <MilestoneQuickAddPopover
              key={inst.id}
              installationId={inst.id}
              installationName={inst.name}
            />
          ))}
          {installations.length > 3 && (
            <span className="text-xs text-muted-foreground">
              + {installations.length - 3} more installations
            </span>
          )}
        </div>
      )}

      <div className="flex-1 relative min-h-0">
        <Willow>
          <Gantt
            tasks={ganttTasks}
            scales={currentScales}
            columns={ganttColumns}
            init={init}
            cellHeight={44}
          />
        </Willow>

        {/* Pending state overlay: dashed border styling applied via CSS */}
        {pendingChange && (
          <div
            className="absolute inset-0 pointer-events-none"
            aria-hidden="true"
          />
        )}

        {/* Empty state */}
        {!hasDatedInstallations && <GanttEmptyState />}
      </div>

      {/* Pending change sticky bar */}
      <GanttPendingBar />
    </div>
  );
}
