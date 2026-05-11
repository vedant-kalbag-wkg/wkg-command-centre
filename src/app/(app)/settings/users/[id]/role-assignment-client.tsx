"use client";
import * as React from "react";
import { toast } from "sonner";
import { Loader2, SlidersHorizontal, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { listUserRoles, assignRole, revokeRole } from "./role-actions";
import type { UserRoleAssignment } from "./role-internal";
import type { RoleListItem } from "@/app/(app)/settings/roles/editor-internal";
import { ManageScopesDialog } from "@/components/admin/manage-scopes-dialog";
import type { UserListItem } from "@/app/(app)/settings/users/actions";

export function RoleAssignmentClient({
  userId,
  user,
  initialAssignments,
  allRoles,
  initialScopes,
}: {
  userId: string;
  /** Full UserListItem passed down from the RSC page — needed by ManageScopesDialog. */
  user: UserListItem;
  initialAssignments: UserRoleAssignment[];
  allRoles: RoleListItem[];
  initialScopes: unknown[];
}) {
  const [assignments, setAssignments] = React.useState(initialAssignments);
  const [isLoading, setIsLoading] = React.useState(false);
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  const [picker, setPicker] = React.useState<string>("");
  const [isAssigning, setIsAssigning] = React.useState(false);
  const [scopeDialog, setScopeDialog] = React.useState<{
    open: boolean;
    roleId: string | null;
    label: string;
  }>({ open: false, roleId: null, label: "" });

  // initialScopes retained for future extension
  void initialScopes;

  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await listUserRoles(userId);
      setAssignments(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load assignments");
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  async function handleAssign() {
    if (!picker) return;
    setIsAssigning(true);
    try {
      // v1.1: assign without scopes initially; operator edits scopes via
      // existing ManageScopesDialog flow (per-(user, role)) afterwards.
      const result = await assignRole(userId, picker, []);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Role assigned");
      setPicker("");
      await refresh();
    } finally {
      setIsAssigning(false);
    }
  }

  async function handleRevoke(
    userRoleId: string,
    roleDisplayName: string,
  ) {
    if (!confirm(`Revoke "${roleDisplayName}"?`)) return;
    setRemovingId(userRoleId);
    try {
      const result = await revokeRole(userRoleId);
      if ("status" in result && result.status === "lockout_prevention") {
        toast.error(
          "This change would leave the system with no effective admin. " +
            "Assign Admin (or a role that grants 'manage all') to at least one user before continuing.",
        );
        return;
      }
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Role revoked");
      await refresh();
    } finally {
      setRemovingId(null);
    }
  }

  const assignedRoleIds = new Set(assignments.map((a) => a.roleId));
  const availableRoles = allRoles.filter((r) => !assignedRoleIds.has(r.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles {isLoading && <Loader2 className="inline h-4 w-4 animate-spin ml-2" />}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {assignments.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No roles assigned. Pick a role below.
            </p>
          )}
          {assignments.map((a) => (
            <div
              key={a.userRoleId}
              className="flex items-center justify-between border rounded-md p-3"
            >
              <div>
                <div className="font-medium">{a.roleDisplayName}</div>
                <div className="text-xs text-muted-foreground">
                  {a.roleKind} &middot; {a.scopes.length} scope(s) &middot; assigned{" "}
                  {new Date(a.assignedAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  title="Edit scopes for this role"
                  onClick={() =>
                    setScopeDialog({
                      open: true,
                      roleId: a.roleId,
                      label: a.roleDisplayName,
                    })
                  }
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={removingId === a.userRoleId}
                  onClick={() => handleRevoke(a.userRoleId, a.roleDisplayName)}
                >
                  {removingId === a.userRoleId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-2 border-t">
          <Select value={picker} onValueChange={(v) => setPicker(v ?? "")}>
            <SelectTrigger className="w-[300px]">
              <SelectValue placeholder="Pick a role to assign…" />
            </SelectTrigger>
            <SelectContent>
              {availableRoles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.displayName} ({r.kind})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleAssign} disabled={!picker || isAssigning}>
            {isAssigning ? <Loader2 className="h-4 w-4 animate-spin" /> : "Assign"}
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          Use the <SlidersHorizontal className="inline h-3 w-3" /> icon to edit dimension
          scopes for a specific role assignment.
        </div>
      </CardContent>

      {/* Per-(user, role) scope dialog */}
      {scopeDialog.roleId && (
        <ManageScopesDialog
          user={user}
          open={scopeDialog.open}
          onOpenChange={(open) =>
            setScopeDialog((prev) => ({ ...prev, open }))
          }
          roleId={scopeDialog.roleId}
          assignmentLabel={scopeDialog.label}
        />
      )}
    </Card>
  );
}
