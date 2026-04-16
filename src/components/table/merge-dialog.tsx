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
  ) => Promise<{ success: true; merged: number } | { error: string }>;
  onSuccess: () => void;
  entityLabel?: string;
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
      if ("error" in result) {
        toast.error(result.error);
      } else {
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

  if (records.length < 2) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Merge {records.length} {entityLabel}s</DialogTitle>
          <DialogDescription>
            Pick the canonical record to keep. Source records will be archived
            and all references re-pointed.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Pick canonical */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Keep this record</Label>
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
                      ? "border-[#00A6D3] bg-[#00A6D3]/5"
                      : "border-border hover:border-[#00A6D3]/40",
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
                              ? "border-[#00A6D3] bg-[#00A6D3]/10 text-[#00A6D3]"
                              : "border-border hover:border-[#00A6D3]/40",
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

        {/* Summary */}
        {targetRecord && (
          <div className="border-t pt-3">
            <p className="text-sm text-muted-foreground">
              <strong>{sourceIds.length}</strong> {entityLabel}(s) will be merged
              into <strong>{getName(targetRecord)}</strong>.
              {conflicts.length === 0 && " No field conflicts detected."}
            </p>
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
            className="bg-[#00A6D3] hover:bg-[#00A6D3]/90 text-white"
          >
            {isSubmitting && <Loader2 className="size-4 animate-spin mr-1.5" />}
            Merge {entityLabel}s
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
