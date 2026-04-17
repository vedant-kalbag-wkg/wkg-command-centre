"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
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
import type { EventRow, CategoryRow } from "./actions";

const SCOPE_TYPES = ["global", "hotel", "region", "hotel_group"] as const;

interface EventFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: EventRow | null;
  categories: CategoryRow[];
  onSubmit: (data: {
    title: string;
    description?: string;
    categoryId: string;
    startDate: string;
    endDate?: string;
    scopeType?: string;
    scopeValue?: string;
  }) => Promise<void>;
}

export function EventForm({
  open,
  onOpenChange,
  event,
  categories,
  onSubmit,
}: EventFormProps) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [scopeType, setScopeType] = React.useState("global");
  const [scopeValue, setScopeValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isEdit = !!event;

  React.useEffect(() => {
    if (open) {
      if (event) {
        setTitle(event.title);
        setDescription(event.description ?? "");
        setCategoryId(event.categoryId);
        setStartDate(event.startDate);
        setEndDate(event.endDate ?? "");
        setScopeType(event.scopeType ?? "global");
        setScopeValue(event.scopeValue ?? "");
      } else {
        setTitle("");
        setDescription("");
        setCategoryId(categories[0]?.id ?? "");
        setStartDate("");
        setEndDate("");
        setScopeType("global");
        setScopeValue("");
      }
      setError(null);
    }
  }, [open, event, categories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!categoryId) {
      setError("Category is required");
      return;
    }
    if (!startDate) {
      setError("Start date is required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        categoryId,
        startDate,
        endDate: endDate || undefined,
        scopeType: scopeType || undefined,
        scopeValue: scopeValue.trim() || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Event" : "Create Event"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the business event details."
              : "Add a business event to annotate analytics charts."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="event-title">Title</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Summer Promotion 2026"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-category">Category</Label>
            <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
              <SelectTrigger className="w-full" id="event-category">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block size-2.5 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      {cat.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="event-start">Start Date</Label>
              <Input
                id="event-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-end">End Date (optional)</Label>
              <Input
                id="event-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-description">Description (optional)</Label>
            <textarea
              id="event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="Describe the event..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="event-scope-type">Scope</Label>
              <Select value={scopeType} onValueChange={(v) => setScopeType(v ?? "global")}>
                <SelectTrigger className="w-full" id="event-scope-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_TYPES.map((st) => (
                    <SelectItem key={st} value={st}>
                      {st.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {scopeType !== "global" && (
              <div className="space-y-2">
                <Label htmlFor="event-scope-value">Scope Value</Label>
                <Input
                  id="event-scope-value"
                  value={scopeValue}
                  onChange={(e) => setScopeValue(e.target.value)}
                  placeholder={
                    scopeType === "hotel"
                      ? "Hotel name or code"
                      : scopeType === "region"
                        ? "Region name"
                        : "Group name"
                  }
                />
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : isEdit ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
