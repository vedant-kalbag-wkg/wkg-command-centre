"use client";

import * as React from "react";
import { X, Edit, Archive, Download, Merge } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { exportTableToCSV } from "@/components/table/csv-export";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BulkEditField {
  id: string;
  label: string;
  type?: "text" | "select";
  options?: { value: string; label: string }[];
}

interface BulkToolbarProps<T> {
  selectedCount: number;
  selectedIds: string[];
  entityType: "kiosk" | "location";
  bulkEditFields: BulkEditField[];
  onBulkUpdate: (field: string, value: unknown) => Promise<void>;
  onBulkArchive: (ids: string[]) => Promise<void>;
  onMerge?: () => void;
  onClearSelection: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: Table<T>;
  csvFileName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BulkToolbar<T>({
  selectedCount,
  selectedIds,
  entityType,
  bulkEditFields,
  onBulkUpdate,
  onBulkArchive,
  onMerge,
  onClearSelection,
  table,
  csvFileName,
}: BulkToolbarProps<T>) {
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = React.useState(false);
  const [selectedField, setSelectedField] = React.useState<string>("");
  const [fieldValue, setFieldValue] = React.useState<string>("");
  const [isUpdating, startUpdateTransition] = React.useTransition();
  const [isArchiving, startArchiveTransition] = React.useTransition();

  const isVisible = selectedCount >= 1;

  const currentField = bulkEditFields.find((f) => f.id === selectedField);

  function handleOpenEditDialog() {
    setSelectedField(bulkEditFields[0]?.id ?? "");
    setFieldValue("");
    setEditDialogOpen(true);
  }

  function handleApplyChanges() {
    if (!selectedField) return;
    startUpdateTransition(async () => {
      await onBulkUpdate(selectedField, fieldValue);
      setEditDialogOpen(false);
      setSelectedField("");
      setFieldValue("");
    });
  }

  function handleArchive() {
    startArchiveTransition(async () => {
      await onBulkArchive(selectedIds);
      setArchiveDialogOpen(false);
    });
  }

  function handleExportCSV() {
    exportTableToCSV(table, csvFileName);
  }

  return (
    <>
      {/* Edit dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Bulk edit {selectedCount} {entityType}s</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Field to edit</Label>
              <Select
                value={selectedField}
                onValueChange={(v) => {
                  setSelectedField(v as string);
                  setFieldValue("");
                }}
                items={bulkEditFields.map((f) => ({ value: f.id, label: f.label }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select field..." />
                </SelectTrigger>
                <SelectContent>
                  {bulkEditFields.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {currentField && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">New value</Label>
                {currentField.type === "select" && currentField.options ? (
                  <Select
                    value={fieldValue}
                    onValueChange={(v) => setFieldValue(v as string)}
                    items={currentField.options}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select value..." />
                    </SelectTrigger>
                    <SelectContent>
                      {currentField.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={fieldValue}
                    onChange={(e) => setFieldValue(e.target.value)}
                    placeholder={`Enter ${currentField.label.toLowerCase()}...`}
                    className="h-9 text-sm"
                  />
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleApplyChanges}
              disabled={isUpdating || !selectedField}
              className="bg-primary text-white hover:bg-primary/90"
            >
              {isUpdating ? "Applying…" : "Apply changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation dialog */}
      <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive {selectedCount} records?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            These records will be hidden from default views. You can restore them by filtering for
            archived records.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setArchiveDialogOpen(false)}
              disabled={isArchiving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleArchive}
              disabled={isArchiving}
            >
              {isArchiving ? "Archiving…" : `Archive ${selectedCount} records`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk action toolbar — fixed to bottom, slides up when items selected */}
      <div
        className={`
          fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between
          border-t border-border bg-white px-6 py-3 shadow-lg
          transition-transform duration-200 ease-out
          ${isVisible ? "translate-y-0" : "translate-y-full"}
        `}
        aria-hidden={!isVisible}
      >
        {/* Left: selection count */}
        <span className="text-sm font-medium text-foreground">
          {selectedCount} selected
        </span>

        {/* Center: bulk actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenEditDialog}
            className="h-8 gap-1.5 text-sm"
          >
            <Edit className="h-3.5 w-3.5" />
            Edit
          </Button>
          {onMerge && selectedCount >= 2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onMerge}
              className="h-8 gap-1.5 text-sm"
            >
              <Merge className="h-3.5 w-3.5" />
              Merge
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setArchiveDialogOpen(true)}
            className="h-8 gap-1.5 text-sm text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </Button>
        </div>

        {/* Right: export and clear */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="h-8 gap-1.5 text-sm"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
          <button
            type="button"
            onClick={onClearSelection}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}
