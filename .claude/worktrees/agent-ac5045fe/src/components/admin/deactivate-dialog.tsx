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
import { deactivateUser } from "@/app/(app)/settings/users/actions";
import type { UserListItem } from "@/app/(app)/settings/users/actions";

interface DeactivateDialogProps {
  user: UserListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function DeactivateDialog({
  user,
  open,
  onOpenChange,
  onSuccess,
}: DeactivateDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayName = user.name || user.email;

  async function handleConfirm() {
    setIsSubmitting(true);
    try {
      const result = await deactivateUser(user.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`${displayName} has been deactivated`);
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
          <DialogTitle>Deactivate user</DialogTitle>
          <DialogDescription>
            Deactivate {displayName}? They will lose access immediately. Their
            data and audit history will be preserved.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="bg-[#F41E56] text-white hover:bg-[#D91A4B]"
          >
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Deactivate user
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
