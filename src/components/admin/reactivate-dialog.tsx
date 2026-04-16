"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { reactivateUser } from "@/app/(app)/settings/users/actions";
import type { UserListItem } from "@/app/(app)/settings/users/actions";

interface ReactivateDialogProps {
  user: UserListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ReactivateDialog({
  user,
  open,
  onOpenChange,
  onSuccess,
}: ReactivateDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayName = user.name || user.email;

  async function handleConfirm() {
    setIsSubmitting(true);
    try {
      const result = await reactivateUser(user.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`${displayName} has been reactivated`);
        onOpenChange(false);
        onSuccess();
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Reactivate user</DialogTitle>
          <DialogDescription>
            Reactivate {displayName}? They will regain access to the system
            with their previous role and permissions.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="bg-wk-azure text-white hover:bg-wk-azure/90"
          >
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Reactivate user
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
