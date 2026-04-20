"use client";

import * as React from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { HexColorPicker } from "react-colorful";
import { GripVertical, MoreHorizontal, Plus, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  createStage,
  updateStage,
  deleteStage,
  reorderStage,
  getStageKioskCount,
} from "@/app/(app)/settings/pipeline-stages/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PipelineStage = {
  id: string;
  name: string;
  position: number;
  color: string | null;
  isDefault: boolean;
};

interface ManageStagesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: PipelineStage[];
  onStagesChange: () => void;
}

// ---------------------------------------------------------------------------
// Brand preset colors per WeKnow brand guidelines
// ---------------------------------------------------------------------------

const BRAND_PRESETS = [
  { label: "Graphite", color: "#121212" },
  { label: "Azure", color: "#00A6D3" },
  { label: "Night Grey", color: "#575A5C" },
  { label: "Mid Grey", color: "#ADADAD" },
  { label: "Sky Blue", color: "#E5F1F9" },
  { label: "Sea Blue", color: "#0087AA" },
  { label: "Night Blue", color: "#003B5C" },
  { label: "Pink", color: "#F41E56" },
  { label: "Gold", color: "#F4BA1E" },
  { label: "Green", color: "#68D871" },
];

// ---------------------------------------------------------------------------
// SortableStageItem
// ---------------------------------------------------------------------------

interface SortableStageItemProps {
  stage: PipelineStage;
  allStages: PipelineStage[];
  onRename: (id: string, name: string) => Promise<void>;
  onColorChange: (id: string, color: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
  onDelete: (id: string, reassignToStageId?: string) => Promise<void>;
  isEditing: boolean;
  onStartEdit: (id: string) => void;
  onStopEdit: () => void;
}

function SortableStageItem({
  stage,
  allStages,
  onRename,
  onColorChange,
  onSetDefault,
  onDelete,
  isEditing,
  onStartEdit,
  onStopEdit,
}: SortableStageItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stage.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const [editName, setEditName] = React.useState(stage.name);
  const [isSavingName, setIsSavingName] = React.useState(false);
  const [showColorPicker, setShowColorPicker] = React.useState(false);
  const [localColor, setLocalColor] = React.useState(stage.color ?? "#00A6D3");

  // Delete flow state
  const [deleteState, setDeleteState] = React.useState<
    "idle" | "confirm" | "reassign"
  >("idle");
  const [reassignTarget, setReassignTarget] = React.useState<string>("");
  const [isDeleting, setIsDeleting] = React.useState(false);

  const otherStages = allStages.filter((s) => s.id !== stage.id);

  const handleNameBlur = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === stage.name) {
      setEditName(stage.name);
      onStopEdit();
      return;
    }
    setIsSavingName(true);
    await onRename(stage.id, trimmed);
    setIsSavingName(false);
    onStopEdit();
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    }
    if (e.key === "Escape") {
      setEditName(stage.name);
      onStopEdit();
    }
  };

  const handleColorSelect = async (color: string) => {
    setLocalColor(color);
    await onColorChange(stage.id, color);
  };

  const handleDeleteClick = async (stageId: string, count?: number) => {
    if (count === undefined) {
      // Need to check count — assume caller checked
      setDeleteState("confirm");
      return;
    }
    if (count > 0) {
      setDeleteState("reassign");
    } else {
      setDeleteState("confirm");
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    await onDelete(stage.id);
    setIsDeleting(false);
    setDeleteState("idle");
  };

  const handleMoveAndDelete = async () => {
    if (!reassignTarget) return;
    setIsDeleting(true);
    await onDelete(stage.id, reassignTarget);
    setIsDeleting(false);
    setDeleteState("idle");
  };

  return (
    <div ref={setNodeRef} style={style} className="flex flex-col">
      <div className="flex items-center gap-2 py-2 px-1 rounded-md hover:bg-muted group">
        {/* Drag handle */}
        <button
          className="flex-shrink-0 w-5 h-5 text-muted-foreground hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Color dot */}
        <button
          className="flex-shrink-0 w-3 h-3 rounded-full border border-border/40 cursor-pointer"
          style={{ backgroundColor: localColor }}
          onClick={() => setShowColorPicker((v) => !v)}
          aria-label="Change color"
        />

        {/* Stage name — inline edit */}
        {isEditing ? (
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={handleNameKeyDown}
            className="h-7 flex-1 text-sm px-2 py-1"
            autoFocus
            disabled={isSavingName}
          />
        ) : (
          <span
            className="flex-1 text-sm cursor-pointer hover:text-primary"
            onClick={() => {
              setEditName(stage.name);
              onStartEdit(stage.id);
            }}
          >
            {stage.name}
          </span>
        )}

        {/* Default badge */}
        {stage.isDefault && (
          <Badge variant="secondary" className="text-xs">
            Default
          </Badge>
        )}

        {/* Kebab menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-0 group-hover:opacity-100"
              />
            }
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => onSetDefault(stage.id)}
              disabled={stage.isDefault}
            >
              Set as default
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={async () => {
                // Get kiosk count via server action to decide reassign flow
                const result = await getStageKioskCount(stage.id);
                if ("error" in result) {
                  setDeleteState("confirm");
                  return;
                }
                handleDeleteClick(stage.id, result.count);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Color picker panel (inline) */}
      {showColorPicker && (
        <div className="ml-9 mb-2 p-3 border border-border/30 rounded-lg bg-white shadow-sm">
          {/* Brand preset swatches */}
          <div className="flex flex-wrap gap-2 mb-3">
            {BRAND_PRESETS.map((preset) => (
              <button
                key={preset.color}
                className="w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110"
                style={{
                  backgroundColor: preset.color,
                  borderColor: localColor === preset.color ? "var(--color-wk-azure)" : "transparent",
                }}
                title={preset.label}
                onClick={() => handleColorSelect(preset.color)}
              >
                {localColor === preset.color && (
                  <Check className="w-3 h-3" style={{ color: preset.color === "#E5F1F9" ? "var(--color-wk-graphite)" : "#fff" }} />
                )}
              </button>
            ))}
          </div>
          {/* Custom color picker */}
          <HexColorPicker
            color={localColor}
            onChange={setLocalColor}
            onMouseUp={() => handleColorSelect(localColor)}
            style={{ width: "100%", height: "120px" }}
          />
          <div className="flex items-center gap-2 mt-2">
            <Input
              value={localColor}
              onChange={(e) => setLocalColor(e.target.value)}
              className="h-7 text-xs font-mono"
              maxLength={7}
              onBlur={() => {
                if (/^#[0-9A-Fa-f]{6}$/.test(localColor)) {
                  handleColorSelect(localColor);
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowColorPicker(false)}
            >
              Done
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation (inline) */}
      {deleteState === "confirm" && (
        <div className="ml-9 mb-2 px-3 py-2 border border-border/30 rounded-lg bg-muted text-sm">
          <p className="mb-2">
            Delete <span className="font-medium">&ldquo;{stage.name}&rdquo;</span>?
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 bg-destructive text-white hover:bg-destructive/90 text-xs"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setDeleteState("idle")}
              disabled={isDeleting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Reassignment flow (stage has kiosks) */}
      {deleteState === "reassign" && (
        <div className="ml-9 mb-2 px-3 py-2 border border-border/30 rounded-lg bg-muted text-sm">
          <p className="mb-2 text-muted-foreground">
            Move kiosks from <span className="font-medium text-foreground">{stage.name}</span> to another stage before deleting.
          </p>
          <div className="flex gap-2 items-center mb-2">
            <Select value={reassignTarget} onValueChange={(v) => setReassignTarget(v ?? "")}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder="Select a stage" />
              </SelectTrigger>
              <SelectContent>
                {otherStages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: s.color ?? "var(--color-wk-azure)" }}
                      />
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 bg-destructive text-white hover:bg-destructive/90 text-xs"
              onClick={handleMoveAndDelete}
              disabled={isDeleting || !reassignTarget}
            >
              {isDeleting ? "Moving..." : "Move and Delete"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setDeleteState("idle")}
              disabled={isDeleting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ManageStagesModal
// ---------------------------------------------------------------------------

export function ManageStagesModal({
  open,
  onOpenChange,
  stages,
  onStagesChange,
}: ManageStagesModalProps) {
  const [localStages, setLocalStages] = React.useState<PipelineStage[]>(stages);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [isAdding, setIsAdding] = React.useState(false);

  // Sync external stages into local state
  React.useEffect(() => {
    setLocalStages(stages);
  }, [stages]);

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const sortedStages = [...localStages].sort((a, b) => a.position - b.position);
    const activeIdx = sortedStages.findIndex((s) => s.id === active.id);
    const overIdx = sortedStages.findIndex((s) => s.id === over.id);

    if (activeIdx === -1 || overIdx === -1) return;

    // Calculate new position
    const reordered = [...sortedStages];
    const [moved] = reordered.splice(activeIdx, 1);
    reordered.splice(overIdx, 0, moved);

    // Optimistic update
    setLocalStages(reordered);

    // Determine after/before positions for the new slot
    const newIdx = overIdx;
    const afterPosition = newIdx > 0 ? reordered[newIdx - 1].position : null;
    const beforePosition = newIdx < reordered.length - 1 ? reordered[newIdx + 1].position : null;

    await reorderStage(moved.id, afterPosition, beforePosition);
    onStagesChange();
  };

  const handleRename = async (id: string, name: string) => {
    await updateStage(id, { name });
    setLocalStages((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name } : s))
    );
    onStagesChange();
  };

  const handleColorChange = async (id: string, color: string) => {
    await updateStage(id, { color });
    setLocalStages((prev) =>
      prev.map((s) => (s.id === id ? { ...s, color } : s))
    );
    onStagesChange();
  };

  const handleSetDefault = async (id: string) => {
    await updateStage(id, { isDefault: true });
    setLocalStages((prev) =>
      prev.map((s) => ({ ...s, isDefault: s.id === id }))
    );
    onStagesChange();
  };

  const handleDelete = async (id: string, reassignToStageId?: string) => {
    const result = await deleteStage(id, reassignToStageId);
    if ("success" in result) {
      setLocalStages((prev) => prev.filter((s) => s.id !== id));
      onStagesChange();
    }
  };

  const handleAddStage = async () => {
    setIsAdding(true);
    const result = await createStage("New Stage", "#00A6D3");
    if ("success" in result) {
      // Refresh stages list
      onStagesChange();
    }
    setIsAdding(false);
  };

  const sortedStages = [...localStages].sort((a, b) => a.position - b.position);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Pipeline Stages</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2">
          <DndContext
            id="manage-stages-dnd"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sortedStages.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {sortedStages.map((stage) => (
                <SortableStageItem
                  key={stage.id}
                  stage={stage}
                  allStages={sortedStages}
                  onRename={handleRename}
                  onColorChange={handleColorChange}
                  onSetDefault={handleSetDefault}
                  onDelete={handleDelete}
                  isEditing={editingId === stage.id}
                  onStartEdit={(id) => setEditingId(id)}
                  onStopEdit={() => setEditingId(null)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* Add stage button */}
        <div className="border-t border-border/30 pt-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-sm"
            onClick={handleAddStage}
            disabled={isAdding}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {isAdding ? "Adding..." : "Add stage"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
