"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ShieldPlus, Pencil, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listRoles,
  createRole,
  deleteRole,
  cloneRole,
} from "./actions";
import type { RoleListItem } from "./editor-internal";

const LOCKOUT_PREVENTION_MSG =
  "This change would leave the system with no effective admin. Assign Admin (or a role that grants 'manage all') to at least one user before continuing.";

const KIND_LABELS: Record<string, string> = {
  system: "System",
  tier: "Tier",
  custom: "Custom",
};

const KIND_VARIANTS: Record<
  string,
  "subtle-primary" | "subtle-muted" | "outline"
> = {
  system: "subtle-primary",
  tier: "subtle-muted",
  custom: "outline",
};

interface RoleListClientProps {
  initialRoles: RoleListItem[];
  canManage: boolean;
}

export function RoleListClient({
  initialRoles,
  canManage,
}: RoleListClientProps) {
  const [roles, setRoles] = useState<RoleListItem[]>(initialRoles);
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);

  // Create dialog state
  const [createName, setCreateName] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Clone dialog state
  const [cloneName, setCloneName] = useState("");
  const [cloneDisplayName, setCloneDisplayName] = useState("");
  const [cloneSubmitting, setCloneSubmitting] = useState(false);

  const handleRefresh = useCallback(async () => {
    const result = await listRoles();
    if ("roles" in result) {
      setRoles(result.roles);
    }
  }, []);

  // ── Create ─────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim() || !createDisplayName.trim()) return;
    setCreateSubmitting(true);
    try {
      const result = await createRole({
        name: createName.trim(),
        displayName: createDisplayName.trim(),
        rules: [],
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Role "${createDisplayName.trim()}" created.`);
        setCreateOpen(false);
        setCreateName("");
        setCreateDisplayName("");
        await handleRefresh();
      }
    } finally {
      setCreateSubmitting(false);
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────
  async function handleDelete(roleId: string, displayName: string) {
    if (!confirm(`Delete role "${displayName}"? This cannot be undone.`)) return;
    setDeletingId(roleId);
    try {
      const result = await deleteRole(roleId);
      if ("status" in result && result.status === "lockout_prevention") {
        toast.error(LOCKOUT_PREVENTION_MSG);
      } else if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Role "${displayName}" deleted.`);
        await handleRefresh();
      }
    } finally {
      setDeletingId(null);
    }
  }

  // ── Clone ──────────────────────────────────────────────────────────
  function openCloneDialog(role: RoleListItem) {
    setCloneName(`${role.name}-copy`);
    setCloneDisplayName(`${role.displayName} (Copy)`);
    setCloningId(role.id);
  }

  async function handleClone(e: React.FormEvent) {
    e.preventDefault();
    if (!cloningId || !cloneName.trim() || !cloneDisplayName.trim()) return;
    setCloneSubmitting(true);
    try {
      const result = await cloneRole(
        cloningId,
        cloneName.trim(),
        cloneDisplayName.trim(),
      );
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Role cloned as "${cloneDisplayName.trim()}".`);
        setCloningId(null);
        setCloneName("");
        setCloneDisplayName("");
        await handleRefresh();
      }
    } finally {
      setCloneSubmitting(false);
    }
  }

  return (
    <>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-4">
        <div />
        {canManage && (
          <Button onClick={() => setCreateOpen(true)} className="h-9">
            <ShieldPlus className="size-4" />
            Create role
          </Button>
        )}
      </div>

      {/* Role table */}
      {roles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No roles found.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Role
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Kind
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">
                  Description
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Users
                </th>
                {canManage && (
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {roles.map((role) => (
                <tr key={role.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium">{role.displayName}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {role.name}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={KIND_VARIANTS[role.kind] ?? "outline"}>
                      {KIND_LABELS[role.kind] ?? role.kind}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell max-w-xs truncate">
                    {role.description ?? (
                      <span className="italic text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {role.assignedUserCount}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Edit */}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          render={<Link href={`/settings/roles/${role.id}`} />}
                          title={`Edit ${role.displayName}`}
                        >
                          <Pencil className="size-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>

                        {/* Clone */}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openCloneDialog(role)}
                          title={`Clone ${role.displayName}`}
                        >
                          <Copy className="size-3.5" />
                          <span className="sr-only">Clone</span>
                        </Button>

                        {/* Delete — disabled for system roles */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={
                                    role.kind === "system" ||
                                    deletingId === role.id
                                  }
                                  onClick={() =>
                                    handleDelete(role.id, role.displayName)
                                  }
                                  className="text-destructive hover:text-destructive"
                                />
                              }
                            >
                              <Trash2 className="size-3.5" />
                              <span className="sr-only">Delete</span>
                            </TooltipTrigger>
                            {role.kind === "system" && (
                              <TooltipContent>
                                System roles cannot be deleted.
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create role dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="flex flex-col gap-4 mt-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-display-name">Display name</Label>
              <Input
                id="create-display-name"
                placeholder="e.g. Regional Manager"
                value={createDisplayName}
                onChange={(e) => setCreateDisplayName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-name">
                Role name{" "}
                <span className="text-muted-foreground text-xs font-normal">
                  (slug, no spaces)
                </span>
              </Label>
              <Input
                id="create-name"
                placeholder="e.g. regional_manager"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                pattern="[a-z0-9_-]+"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={createSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createSubmitting ||
                  !createName.trim() ||
                  !createDisplayName.trim()
                }
              >
                {createSubmitting ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Clone role dialog */}
      <Dialog
        open={cloningId !== null}
        onOpenChange={(open) => {
          if (!open) setCloningId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone role</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleClone} className="flex flex-col gap-4 mt-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="clone-display-name">Display name</Label>
              <Input
                id="clone-display-name"
                value={cloneDisplayName}
                onChange={(e) => setCloneDisplayName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="clone-name">
                Role name{" "}
                <span className="text-muted-foreground text-xs font-normal">
                  (slug, no spaces)
                </span>
              </Label>
              <Input
                id="clone-name"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                pattern="[a-z0-9_-]+"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCloningId(null)}
                disabled={cloneSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  cloneSubmitting ||
                  !cloneName.trim() ||
                  !cloneDisplayName.trim()
                }
              >
                {cloneSubmitting ? "Cloning…" : "Clone"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
