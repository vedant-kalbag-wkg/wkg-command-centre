"use client";

import * as React from "react";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  useKioskViewStore,
  useLocationViewStore,
  useGanttViewStore,
  useCalendarViewStore,
  type ViewConfig,
} from "@/lib/stores/view-engine-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewStore =
  | typeof useKioskViewStore
  | typeof useLocationViewStore
  | typeof useGanttViewStore
  | typeof useCalendarViewStore;

interface SavedView {
  id: string;
  name: string;
  config: {
    filters?: unknown;
    sort?: unknown;
    groupBy?: string;
    columns?: string[];
  };
}

interface SavedViewsBarProps {
  viewStore: ViewStore;
  entityType: "kiosk" | "location" | "installation";
  viewType?: "table" | "kanban" | "gantt" | "calendar"; // defaults to "table"
  saveAction: (name: string, config: ViewConfig, viewType?: string) => Promise<{ success?: true; id?: string; error?: string }>;
  listAction: (viewType?: string) => Promise<SavedView[]>;
  updateAction: (viewId: string, name: string, config: ViewConfig) => Promise<{ success?: true; error?: string }>;
  deleteAction: (viewId: string) => Promise<{ success?: true; error?: string }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SavedViewsBar({
  viewStore,
  viewType,
  saveAction,
  listAction,
  updateAction,
  deleteAction,
}: SavedViewsBarProps) {
  const store = viewStore();
  const [views, setViews] = React.useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = React.useState<string | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  // Load saved views on mount
  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const fetched = await listAction(viewType);
        if (!cancelled) setViews(fetched as SavedView[]);
      } catch (err) {
        if (!cancelled) console.error("Failed to load saved views:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [listAction]);

  function buildViewConfig(): ViewConfig {
    return store.getCurrentConfig();
  }

  async function handleSave() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const config = buildViewConfig();
      const result = await saveAction(saveName.trim(), config, viewType);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      // Reload views
      const updated = await listAction(viewType);
      setViews(updated as SavedView[]);
      if (result.id) setActiveViewId(result.id);
      setSaveOpen(false);
      setSaveName("");
      toast.success("View saved");
    } catch {
      toast.error("Failed to save view");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(view: SavedView) {
    try {
      const config = buildViewConfig();
      const result = await updateAction(view.id, view.name, config);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      const updated = await listAction(viewType);
      setViews(updated as SavedView[]);
      toast.success("View updated");
    } catch {
      toast.error("Failed to update view");
    }
  }

  async function handleDelete(viewId: string) {
    try {
      const result = await deleteAction(viewId);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if (activeViewId === viewId) setActiveViewId(null);
      const updated = await listAction(viewType);
      setViews(updated as SavedView[]);
      toast.success("View deleted");
    } catch {
      toast.error("Failed to delete view");
    }
  }

  function applyView(view: SavedView) {
    // Convert DB config shape to ViewConfig shape
    const config: ViewConfig = {
      columnFilters: Array.isArray(view.config.filters)
        ? (view.config.filters as ColumnFiltersState)
        : [],
      sorting: Array.isArray(view.config.sort)
        ? (view.config.sort as SortingState)
        : [],
      grouping: view.config.groupBy ? [view.config.groupBy] : [],
      columnVisibility: view.config.columns
        ? Object.fromEntries(view.config.columns.map((c) => [c, true]))
        : {},
    };
    store.applyView(config);
    setActiveViewId(view.id);
  }

  return (
    <div className="flex items-center gap-2">
      {/* Scrollable pills area */}
      <div className="flex-1 overflow-x-auto pb-1 scrollbar-hide">
        {!loading && views.length === 0 && (
          <p className="text-[12px] text-muted-foreground whitespace-nowrap">No saved views</p>
        )}
        {!loading && views.length > 0 && (
          <div className="flex items-center gap-1.5 flex-nowrap">
            {views.map((view) => {
              const isActive = activeViewId === view.id;
              return (
                <div key={view.id} className="flex items-center gap-0.5 group">
                  <button
                    type="button"
                    onClick={() => applyView(view)}
                    className={`
                      inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap
                      ${
                        isActive
                          ? "bg-primary text-white"
                          : "bg-muted text-foreground hover:bg-primary/10"
                      }
                    `}
                  >
                    {view.name}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          className="hidden group-hover:inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground text-[10px]"
                          aria-label={`Options for view "${view.name}"`}
                        />
                      }
                    >
                      ▾
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-36">
                      <DropdownMenuItem
                        onClick={() => handleUpdate(view)}
                        className="gap-2 text-sm"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Update view
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDelete(view.id)}
                        className="gap-2 text-sm text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Save view button — pinned outside scroll area */}
      <Popover open={saveOpen} onOpenChange={setSaveOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="shrink-0 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Save view
            </button>
          }
        />
        <PopoverContent align="end" className="w-56 p-3">
          <div className="space-y-2">
            <Label className="text-xs">View name</Label>
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              placeholder="e.g. Active kiosks"
              className="h-8 text-sm"
              autoFocus
            />
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !saveName.trim()}
              className="w-full h-8 bg-primary text-white hover:bg-primary/90 text-xs"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
