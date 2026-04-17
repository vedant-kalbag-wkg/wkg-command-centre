"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import { createActionItem } from "@/app/(app)/analytics/actions-dashboard/actions";
import type { ActionItemType } from "@/lib/analytics/types";

interface CreateActionDialogProps {
  locationId?: string;
  locationName?: string;
  sourceType?: "flag" | "manual" | "data_quality";
  sourceId?: string;
  defaultTitle?: string;
  onCreated?: () => void;
  children: React.ReactNode;
}

export function CreateActionDialog({
  locationId,
  locationName,
  sourceType = "manual",
  sourceId,
  defaultTitle = "",
  onCreated,
  children,
}: CreateActionDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [actionType, setActionType] = useState<ActionItemType>("investigation");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (next) setTitle(defaultTitle);
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    startTransition(async () => {
      await createActionItem({
        title: title.trim(),
        actionType,
        description: description.trim() || undefined,
        dueDate: dueDate || undefined,
        locationId: locationId || undefined,
        sourceType,
        sourceId: sourceId || undefined,
      });
      setOpen(false);
      setTitle("");
      setDescription("");
      setDueDate("");
      onCreated?.();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<span />}>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Action Item</DialogTitle>
            <DialogDescription>
              {locationName
                ? `Create an action for ${locationName}`
                : "Create a new action item"}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="action-title">Title</Label>
              <Input
                id="action-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="action-type">Action Type</Label>
              <Select
                value={actionType}
                onValueChange={(v) => setActionType(v as ActionItemType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="investigation">Investigation</SelectItem>
                  <SelectItem value="relocation">Relocation</SelectItem>
                  <SelectItem value="training">Training</SelectItem>
                  <SelectItem value="equipment_change">Equipment Change</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="action-desc">Description (optional)</Label>
              <Textarea
                id="action-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Additional details..."
                rows={3}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="action-due">Due Date (optional)</Label>
              <Input
                id="action-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit" disabled={isPending || !title.trim()}>
              {isPending ? "Creating..." : "Create Action"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
