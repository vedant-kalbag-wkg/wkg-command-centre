"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChangeRoleDialog } from "@/components/admin/change-role-dialog";
import { DeactivateDialog } from "@/components/admin/deactivate-dialog";
import type { UserListItem } from "@/app/(app)/settings/users/actions";

function RoleBadge({ role }: { role: string }) {
  const label = role.charAt(0).toUpperCase() + role.slice(1);

  const styles: Record<string, string> = {
    admin: "bg-[#121212] text-white",
    member: "bg-[#F4F4F4] text-[#121212]",
    viewer: "bg-[#E5F1F9] text-[#575A5C]",
  };

  return (
    <span
      className={`inline-flex items-center justify-center rounded-[6px] px-3 py-1.5 text-xs font-medium ${styles[role] || styles.member}`}
    >
      {label}
    </span>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

interface UserTableProps {
  users: UserListItem[];
  isAdmin: boolean;
  onRefresh: () => void;
}

export function UserTable({ users, isAdmin, onRefresh }: UserTableProps) {
  const [changeRoleUser, setChangeRoleUser] = useState<UserListItem | null>(
    null
  );
  const [deactivateUser, setDeactivateUser] = useState<UserListItem | null>(
    null
  );

  if (users.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-wk-night-grey">
        No users yet. Invite your first team member to get started.
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-12">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow
              key={user.id}
              className={user.banned ? "opacity-50" : ""}
            >
              <TableCell className="font-medium">
                {user.name || "—"}
              </TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <RoleBadge role={user.role} />
              </TableCell>
              <TableCell>
                {user.banned ? (
                  <span className="inline-flex items-center justify-center rounded-[6px] bg-[#F4F4F4] px-3 py-1.5 text-xs font-medium text-[#575A5C]">
                    Inactive
                  </span>
                ) : (
                  <span className="text-sm text-wk-night-grey">Active</span>
                )}
              </TableCell>
              <TableCell className="text-wk-night-grey">
                {formatDate(user.createdAt)}
              </TableCell>
              <TableCell>
                {isAdmin ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon-sm" />
                      }
                    >
                      <MoreHorizontal className="size-4" />
                      <span className="sr-only">Actions</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => setChangeRoleUser(user)}
                      >
                        Change role
                      </DropdownMenuItem>
                      {!user.banned && (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeactivateUser(user)}
                        >
                          Deactivate
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled
                          className="cursor-not-allowed"
                        />
                      }
                    >
                      <MoreHorizontal className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent>
                      You don&apos;t have permission to manage users
                    </TooltipContent>
                  </Tooltip>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {changeRoleUser && (
        <ChangeRoleDialog
          user={changeRoleUser}
          open={!!changeRoleUser}
          onOpenChange={(open) => {
            if (!open) setChangeRoleUser(null);
          }}
          onSuccess={onRefresh}
        />
      )}

      {deactivateUser && (
        <DeactivateDialog
          user={deactivateUser}
          open={!!deactivateUser}
          onOpenChange={(open) => {
            if (!open) setDeactivateUser(null);
          }}
          onSuccess={onRefresh}
        />
      )}
    </TooltipProvider>
  );
}
