"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { archiveKiosk } from "@/app/(app)/kiosks/actions";

interface KioskDetailActionsProps {
  kioskId: string;
}

export function KioskDetailActions({ kioskId }: KioskDetailActionsProps) {
  const router = useRouter();
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleArchive() {
    startTransition(async () => {
      const result = await archiveKiosk(kioskId);
      if ("error" in result) {
        toast.error(result.error ?? "Couldn't archive kiosk. Try again.");
      } else {
        toast.success("Kiosk archived");
        router.push("/kiosks");
      }
    });
  }

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setShowArchiveDialog(true)}
      >
        <Archive className="size-4" />
        Archive kiosk
      </Button>

      <Dialog
        open={showArchiveDialog}
        onOpenChange={(open) => {
          if (!open) setShowArchiveDialog(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this kiosk?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This kiosk will be hidden from all views. You can restore it by
            filtering for archived records.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowArchiveDialog(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleArchive}
              disabled={isPending}
            >
              {isPending ? "Archiving…" : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
