"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ShieldPlus, Pencil, Trash2, Copy, Plus, X } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ACTIONS, KNOWN_SUBJECTS } from "@/lib/casl/types";
import type { RawRule } from "@/lib/casl/types";
import {
  listRoles,
  createRole,
  deleteRole,
  cloneRole,
} from "./actions";
import type { RoleListItem } from "./editor-internal";

/** Minimal in-dialog rule shape: one action per row, no fields/conditions. */
type DraftRule = { action: string; subject: string };

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
  const [createDescription, setCreateDescription] = useState("");
  const [createRules, setCreateRules] = useState<DraftRule[]>([]);
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
    // Drop any incomplete draft rules; the DB stores one action per row,
    // so each draft maps 1:1 to a RawRule with no fields/conditions.
    const rules: RawRule[] = createRules
      .filter((r) => r.action && r.subject)
      .map((r) => ({
        action: r.action,
        subject: r.subject,
        fields: null,
        conditions: null,
        inverted: false,
      }));
    setCreateSubmitting(true);
    try {
      const result = await createRole({
        name: createName.trim(),
        displayName: createDisplayName.trim(),
        description: createDescription.trim() || undefined,
        rules,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Role "${createDisplayName.trim()}" created.`);
        setCreateOpen(false);
        setCreateName("");
        setCreateDisplayName("");
        setCreateDescription("");
        setCreateRules([]);
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
        <Button
          onClick={() => setCreateOpen(true)}
          className="h-9"
          disabled={!canManage}
        >
          <ShieldPlus className="size-4" aria-hidden="true" />
          Create role
        </Button>
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
              <Label htmlFor="create-description">
                Description{" "}
                <span className="text-muted-foreground text-xs font-normal">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="create-description"
                placeholder="What does this role do? Who should have it?"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                rows={2}
                maxLength={500}
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

            {/* Permission rules — minimal in-dialog editor. Full rule
                editing (fields, conditions, allow/deny) lives on the
                /settings/roles/[id] page; this dialog only supports the
                common case of "action × subject" allow rules at create
                time so the role can ship usable from the create flow. */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Permissions{" "}
                  <span className="font-normal">(optional)</span>
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCreateRules((rs) => [
                      ...rs,
                      { action: "", subject: "" },
                    ])
                  }
                  className="h-7 text-xs"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Add rule
                </Button>
              </div>
              {createRules.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No rules yet — the role will be created with no permissions.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {createRules.map((rule, i) => {
                    const actionId = `create-rule-${i}-action`;
                    const subjectId = `create-rule-${i}-subject`;
                    return (
                      <div
                        key={i}
                        className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end"
                      >
                        <div className="flex flex-col gap-1">
                          <Label htmlFor={actionId} className="text-xs">
                            Action
                          </Label>
                          <Select
                            value={rule.action}
                            onValueChange={(v) =>
                              setCreateRules((rs) =>
                                rs.map((r, j) =>
                                  j === i ? { ...r, action: v ?? "" } : r,
                                ),
                              )
                            }
                          >
                            <SelectTrigger id={actionId} className="h-8 text-xs">
                              <SelectValue placeholder="Select action…" />
                            </SelectTrigger>
                            <SelectContent>
                              {ACTIONS.map((a) => (
                                <SelectItem
                                  key={a}
                                  value={a}
                                  className="text-xs font-mono"
                                >
                                  {a}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label htmlFor={subjectId} className="text-xs">
                            Subject
                          </Label>
                          <Select
                            value={rule.subject}
                            onValueChange={(v) =>
                              setCreateRules((rs) =>
                                rs.map((r, j) =>
                                  j === i ? { ...r, subject: v ?? "" } : r,
                                ),
                              )
                            }
                          >
                            <SelectTrigger id={subjectId} className="h-8 text-xs">
                              <SelectValue placeholder="Select subject…" />
                            </SelectTrigger>
                            <SelectContent>
                              {KNOWN_SUBJECTS.map((s) => (
                                <SelectItem
                                  key={s}
                                  value={s}
                                  className="text-xs font-mono"
                                >
                                  {s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            setCreateRules((rs) =>
                              rs.filter((_, j) => j !== i),
                            )
                          }
                          aria-label={`Remove rule ${i + 1}`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
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
