import type { InstallationWithRelations } from "@/app/(app)/installations/actions";
import { REGION_COLORS } from "@/lib/region-colors";

// ---------------------------------------------------------------------------
// GanttTask — matches @svar-ui/react-gantt task shape
// ---------------------------------------------------------------------------

export interface GanttTask {
  id: string;
  text: string;
  start?: Date;
  end?: Date;
  duration?: number;
  type: "task" | "milestone" | "summary";
  parent?: string;
  open?: boolean;
  color?: string;
  // Custom data for resource column
  members?: { userId: string; userName: string; role: string }[];
}

// ---------------------------------------------------------------------------
// Scale presets for zoom levels
// ---------------------------------------------------------------------------

export const GANTT_SCALES: Record<
  "day" | "week" | "month",
  Array<{ unit: string; step: number; format: string }>
> = {
  day: [
    { unit: "month", step: 1, format: "%F %Y" },
    { unit: "day", step: 1, format: "%d" },
  ],
  week: [
    { unit: "month", step: 1, format: "%F %Y" },
    { unit: "week", step: 1, format: "Week %W" },
  ],
  month: [
    { unit: "year", step: 1, format: "%Y" },
    { unit: "month", step: 1, format: "%F" },
  ],
};

// ---------------------------------------------------------------------------
// buildGanttTasks — transforms installations into hierarchical Gantt rows
// ---------------------------------------------------------------------------

/**
 * Transforms a flat list of installations into a hierarchical task array
 * suitable for @svar-ui/react-gantt.
 *
 * Structure produced:
 *   Summary (group header) — one per region/status value
 *     Task (installation bar) — child of group; has start/end dates
 *       Milestone (diamond marker) — child of installation
 *
 * Installations without plannedStart OR plannedEnd are excluded from Gantt
 * (they have no timeline to render).
 */
export function buildGanttTasks(
  installations: InstallationWithRelations[],
  groupBy: "region" | "status"
): GanttTask[] {
  // Filter out installations with no date range
  const dated = installations.filter(
    (i) => i.plannedStart != null && i.plannedEnd != null
  );

  // Group installations by the selected field
  const groups = new Map<string, InstallationWithRelations[]>();
  for (const inst of dated) {
    const key =
      groupBy === "region"
        ? (inst.region ?? "No Region")
        : capitaliseStatus(inst.status);
    const existing = groups.get(key) ?? [];
    existing.push(inst);
    groups.set(key, existing);
  }

  const tasks: GanttTask[] = [];

  for (const [groupName, items] of groups.entries()) {
    const groupId = `group-${groupBy}-${groupName}`;
    const count = items.length;
    const labelSuffix = count === 1 ? "installation" : "installations";

    // Summary row — collapsible group header
    tasks.push({
      id: groupId,
      text: `${groupName} \u00b7 ${count} ${labelSuffix}`,
      type: "summary",
      open: true,
    });

    for (const inst of items) {
      const regionColor =
        REGION_COLORS[inst.region ?? ""] ?? REGION_COLORS.default;

      // Installation task bar
      // plannedStart/plannedEnd are Date objects from the server action,
      // but when serialised through RSC they become ISO strings — handle both
      const start = inst.plannedStart instanceof Date ? inst.plannedStart : new Date(inst.plannedStart!);
      const end = inst.plannedEnd instanceof Date ? inst.plannedEnd : new Date(inst.plannedEnd!);
      tasks.push({
        id: inst.id,
        text: inst.name,
        start,
        end,
        type: "task",
        parent: groupId,
        color: regionColor,
        members: inst.members.map((m) => ({
          userId: m.userId,
          userName: m.userName,
          role: m.role,
        })),
      });

      // Milestone diamond markers — children of the installation task
      for (const ms of inst.milestones) {
        tasks.push({
          id: ms.id,
          text: ms.name,
          start: ms.targetDate instanceof Date ? ms.targetDate : new Date(ms.targetDate),
          type: "milestone",
          parent: inst.id,
          color: regionColor,
        });
      }
    }
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitaliseStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
