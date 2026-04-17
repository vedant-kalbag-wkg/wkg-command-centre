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
import { Switch } from "@/components/ui/switch";
import type { PresetRow } from "./actions";

interface PresetFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: PresetRow | null;
  onSubmit: (data: {
    name: string;
    config: Record<string, unknown>;
    isShared: boolean;
  }) => Promise<void>;
}

export function PresetForm({
  open,
  onOpenChange,
  preset,
  onSubmit,
}: PresetFormProps) {
  const [name, setName] = React.useState("");
  const [isShared, setIsShared] = React.useState(false);
  const [configJson, setConfigJson] = React.useState("{}");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isEdit = !!preset;

  React.useEffect(() => {
    if (open) {
      if (preset) {
        setName(preset.name);
        setIsShared(preset.isShared);
        setConfigJson(JSON.stringify(preset.config ?? {}, null, 2));
      } else {
        setName("");
        setIsShared(false);
        setConfigJson("{}");
      }
      setError(null);
    }
  }, [open, preset]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(configJson);
    } catch {
      setError("Invalid JSON in config field");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), config, isShared });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Preset" : "Create Preset"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the preset name, config, or sharing settings."
              : "Save a filter configuration as a reusable preset."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="preset-name">Name</Label>
            <Input
              id="preset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Monthly Revenue Overview"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="preset-config">Config (JSON)</Label>
            <textarea
              id="preset-config"
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              rows={5}
              className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm font-mono transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder='{"filters": {}, "dimensions": []}'
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={isShared}
              onCheckedChange={setIsShared}
              id="preset-shared"
            />
            <Label htmlFor="preset-shared">Share with team</Label>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

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
