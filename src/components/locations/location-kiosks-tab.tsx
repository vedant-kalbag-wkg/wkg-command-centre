"use client";

import Link from "next/link";
import { format } from "date-fns";

type KioskAssignment = {
  assignmentId: string;
  kioskId: string;
  kioskDisplayId: string;
  pipelineStageId: string | null;
  assignedAt: Date;
  unassignedAt: Date | null;
  reason: string | null;
  assignedByName: string;
};

interface LocationKiosksTabProps {
  assignments: KioskAssignment[];
}

export function LocationKiosksTab({ assignments }: LocationKiosksTabProps) {
  if (assignments.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">No kiosks assigned.</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Kiosks assigned to this location will appear here.
        </p>
      </div>
    );
  }

  // Sort: current assignments first, then historical by assigned date desc
  const sorted = [...assignments].sort((a, b) => {
    if (!a.unassignedAt && b.unassignedAt) return -1;
    if (a.unassignedAt && !b.unassignedAt) return 1;
    return new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime();
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="pb-3 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              Kiosk ID
            </th>
            <th className="pb-3 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </th>
            <th className="pb-3 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              Assigned Date
            </th>
            <th className="pb-3 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              Unassigned Date
            </th>
            <th className="pb-3 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              Reason
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => (
            <tr
              key={a.assignmentId}
              className="border-b border-border hover:bg-muted/50"
            >
              <td className="py-3 pr-4">
                <Link
                  href={`/kiosks/${a.kioskId}`}
                  className="font-medium text-primary hover:underline"
                >
                  {a.kioskDisplayId}
                </Link>
              </td>
              <td className="py-3 pr-4">
                {!a.unassignedAt ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-primary" />
                    <span className="text-foreground">Current</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-border" />
                    <span className="text-muted-foreground">Historical</span>
                  </span>
                )}
              </td>
              <td className="py-3 pr-4 text-foreground">
                {format(new Date(a.assignedAt), "dd MMM yyyy")}
              </td>
              <td className="py-3 pr-4 text-foreground">
                {a.unassignedAt
                  ? format(new Date(a.unassignedAt), "dd MMM yyyy")
                  : <span className="text-muted-foreground">Current</span>}
              </td>
              <td className="py-3 text-muted-foreground">
                {a.reason ?? <span className="text-muted-foreground">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
