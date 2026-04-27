"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { MultiSelectFilter } from "@/components/analytics/multi-select-filter";
import { setConfigGroupMembers } from "@/app/(app)/kiosk-config-groups/actions";

type LocationOption = {
  id: string;
  name: string;
  outletCode: string | null;
};

interface Props {
  groupId: string;
  groupName: string;
  initialMembers: LocationOption[];
  candidates: LocationOption[];
}

// Phase 7.6b — bulk member-management for a kiosk config group. Server
// action diffs requested vs current and audit-logs each move; this client
// holds the in-progress selection so admins can chip in/out before
// committing.
export function ConfigGroupMembersClient({
  groupId,
  groupName,
  initialMembers,
  candidates,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The picker offers the union of "current members" and "candidates from
  // outside the group" so the operator can both add and remove from one
  // list. Initial selection = current members.
  const allOptions: LocationOption[] = [...initialMembers, ...candidates].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(
    initialMembers.map((m) => m.id),
  );

  const initialIdSet = new Set(initialMembers.map((m) => m.id));
  const isDirty = (() => {
    if (selectedIds.length !== initialIdSet.size) return true;
    return selectedIds.some((id) => !initialIdSet.has(id));
  })();

  function handleSave() {
    startTransition(async () => {
      setError(null);
      const result = await setConfigGroupMembers(groupId, selectedIds);
      if ("error" in result) {
        setError(result.error ?? "Failed to update members");
        return;
      }
      toast.success(
        `${groupName}: +${result.addedCount} / −${result.removedCount}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-md border border-border p-4 space-y-3">
        <h2 className="text-sm font-medium">Members</h2>
        <MultiSelectFilter
          label="Locations"
          options={allOptions.map((o) => ({
            value: o.id,
            label: o.outletCode ? `${o.outletCode} — ${o.name}` : o.name,
          }))}
          selected={selectedIds}
          onChange={setSelectedIds}
          placeholder="Search locations…"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedIds.length} location{selectedIds.length === 1 ? "" : "s"}
            {" "}selected
          </span>
          <Button size="sm" onClick={handleSave} disabled={isPending || !isDirty}>
            {isPending ? "Saving…" : "Save members"}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="rounded-md border border-border p-4 space-y-2">
        <h2 className="text-sm font-medium">Current members ({initialMembers.length})</h2>
        {initialMembers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No locations assigned.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {initialMembers.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/locations/${m.id}`}
                  className="hover:underline"
                >
                  {m.outletCode ? `${m.outletCode} — ` : ""}
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
