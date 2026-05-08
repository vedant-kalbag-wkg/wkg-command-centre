"use client";

/**
 * Phase 7 Plan 07-03 — Undo merge button (UI-SPEC Surface 4).
 *
 * Click flow:
 *   - First click ⇒ inline confirmation prompt (no separate dialog).
 *   - Confirm ⇒ invokes `undoMerge(snapshotId)` server action.
 *   - `error: 'snapshot_already_undone'` ⇒ replace button with the locked
 *     copy `Undo no longer available: snapshot deleted` + Lock icon.
 *   - other error ⇒ toast.
 *
 * Bold weight uses `font-bold tracking-[-0.01em]` per WeKnow brand (Circular
 * Pro lacks weight 600 — see UI-SPEC for the locked typography contract).
 */
import * as React from "react";
import { Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { undoMerge } from "./actions/undo-merge";

interface UndoMergeButtonProps {
  snapshotId: string;
}

export function UndoMergeButton({ snapshotId }: UndoMergeButtonProps) {
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [locked, setLocked] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  if (locked) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Lock className="size-3.5" />
        Undo no longer available: {locked}
      </p>
    );
  }

  if (done) {
    return (
      <p className="text-sm font-bold tracking-[-0.01em] text-emerald-700">
        Merge undone. Refresh the page to see updated state.
      </p>
    );
  }

  if (!confirming) {
    return (
      <Button
        variant="destructive"
        onClick={() => setConfirming(true)}
        className="font-bold tracking-[-0.01em]"
      >
        Undo merge
      </Button>
    );
  }

  async function handleConfirm() {
    setPending(true);
    try {
      const result = await undoMerge(snapshotId);
      if ("error" in result) {
        if (result.error === "snapshot_already_undone") {
          setLocked("snapshot deleted");
        } else {
          toast.error(result.error);
        }
        return;
      }
      setDone(true);
      toast.success("Merge undone — locations restored.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to undo merge",
      );
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-bold tracking-[-0.01em]">
        Are you sure? This cannot be further undone.
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="destructive"
          onClick={handleConfirm}
          disabled={pending}
          className="font-bold tracking-[-0.01em]"
        >
          {pending && <Loader2 className="size-4 animate-spin mr-1.5" />}
          Confirm undo
        </Button>
        <Button
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
