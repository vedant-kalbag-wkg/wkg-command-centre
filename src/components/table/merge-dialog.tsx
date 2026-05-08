"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// =============================================================================
// Types
// =============================================================================

interface MergeField {
  key: string;
  label: string;
}

interface MergeDialogProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  records: T[];
  fields: MergeField[];
  getFieldValue: (record: T, key: string) => string;
  getId: (record: T) => string;
  getName: (record: T) => string;
  onMerge: (
    targetId: string,
    sourceIds: string[],
    resolutions: Record<string, unknown>
  ) => Promise<
    | { success: true; merged: number }
    | { error: string }
    | { status: "lock_contention" }
  >;
  onSuccess: () => void;
  entityLabel?: string;
  // Phase 7 Plan 07-03 — sentinel triage mode (DATA-04 D-07).
  // When true, swap dialog copy + consequences bullets to the "Reassign N
  // orphan kiosks" flow that lifts records off LOCATION_NEEDED. The merge
  // primitive is the same; only the framing changes.
  isSentinelTriage?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function MergeDialog<T>({
  open,
  onOpenChange,
  records,
  fields,
  getFieldValue,
  getId,
  getName,
  onMerge,
  onSuccess,
  entityLabel = "record",
  isSentinelTriage = false,
}: MergeDialogProps<T>) {
  const [targetId, setTargetId] = React.useState<string>("");
  const [resolutions, setResolutions] = React.useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Reset when dialog opens with new records
  React.useEffect(() => {
    if (open && records.length > 0) {
      setTargetId(getId(records[0]));
      setResolutions({});
    }
  }, [open, records, getId]);

  // Detect conflicting fields
  const conflicts = React.useMemo(() => {
    if (records.length < 2) return [];
    return fields.filter((field) => {
      const values = records.map((r) => getFieldValue(r, field.key)).filter(Boolean);
      const unique = [...new Set(values)];
      return unique.length > 1;
    });
  }, [records, fields, getFieldValue]);

  // Pre-select target's values for conflicts
  React.useEffect(() => {
    if (!targetId || conflicts.length === 0) return;
    const target = records.find((r) => getId(r) === targetId);
    if (!target) return;
    const initial: Record<string, string> = {};
    for (const c of conflicts) {
      initial[c.key] = getFieldValue(target, c.key);
    }
    setResolutions(initial);
  }, [targetId, conflicts, records, getId, getFieldValue]);

  const sourceIds = records.filter((r) => getId(r) !== targetId).map(getId);
  const targetRecord = records.find((r) => getId(r) === targetId);

  async function handleConfirm() {
    if (!targetId || sourceIds.length === 0) return;
    setIsSubmitting(true);
    try {
      const result = await onMerge(targetId, sourceIds, resolutions);
      if ("status" in result && result.status === "lock_contention") {
        toast.error(
          "Another merge is in progress. Wait a moment and try again.",
        );
        return;
      }
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if ("success" in result) {
        toast.success(`Merged ${result.merged} ${entityLabel}(s)`);
        onOpenChange(false);
        onSuccess();
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Sentinel-triage mode runs with N>=1 (one orphan kiosk row + one
  // destination location); default merge mode keeps the N>=2 contract.
  const minRecords = isSentinelTriage ? 1 : 2;
  if (records.length < minRecords) return null;

  // Copy bank — picks the right strings per mode. Centralised here so the
  // JSX below stays declarative; UI-SPEC Surface 2 + 3 lock these literals.
  const dialogTitle = isSentinelTriage
    ? `Reassign ${sourceIds.length} orphan kiosks`
    : `Merge ${records.length} ${entityLabel}s`;
  const dialogDescription = isSentinelTriage
    ? "Pick the real location to move these kiosks to. Their sales records will follow."
    : "Pick the canonical record to keep. Source records will be archived and all references re-pointed.";
  const pickerLabel = isSentinelTriage
    ? "Assign to this location"
    : "Keep this record";
  const confirmCta = isSentinelTriage ? "Reassign kiosks" : "Merge locations";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        {/* Step 1: Pick canonical */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">{pickerLabel}</Label>
          <div className="space-y-1.5">
            {records.map((record) => {
              const id = getId(record);
              const isSelected = id === targetId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTargetId(id)}
                  className={[
                    "w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40",
                  ].join(" ")}
                >
                  <span className="font-medium">{getName(record)}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {isSelected ? "(canonical)" : "(will be archived)"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Resolve conflicts */}
        {conflicts.length > 0 && (
          <div className="space-y-3 border-t pt-4">
            <Label className="text-sm font-medium">
              Resolve {conflicts.length} field conflict{conflicts.length > 1 ? "s" : ""}
            </Label>
            {conflicts.map((field) => {
              const distinctValues = [
                ...new Set(
                  records.map((r) => getFieldValue(r, field.key)).filter(Boolean)
                ),
              ];
              return (
                <div key={field.key} className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    {field.label}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {distinctValues.map((val) => {
                      const isSelected = resolutions[field.key] === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() =>
                            setResolutions((prev) => ({ ...prev, [field.key]: val }))
                          }
                          className={[
                            "px-2.5 py-1 rounded-md border text-xs transition-colors",
                            isSelected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:border-primary/40",
                          ].join(" ")}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Consequences preview — Phase 7 Plan 07-03 (UI-SPEC Surface 2/3).
            Shown once a canonical/destination record is selected. Bullet copy
            differs between merge mode and sentinel-triage reassign mode. */}
        {targetRecord && (
          <div className="bg-muted/30 rounded-lg p-3 space-y-2">
            <p className="text-sm font-bold tracking-[-0.01em]">
              What will happen
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {isSentinelTriage ? (
                <>
                  <li>
                    {sourceIds.length} kiosk
                    {sourceIds.length === 1 ? "" : "s"} will be moved to{" "}
                    {getName(targetRecord)}
                  </li>
                  <li>Sales records re-attributed to {getName(targetRecord)}</li>
                  <li>LOCATION_NEEDED sentinel survives un-archived</li>
                  <li>A snapshot of original data will be saved to audit log</li>
                </>
              ) : (
                <>
                  <li>
                    {sourceIds.length} location
                    {sourceIds.length === 1 ? "" : "s"} will be archived
                  </li>
                  <li>
                    All kiosk assignments re-pointed to {getName(targetRecord)}
                  </li>
                  <li>
                    All sales records re-attributed to {getName(targetRecord)}
                  </li>
                  <li>A snapshot of original data will be saved to audit log</li>
                </>
              )}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSubmitting || !targetId}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold tracking-[-0.01em]"
          >
            {isSubmitting && <Loader2 className="size-4 animate-spin mr-1.5" />}
            {confirmCta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
