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
import { deleteUser, bulkDeleteUsers } from "@/app/(app)/settings/users/actions";
import type { UserListItem } from "@/app/(app)/settings/users/actions";

interface DeleteUserDialogProps {
  users: UserListItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function DeleteUserDialog({
  users,
  open,
  onOpenChange,
  onSuccess,
}: DeleteUserDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isBulk = users.length > 1;
  const displayName = isBulk
    ? `${users.length} users`
    : users[0]?.name || users[0]?.email || "this user";

  async function handleConfirm() {
    setIsSubmitting(true);
    try {
      if (isBulk) {
        const result = await bulkDeleteUsers(users.map((u) => u.id));
        if ("error" in result) {
          toast.error(result.error);
        } else {
          toast.success(`Deleted ${result.count} users`);
          onOpenChange(false);
          onSuccess();
        }
      } else {
        const result = await deleteUser(users[0].id);
        if ("error" in result) {
          toast.error(result.error);
        } else {
          toast.success(`${displayName} has been permanently deleted`);
          onOpenChange(false);
          onSuccess();
        }
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
          <DialogTitle>Delete {isBulk ? "users" : "user"}</DialogTitle>
          <DialogDescription>
            Permanently delete {displayName}? This action cannot be undone.
            All associated data will be removed.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Delete {isBulk ? `${users.length} users` : "user"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
