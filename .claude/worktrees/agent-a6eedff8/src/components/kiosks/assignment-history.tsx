"use client";

import { ArrowRightLeft } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface AssignmentEntry {
  id: string;
  locationId: string;
  locationName: string;
  assignedAt: Date;
  unassignedAt: Date | null;
  reason: string | null;
  assignedByName: string;
}

interface AssignmentHistoryProps {
  history: AssignmentEntry[];
}

export function AssignmentHistory({ history }: AssignmentHistoryProps) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-wk-night-grey">
        No previous venues. This kiosk has only been at its current location.
      </p>
    );
  }

  // Sort reverse chronological (most recent first)
  const sorted = [...history].sort(
    (a, b) => b.assignedAt.getTime() - a.assignedAt.getTime()
  );

  return (
    <div className="space-y-3">
      {sorted.map((entry, index) => {
        const isCurrent = entry.unassignedAt === null;
        return (
          <div key={entry.id} className="flex gap-3">
            {/* Timeline line */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                  isCurrent ? "bg-wk-azure text-white" : "bg-wk-light-grey text-wk-night-grey"
                )}
              >
                <ArrowRightLeft className="h-3 w-3" />
              </div>
              {index < sorted.length - 1 && (
                <div className="mt-1 h-full w-px bg-wk-mid-grey" />
              )}
            </div>

            {/* Content */}
            <div className="pb-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-wk-graphite">
                  {entry.locationName}
                </span>
                {isCurrent && (
                  <span className="rounded-full bg-wk-azure-20 px-2 py-0.5 text-[11px] font-medium text-wk-azure">
                    Current
                  </span>
                )}
              </div>
              <p className="text-[12px] text-wk-night-grey">
                {format(new Date(entry.assignedAt), "dd MMM yyyy")}
                {" — "}
                {entry.unassignedAt
                  ? format(new Date(entry.unassignedAt), "dd MMM yyyy")
                  : "Present"}
              </p>
              {entry.reason && (
                <p className="mt-0.5 text-[12px] text-wk-night-grey">
                  Reason: {entry.reason}
                </p>
              )}
              <p className="mt-0.5 text-[11px] text-wk-mid-grey">
                Assigned by {entry.assignedByName}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
