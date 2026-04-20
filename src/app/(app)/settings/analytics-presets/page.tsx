"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Plus, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Analytics Presets"
        description="Saved filter configurations for analytics views."
        count={loading ? undefined : presets.length}
        actions={
          <>
            <Link href="/settings">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back to Settings
              </Button>
            </Link>
            <Button onClick={handleCreate} size="sm">
              <Plus className="size-4" />
              Create Preset
            </Button>
          </>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {loading ? (
          <EmptyState icon={SlidersHorizontal} title="Loading presets…" />
        ) : presets.length === 0 ? (
          <EmptyState
            icon={SlidersHorizontal}
            title="No presets yet"
            description="Save the current analytics filter configuration so you can recall it with one click."
            action={
              <Button onClick={handleCreate} size="sm">
                <Plus className="size-4" />
                Create Preset
              </Button>
            }
          />
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
    </div>
  );
}
