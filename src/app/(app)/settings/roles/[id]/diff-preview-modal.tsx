"use client";

import * as React from "react";
import { Loader2, Plus, Minus, RefreshCw } from "lucide-react";
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
import { replaceRolePermissions } from "../actions";
import type { RawRule } from "@/lib/casl/types";

type Diff = {
  added: RawRule[];
  removed: RawRule[];
  changed: { before: RawRule; after: RawRule }[];
};

function RuleLabel({ rule }: { rule: RawRule }) {
  const actions = Array.isArray(rule.action)
    ? (rule.action as string[]).join(", ")
    : String(rule.action);
  const subject = String(rule.subject);
  const inverted = rule.inverted ? " [DENY]" : " [ALLOW]";
  return (
    <span className="font-mono text-xs">
      {actions} {subject}
      {inverted}
      {rule.fields && rule.fields.length > 0
        ? ` [fields: ${rule.fields.join(", ")}]`
        : ""}
    </span>
  );
}

export function DiffPreviewModal({
  open,
  onOpenChange,
  roleId,
  diff,
  newRules,
  assignedUserCount,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  roleId: string;
  diff: Diff;
  newRules: RawRule[];
  assignedUserCount: number;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  async function handleConfirm() {
    setIsSubmitting(true);
    try {
      const result = await replaceRolePermissions(roleId, newRules);
      if ("status" in result && result.status === "lockout_prevention") {
        toast.error(
          "This change would leave the system with no effective admin. " +
            "Assign Admin (or a role that grants 'manage all') to at least one user before continuing.",
        );
        return;
      }
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if ("success" in result) {
        toast.success(`Saved. ${result.impactedUserCount} user(s) impacted.`);
      }
      onSuccess();
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  const totalChanges =
    diff.added.length + diff.removed.length + diff.changed.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Confirm rule changes</DialogTitle>
          <DialogDescription>
            {diff.added.length} added, {diff.removed.length} removed,{" "}
            {diff.changed.length} changed.{" "}
            {assignedUserCount} user(s) impacted — changes take effect on their next request.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-96 overflow-y-auto">
          {totalChanges === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No changes detected.
            </p>
          )}

          {diff.added.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Plus className="size-3.5 text-green-600" />
                <span className="text-sm font-medium text-green-700">
                  Added ({diff.added.length})
                </span>
              </div>
              <ul className="space-y-1">
                {diff.added.map((rule, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded bg-green-50 dark:bg-green-950/30 px-2 py-1.5"
                  >
                    <Plus className="size-3 text-green-600 mt-0.5 shrink-0" />
                    <RuleLabel rule={rule} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {diff.removed.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Minus className="size-3.5 text-destructive" />
                <span className="text-sm font-medium text-destructive">
                  Removed ({diff.removed.length})
                </span>
              </div>
              <ul className="space-y-1">
                {diff.removed.map((rule, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded bg-red-50 dark:bg-red-950/30 px-2 py-1.5"
                  >
                    <Minus className="size-3 text-destructive mt-0.5 shrink-0" />
                    <RuleLabel rule={rule} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {diff.changed.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <RefreshCw className="size-3.5 text-amber-600" />
                <span className="text-sm font-medium text-amber-700">
                  Changed ({diff.changed.length})
                </span>
              </div>
              <ul className="space-y-2">
                {diff.changed.map(({ before, after }, i) => (
                  <li
                    key={i}
                    className="rounded border border-amber-200 dark:border-amber-800 overflow-hidden"
                  >
                    <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/30 px-2 py-1.5">
                      <Minus className="size-3 text-destructive mt-0.5 shrink-0" />
                      <RuleLabel rule={before} />
                    </div>
                    <div className="flex items-start gap-2 bg-green-50 dark:bg-green-950/30 px-2 py-1.5">
                      <Plus className="size-3 text-green-600 mt-0.5 shrink-0" />
                      <RuleLabel rule={after} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

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
            disabled={isSubmitting || totalChanges === 0}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
