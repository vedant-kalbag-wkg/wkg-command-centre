"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addScope,
  listScopes,
  removeScope,
  type DimensionType,
  type UserScopeRow,
} from "@/app/(app)/settings/users/[id]/scopes-actions";
import type { UserListItem } from "@/app/(app)/settings/users/actions";

interface ManageScopesDialogProps {
  user: UserListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DIMENSION_OPTIONS: { value: DimensionType; label: string }[] = [
  { value: "hotel_group", label: "Hotel group" },
  { value: "location", label: "Location" },
  { value: "region", label: "Region" },
  { value: "product", label: "Product" },
  { value: "provider", label: "Provider" },
  { value: "location_group", label: "Location group" },
];

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

function dimensionLabel(value: string): string {
  const match = DIMENSION_OPTIONS.find((opt) => opt.value === value);
  return match ? match.label : value;
}

export function ManageScopesDialog({
  user,
  open,
  onOpenChange,
}: ManageScopesDialogProps) {
  const [scopes, setScopes] = useState<UserScopeRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [newDimensionType, setNewDimensionType] =
    useState<DimensionType>("hotel_group");
  const [newDimensionId, setNewDimensionId] = useState("");

  const displayName = user.name || user.email;

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const rows = await listScopes(user.id);
      setScopes(rows);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load scopes";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, refresh]);

  async function handleAdd() {
    const trimmed = newDimensionId.trim();
    if (!trimmed) {
      toast.error("Dimension ID is required");
      return;
    }
    setIsAdding(true);
    try {
      await addScope(user.id, newDimensionType, trimmed);
      toast.success("Scope added");
      setNewDimensionId("");
      await refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to add scope";
      toast.error(message);
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemove(scopeId: string) {
    setRemovingId(scopeId);
    try {
      await removeScope(scopeId);
      toast.success("Scope removed");
      await refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to remove scope";
      toast.error(message);
    } finally {
      setRemovingId(null);
    }
  }

  const mutating = isAdding || removingId !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Manage scopes</DialogTitle>
          <DialogDescription>
            Add or remove dimension scopes for {displayName}. Scopes constrain
            which records this user can read in analytics queries.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Existing scopes */}
          <div>
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading scopes...
              </div>
            ) : scopes.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                No scopes yet. Add one below to grant this user access to a
                dimension.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dimension type</TableHead>
                    <TableHead>Dimension ID</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-12 text-right">Remove</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scopes.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{dimensionLabel(row.dimensionType)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.dimensionId}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove scope ${row.dimensionType}:${row.dimensionId}`}
                          disabled={mutating}
                          onClick={() => handleRemove(row.id)}
                        >
                          {removingId === row.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Add scope form */}
          <div className="grid gap-3 rounded-lg border p-3">
            <div className="text-sm font-medium">Add scope</div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="add-scope-type">Dimension type</Label>
                <Select
                  value={newDimensionType}
                  onValueChange={(val) =>
                    val && setNewDimensionType(val as DimensionType)
                  }
                >
                  <SelectTrigger className="w-full" id="add-scope-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIMENSION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="add-scope-id">Dimension ID</Label>
                <Input
                  id="add-scope-id"
                  value={newDimensionId}
                  placeholder="e.g. hotel-123"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewDimensionId(e.target.value)
                  }
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter" && !mutating) {
                      e.preventDefault();
                      void handleAdd();
                    }
                  }}
                />
              </div>
              <Button
                onClick={handleAdd}
                disabled={mutating || !newDimensionId.trim()}
              >
                {isAdding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Add
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
