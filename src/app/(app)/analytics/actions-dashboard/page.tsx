"use client";

import { useEffect, useState, useTransition } from "react";
import { formatDate } from "@/lib/analytics/formatters";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MultiSelectFilter } from "@/components/analytics/multi-select-filter";
import { CreateActionDialog } from "@/components/analytics/create-action-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ClipboardList, Plus } from "lucide-react";
import {
  listActionItems,
  updateActionItemStatus,
  getCurrentUserId,
  listLocationsForActionsPicker,
} from "./actions";
import type { ActionItem, ActionItemStatus } from "@/lib/analytics/types";

const STATUS_OPTIONS: { value: ActionItemStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "cancelled", label: "Cancelled" },
];

const TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "investigation", label: "Investigation" },
  { value: "relocation", label: "Relocation" },
  { value: "training", label: "Training" },
  { value: "equipment_change", label: "Equipment Change" },
];

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  resolved: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

const TYPE_LABELS: Record<string, string> = {
  investigation: "Investigation",
  relocation: "Relocation",
  training: "Training",
  equipment_change: "Equipment Change",
};

// Today's local date in YYYY-MM-DD form, used for the overdue indicator.
// We compare due dates (column type DATE) against the calling browser's
// local "today" — a row is overdue when dueDate < today AND its status is
// neither resolved nor cancelled.
function getTodayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isOverdue(item: ActionItem, todayISO: string): boolean {
  if (!item.dueDate) return false;
  if (item.status === "resolved" || item.status === "cancelled") return false;
  return item.dueDate < todayISO;
}

export default function ActionsDashboardPage() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [locationOptions, setLocationOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const todayISO = getTodayISO();

  // Resolve the current user once on mount so "Mine only" can scope queries.
  useEffect(() => {
    getCurrentUserId()
      .then((id) => setCurrentUserId(id))
      .catch(() => setCurrentUserId(null));
    // Locations with action items — scope the picker to actually-actioned
    // locations to keep the dropdown short.
    listLocationsForActionsPicker()
      .then((rows) => setLocationOptions(rows))
      .catch(() => setLocationOptions([]));
  }, []);

  async function loadItems() {
    setLoading(true);
    const filters: {
      status?: string;
      actionType?: string;
      ownerId?: string;
      locationIds?: string[];
    } = {};
    if (statusFilter !== "all") filters.status = statusFilter;
    if (typeFilter !== "all") filters.actionType = typeFilter;
    if (mineOnly && currentUserId) filters.ownerId = currentUserId;
    if (selectedLocationIds.length > 0) filters.locationIds = selectedLocationIds;
    const data = await listActionItems(
      Object.keys(filters).length > 0 ? filters : undefined,
    );
    setItems(data);
    setLoading(false);
  }

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter, mineOnly, currentUserId, selectedLocationIds]);

  function handleStatusChange(id: string, newStatus: ActionItemStatus) {
    if (newStatus === "resolved") {
      setResolvingId(id);
      return;
    }
    startTransition(async () => {
      await updateActionItemStatus(id, newStatus);
      await loadItems();
    });
  }

  function handleResolve(id: string) {
    startTransition(async () => {
      await updateActionItemStatus(id, "resolved", outcomeNotes.trim() || undefined);
      setResolvingId(null);
      setOutcomeNotes("");
      await loadItems();
    });
  }

  const openCount = items.filter((i) => i.status === "open" || i.status === "in_progress").length;
  const overdueCount = items.filter((i) => isOverdue(i, todayISO)).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Action Dashboard"
        description={`${openCount} open action${openCount !== 1 ? "s" : ""}${
          overdueCount > 0 ? ` · ${overdueCount} overdue` : ""
        } across the portfolio`}
        actions={
          <CreateActionDialog sourceType="manual" onCreated={loadItems}>
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="mr-1.5 size-3.5" />
              New Action
            </Button>
          </CreateActionDialog>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {STATUS_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={statusFilter === opt.value ? "default" : "ghost"}
              size="sm"
              className={`h-7 px-2 text-xs ${
                statusFilter === opt.value
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : ""
              }`}
              onClick={() => setStatusFilter(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <MultiSelectFilter
          label="Location"
          options={locationOptions.map((l) => ({ value: l.id, label: l.name }))}
          selected={selectedLocationIds}
          onChange={setSelectedLocationIds}
          placeholder="Filter locations..."
        />

        <label className="flex items-center gap-2 text-xs">
          <Switch
            size="sm"
            checked={mineOnly}
            onCheckedChange={(v) => setMineOnly(Boolean(v))}
            disabled={!currentUserId}
          />
          Mine only
        </label>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          Loading actions...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed">
          <EmptyState
            icon={ClipboardList}
            title="No action items found"
            description="Adjust your filters or create a new action to populate this list."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs font-semibold">Title</TableHead>
                <TableHead className="text-xs font-semibold">
                  Location
                </TableHead>
                <TableHead className="text-xs font-semibold">Type</TableHead>
                <TableHead className="text-xs font-semibold">Status</TableHead>
                <TableHead className="text-xs font-semibold">
                  Due Date
                </TableHead>
                <TableHead className="text-xs font-semibold">
                  Created
                </TableHead>
                <TableHead className="text-xs font-semibold">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const overdue = isOverdue(item, todayISO);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="text-xs font-medium">
                      {item.title}
                      {item.description && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">
                          {item.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.locationName ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {TYPE_LABELS[item.actionType] ?? item.actionType}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          STATUS_STYLES[item.status] ?? ""
                        }`}
                      >
                        {STATUS_LABELS[item.status] ?? item.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-1.5">
                        <span>{item.dueDate ?? "—"}</span>
                        {overdue && (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                            Overdue
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(item.createdAt)}
                    </TableCell>
                    <TableCell>
                      {item.status !== "resolved" &&
                        item.status !== "cancelled" && (
                          <Select
                            value={item.status}
                            onValueChange={(v) =>
                              handleStatusChange(
                                item.id,
                                v as ActionItemStatus,
                              )
                            }
                          >
                            <SelectTrigger className="h-7 w-28 text-[10px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in_progress">
                                In Progress
                              </SelectItem>
                              <SelectItem value="resolved">Resolve</SelectItem>
                              <SelectItem value="cancelled">Cancel</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      {item.status === "resolved" && (
                        <div className="flex flex-col gap-0.5">
                          {item.outcomeNotes && (
                            <p className="text-[10px] text-muted-foreground line-clamp-1">
                              {item.outcomeNotes}
                            </p>
                          )}
                          {item.resolvedAt && (
                            <p className="text-[10px] text-muted-foreground">
                              Resolved{" "}
                              {formatDate(item.resolvedAt)}
                            </p>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}

              {/* Resolve dialog inline */}
              {resolvingId && (
                <TableRow>
                  <TableCell colSpan={7} className="bg-muted/30">
                    <div className="flex items-end gap-3 py-2">
                      <div className="flex-1">
                        <p className="mb-1 text-xs font-medium">
                          Outcome notes (optional)
                        </p>
                        <Textarea
                          value={outcomeNotes}
                          onChange={(e) => setOutcomeNotes(e.target.value)}
                          placeholder="What was done? What changed?"
                          rows={2}
                          className="text-xs"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => {
                            setResolvingId(null);
                            setOutcomeNotes("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          disabled={isPending}
                          onClick={() => handleResolve(resolvingId)}
                        >
                          {isPending ? "Resolving..." : "Resolve"}
                        </Button>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-right text-[10px] text-muted-foreground">
        {items.length} action{items.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
