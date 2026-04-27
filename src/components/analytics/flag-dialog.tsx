"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Flag } from "lucide-react";
import { createFlag } from "@/app/(app)/analytics/flags/actions";
import { createActionItem } from "@/app/(app)/analytics/actions-dashboard/actions";
import { submitFlagWithOptionalAction } from "./flag-dialog-submit";
import type { FlagType } from "@/lib/analytics/types";

interface FlagDialogProps {
  locationId: string;
  locationName: string;
  onFlagCreated?: () => void;
  children?: React.ReactNode;
}

/**
 * FlagDialog — operator's fast path to flag a location and (optionally)
 * spawn a follow-up action item in the same submit. The Flag Review page
 * is the deliberate path for richer review; this dialog is the inline
 * shortcut that lives on every location/heat-map row.
 *
 * The "Also create a linked action item" checkbox replaces the previous
 * XOR "Create Action Instead" button. Operators who already know they
 * want both no longer have to flag, dismiss, and create the action by
 * hand.
 */
export function FlagDialog({
  locationId,
  locationName,
  onFlagCreated,
  children,
}: FlagDialogProps) {
  const [open, setOpen] = useState(false);
  const [flagType, setFlagType] = useState<FlagType>("monitor");
  const [reason, setReason] = useState("");
  const [createLinkedAction, setCreateLinkedAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // The flag-creation call itself isn't wrapped — if it throws, let it
      // bubble up and React's transition error handling will surface it.
      // Only the paired-action failure is recoverable (flag persists).
      const result = await submitFlagWithOptionalAction({
        locationId,
        locationName,
        flagType,
        reason: reason.trim() || undefined,
        createLinkedAction,
        createFlagFn: createFlag,
        createActionItemFn: createActionItem,
      });

      if (!result.ok) {
        setError(`Flag created, but linked action failed: ${result.error}`);
        onFlagCreated?.();
        return;
      }

      setOpen(false);
      setReason("");
      setFlagType("monitor");
      setCreateLinkedAction(false);
      onFlagCreated?.();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          children ? (
            <span />
          ) : (
            <Button variant="ghost" size="icon-sm">
              <Flag className="size-3.5" />
            </Button>
          )
        }
      >
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Flag Location</DialogTitle>
            <DialogDescription>
              Flag <strong>{locationName}</strong> for performance review.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="flag-type">Flag Type</Label>
              <Select
                value={flagType}
                onValueChange={(v) => setFlagType(v as FlagType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="relocate">Relocate</SelectItem>
                  <SelectItem value="monitor">Monitor</SelectItem>
                  <SelectItem value="strategic_exception">
                    Strategic Exception
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="flag-reason">Reason (optional)</Label>
              <Textarea
                id="flag-reason"
                placeholder="Why is this location being flagged?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={createLinkedAction}
                onCheckedChange={(v) => setCreateLinkedAction(Boolean(v))}
                className="mt-0.5"
              />
              <span className="leading-tight">
                Also create a linked action item to follow up
                <span className="block text-xs text-muted-foreground">
                  Auto-titled "Investigate {locationName} — {flagType} flag",
                  type "Investigation". Edit later from the Flag Review page.
                </span>
              </span>
            </label>

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Flagging..." : "Create Flag"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
