"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { PresetsTable } from "./presets-table";
import { PresetForm } from "./preset-form";
import {
  listPresets,
  createPreset,
  updatePreset,
  deletePreset,
  type PresetRow,
} from "./actions";

export default function AnalyticsPresetsPage() {
  const [presets, setPresets] = React.useState<PresetRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PresetRow | null>(null);

  const refresh = React.useCallback(async () => {
    const result = await listPresets();
    if ("presets" in result) {
      setPresets(result.presets);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleEdit = (preset: PresetRow) => {
    setEditing(preset);
    setFormOpen(true);
  };

  const handleDelete = async (preset: PresetRow) => {
    if (!confirm(`Delete preset "${preset.name}"?`)) return;
    const result = await deletePreset(preset.id);
    if ("error" in result) {
      alert(result.error);
    } else {
      await refresh();
    }
  };

  const handleSubmit = async (data: {
    name: string;
    config: Record<string, unknown>;
    isShared: boolean;
  }) => {
    if (editing) {
      const result = await updatePreset(editing.id, data);
      if ("error" in result) throw new Error(result.error);
    } else {
      const result = await createPreset(data);
      if ("error" in result) throw new Error(result.error);
    }
    await refresh();
  };

  return (
    <AppShell
      title="Analytics Presets"
      action={
        <Link href="/settings">
          <Button variant="ghost" size="sm" className="text-wk-night-grey">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Settings
          </Button>
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Saved filter configurations for analytics views.
          </p>
          <Button onClick={handleCreate} size="sm">
            <Plus className="size-4" />
            Create Preset
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Loading...
          </p>
        ) : (
          <PresetsTable
            presets={presets}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </div>

      <PresetForm
        open={formOpen}
        onOpenChange={setFormOpen}
        preset={editing}
        onSubmit={handleSubmit}
      />
    </AppShell>
  );
}
