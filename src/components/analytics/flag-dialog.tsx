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
import { CreateActionDialog } from "@/components/analytics/create-action-dialog";
import type { FlagType } from "@/lib/analytics/types";

interface FlagDialogProps {
  locationId: string;
  locationName: string;
  onFlagCreated?: () => void;
  children?: React.ReactNode;
}

export function FlagDialog({
  locationId,
  locationName,
  onFlagCreated,
  children,
}: FlagDialogProps) {
  const [open, setOpen] = useState(false);
  const [flagType, setFlagType] = useState<FlagType>("monitor");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      await createFlag({
        locationId,
        flagType,
        reason: reason.trim() || undefined,
      });
      setOpen(false);
      setReason("");
      setFlagType("monitor");
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
          </div>

          <DialogFooter className="mt-4 flex items-center justify-between">
            <CreateActionDialog
              locationId={locationId}
              locationName={locationName}
              sourceType="flag"
              defaultTitle={`Investigate ${locationName} — ${flagType} flag`}
            >
              <Button type="button" variant="outline" size="sm">
                Create Action Instead
              </Button>
            </CreateActionDialog>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Flagging..." : "Create Flag"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
