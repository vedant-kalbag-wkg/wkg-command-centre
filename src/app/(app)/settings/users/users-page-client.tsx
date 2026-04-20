"use client";

import { useState, useCallback } from "react";
import { UserPlus, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserTable } from "@/components/admin/user-table";
import { InviteUserDialog } from "@/components/admin/invite-user-dialog";
import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import { listUsers } from "@/app/(app)/settings/users/actions";
import type { UserListItem } from "@/app/(app)/settings/users/actions";

interface UsersPageClientProps {
  initialUsers: UserListItem[];
  isAdmin: boolean;
}

export function UsersPageClient({
  initialUsers,
  isAdmin,
}: UsersPageClientProps) {
  const [users, setUsers] = useState<UserListItem[]>(initialUsers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const handleRefresh = useCallback(async () => {
    const result = await listUsers();
    if ("users" in result) {
      setUsers(result.users);
    }
  }, []);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div /> {/* Spacer */}
        <TooltipProvider>
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setCreateOpen(true)}
                className="h-10"
              >
                <UserRoundPlus className="size-4" />
                Create user
              </Button>
              <Button
                onClick={() => setInviteOpen(true)}
                className="h-10"
              >
                <UserPlus className="size-4" />
                Invite user
              </Button>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    disabled
                    className="h-10 cursor-not-allowed"
                  />
                }
              >
                <UserPlus className="size-4" />
                Invite user
              </TooltipTrigger>
              <TooltipContent>
                You don&apos;t have permission to invite users
              </TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>
      </div>

      <UserTable users={users} isAdmin={isAdmin} onRefresh={handleRefresh} />

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSuccess={handleRefresh}
      />

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={handleRefresh}
      />
    </>
  );
}
