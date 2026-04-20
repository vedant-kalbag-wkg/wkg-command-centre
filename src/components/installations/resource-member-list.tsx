"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, Plus, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  addInstallationMember,
  removeInstallationMember,
} from "@/app/(app)/installations/actions";
import type { InstallationMemberRecord } from "@/app/(app)/installations/actions";

// ---------------------------------------------------------------------------
// Role helpers
// ---------------------------------------------------------------------------

const roleLabels: Record<string, string> = {
  project_lead: "Project Lead",
  installer: "Installer",
  coordinator: "Coordinator",
};

const roleItems = [
  { value: "project_lead", label: "Project Lead" },
  { value: "installer", label: "Installer" },
  { value: "coordinator", label: "Coordinator" },
];

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant="outline" className="text-xs font-normal text-muted-foreground border-border">
      {roleLabels[role] ?? role}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// ResourceMemberList
// ---------------------------------------------------------------------------

interface UserOption {
  id: string;
  name: string;
  email: string;
}

interface ResourceMemberListProps {
  members: InstallationMemberRecord[];
  installationId: string;
  availableUsers: UserOption[];
}

export function ResourceMemberList({
  members,
  installationId,
  availableUsers,
}: ResourceMemberListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState<"project_lead" | "installer" | "coordinator">("installer");

  // Filter out already-added members
  const memberIds = new Set(members.map((m) => m.userId));
  const availableToAdd = availableUsers.filter((u) => !memberIds.has(u.id));

  const userItems = availableToAdd.map((u) => ({
    value: u.id,
    label: u.name || u.email,
  }));

  function handleAdd() {
    if (!selectedUserId) return;
    startTransition(async () => {
      const result = await addInstallationMember({
        installationId,
        userId: selectedUserId,
        role: selectedRole,
      });
      if ("error" in result) {
        toast.error("Couldn't add team member. Try again.");
      } else {
        toast.success("Team member added");
        setOpen(false);
        setSelectedUserId("");
        setSelectedRole("installer");
        router.refresh();
      }
    });
  }

  function handleRemove(userId: string) {
    startTransition(async () => {
      const result = await removeInstallationMember(installationId, userId);
      if ("error" in result) {
        toast.error("Couldn't remove team member. Try again.");
      } else {
        toast.success("Team member removed");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Member list */}
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No team members yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between py-2.5">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {member.userName}
                </span>
                <RoleBadge role={member.role} />
              </div>
              <button
                type="button"
                onClick={() => handleRemove(member.userId)}
                disabled={isPending}
                className="p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                aria-label={`Remove ${member.userName}`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add member popover */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="flex items-center gap-1.5 text-sm text-primary hover:underline"
          onClick={() => setOpen(!open)}
        >
          <Plus className="h-4 w-4" />
          Add member
        </PopoverTrigger>
        <PopoverContent className="w-72 p-4" align="start">
          <div className="flex flex-col gap-3">
            <h4 className="text-sm font-semibold text-foreground">Add team member</h4>

            {availableToAdd.length === 0 ? (
              <p className="text-sm text-muted-foreground">All users have been added.</p>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">User</Label>
                  <Select
                    value={selectedUserId}
                    items={userItems}
                    onValueChange={(v) => { if (v) setSelectedUserId(v); }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select user" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableToAdd.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name || u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Role</Label>
                  <Select
                    value={selectedRole}
                    items={roleItems}
                    onValueChange={(v) => {
                      if (v) setSelectedRole(v as typeof selectedRole);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roleItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAdd}
                    disabled={!selectedUserId || isPending}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Adding…
                      </>
                    ) : (
                      "Add member"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
