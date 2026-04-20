"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Merge, Trash2, UserX } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ChangeRoleDialog } from "@/components/admin/change-role-dialog";
import { DeactivateDialog } from "@/components/admin/deactivate-dialog";
import { ReactivateDialog } from "@/components/admin/reactivate-dialog";
import { DeleteUserDialog } from "@/components/admin/delete-user-dialog";
import { EditUserDialog } from "@/components/admin/edit-user-dialog";
import { ManageScopesDialog } from "@/components/admin/manage-scopes-dialog";
import { MergeDialog } from "@/components/table/merge-dialog";
import { mergeUsersAction } from "@/app/(app)/settings/users/merge-action";
import { bulkDeactivateUsers } from "@/app/(app)/settings/users/actions";
import type { UserListItem } from "@/app/(app)/settings/users/actions";
import { startImpersonation } from "@/app/(app)/settings/users/impersonation-actions";

function RoleBadge({ role }: { role: string }) {
  const label = role.charAt(0).toUpperCase() + role.slice(1);

  const styles: Record<string, string> = {
    admin: "bg-secondary text-secondary-foreground",
    member: "bg-[#F4F4F4] text-foreground",
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
  const router = useRouter();
  const [changeRoleUser, setChangeRoleUser] = useState<UserListItem | null>(null);
  const [deactivateUser, setDeactivateUser] = useState<UserListItem | null>(null);
  const [reactivateUserState, setReactivateUserState] = useState<UserListItem | null>(null);
  const [editUser, setEditUser] = useState<UserListItem | null>(null);
  const [manageScopesUser, setManageScopesUser] = useState<UserListItem | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Track last-clicked index for shift+click range selection
  const lastClickedIndex = useRef<number | null>(null);

  const handleRowClick = useCallback(
    (userId: string, index: number, event: React.MouseEvent) => {
      if (!isAdmin) return;

      const isMetaKey = event.metaKey || event.ctrlKey;
      const isShiftKey = event.shiftKey;

      setSelectedUserIds((prev) => {
        const next = new Set(prev);

        if (isShiftKey && lastClickedIndex.current !== null) {
          // Shift+click: select range from last-clicked to current
          const start = Math.min(lastClickedIndex.current, index);
          const end = Math.max(lastClickedIndex.current, index);
          for (let i = start; i <= end; i++) {
            next.add(users[i].id);
          }
        } else if (isMetaKey) {
          // Ctrl/Cmd+click: toggle individual
          if (next.has(userId)) next.delete(userId);
          else next.add(userId);
        } else {
          // Plain click on checkbox area — toggle single
          if (next.has(userId)) next.delete(userId);
          else next.add(userId);
        }

        return next;
      });

      lastClickedIndex.current = index;
    },
    [isAdmin, users]
  );

  const selectAll = useCallback(() => {
    setSelectedUserIds(new Set(users.map((u) => u.id)));
  }, [users]);

  const clearSelection = useCallback(() => {
    setSelectedUserIds(new Set());
    lastClickedIndex.current = null;
  }, []);

  const selectedRecords = users.filter((u) => selectedUserIds.has(u.id));
  const selectedCount = selectedUserIds.size;
  const allSelected = selectedCount === users.length && users.length > 0;

  const userMergeFields = [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "role", label: "Role" },
  ];

  async function handleBulkDeactivate() {
    const ids = [...selectedUserIds];
    const result = await bulkDeactivateUsers(ids);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success(`Deactivated ${result.count} users`);
      clearSelection();
      onRefresh();
    }
  }

  async function handlePreviewAs(targetUser: UserListItem) {
    const result = await startImpersonation(targetUser.id);
    if (result.success) {
      toast.success(`Previewing as ${targetUser.name || targetUser.email}`);
      router.push("/analytics/portfolio");
    } else {
      toast.error(result.error ?? "Failed to start preview");
    }
  }

  if (users.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        No users yet. Invite your first team member to get started.
      </div>
    );
  }

  return (
    <TooltipProvider>
      {/* Bulk action toolbar */}
      {isAdmin && selectedCount > 0 && (
        <div className="flex items-center gap-2 mb-3 px-1">
          <span className="text-sm text-muted-foreground">
            {selectedCount} selected
          </span>
          {selectedCount >= 2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMergeOpen(true)}
              className="h-7 gap-1.5 text-xs"
            >
              <Merge className="h-3 w-3" />
              Merge
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkDeactivate}
            className="h-7 gap-1.5 text-xs"
          >
            <UserX className="h-3 w-3" />
            Deactivate
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="h-7 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive/90"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </Button>
          <button
            type="button"
            onClick={clearSelection}
            className="text-xs text-muted-foreground hover:text-foreground ml-1"
          >
            Clear
          </button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {isAdmin && (
              <TableHead className="w-8">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => {
                    if (checked) selectAll();
                    else clearSelection();
                  }}
                />
              </TableHead>
            )}
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-12">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user, index) => (
            <TableRow
              key={user.id}
              className={`
                ${user.banned ? "opacity-50" : ""}
                ${selectedUserIds.has(user.id) ? "bg-[var(--color-wk-azure-20)] hover:bg-[var(--color-wk-azure-20)]" : ""}
                ${isAdmin ? "cursor-pointer" : ""}
              `}
              onClick={(e) => {
                // Only handle row click for selection if admin and not clicking actions/checkbox
                const target = e.target as HTMLElement;
                if (target.closest("button, [role=menuitem], [data-no-row-click]")) return;
                handleRowClick(user.id, index, e);
              }}
            >
              {isAdmin && (
                <TableCell data-no-row-click>
                  <Checkbox
                    checked={selectedUserIds.has(user.id)}
                    onCheckedChange={() =>
                      handleRowClick(user.id, index, { metaKey: false, ctrlKey: false, shiftKey: false } as React.MouseEvent)
                    }
                  />
                </TableCell>
              )}
              <TableCell className="font-medium">
                {user.name || "\u2014"}
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
                  <span className="text-sm text-muted-foreground">Active</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
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
                        onClick={() => setEditUser(user)}
                      >
                        Edit details
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setChangeRoleUser(user)}
                      >
                        Change role
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setManageScopesUser(user)}
                      >
                        Manage scopes
                      </DropdownMenuItem>
                      {!user.banned && user.role !== "admin" && (
                        <DropdownMenuItem
                          onClick={() => handlePreviewAs(user)}
                        >
                          Preview as
                        </DropdownMenuItem>
                      )}
                      {!user.banned ? (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeactivateUser(user)}
                        >
                          Deactivate
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() => setReactivateUserState(user)}
                        >
                          Reactivate
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => {
                          setSelectedUserIds(new Set([user.id]));
                          setDeleteOpen(true);
                        }}
                      >
                        Delete permanently
                      </DropdownMenuItem>
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

      {editUser && (
        <EditUserDialog
          user={editUser}
          open={!!editUser}
          onOpenChange={(open) => {
            if (!open) setEditUser(null);
          }}
          onSuccess={onRefresh}
        />
      )}

      {manageScopesUser && (
        <ManageScopesDialog
          user={manageScopesUser}
          open={!!manageScopesUser}
          onOpenChange={(open) => {
            if (!open) setManageScopesUser(null);
          }}
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

      {reactivateUserState && (
        <ReactivateDialog
          user={reactivateUserState}
          open={!!reactivateUserState}
          onOpenChange={(open) => {
            if (!open) setReactivateUserState(null);
          }}
          onSuccess={onRefresh}
        />
      )}

      <DeleteUserDialog
        users={selectedRecords}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onSuccess={() => {
          clearSelection();
          onRefresh();
        }}
      />

      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        records={selectedRecords}
        fields={userMergeFields}
        getFieldValue={(r, k) => String((r as Record<string, unknown>)[k] ?? "")}
        getId={(r) => r.id}
        getName={(r) => r.name || r.email}
        onMerge={mergeUsersAction}
        onSuccess={() => { clearSelection(); onRefresh(); }}
        entityLabel="user"
      />
    </TooltipProvider>
  );
}
