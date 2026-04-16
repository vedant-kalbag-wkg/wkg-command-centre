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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeUserRole } from "@/app/(app)/settings/users/actions";
import type { UserListItem } from "@/app/(app)/settings/users/actions";
import type { Role } from "@/lib/rbac";

interface ChangeRoleDialogProps {
  user: UserListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ChangeRoleDialog({
  user,
  open,
  onOpenChange,
  onSuccess,
}: ChangeRoleDialogProps) {
  const [selectedRole, setSelectedRole] = useState<string>(user.role);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayName = user.name || user.email;
  const roleLabel =
    selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1);

  async function handleConfirm() {
    setIsSubmitting(true);
    try {
      const result = await changeUserRole(user.id, selectedRole as Role);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`${displayName}'s role updated to ${roleLabel}`);
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
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription>
            Change {displayName}&apos;s role to {roleLabel}? This will update
            their permissions immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="change-role-select">New role</Label>
          <Select value={selectedRole} onValueChange={(val) => val && setSelectedRole(val)}>
            <SelectTrigger className="w-full" id="change-role-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Change role
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
