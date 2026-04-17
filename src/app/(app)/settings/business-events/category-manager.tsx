"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, Trash2, Plus, Check, X } from "lucide-react";
import type { CategoryRow } from "./actions";

interface CategoryManagerProps {
  categories: CategoryRow[];
  onCreateCategory: (data: { name: string; color: string }) => Promise<void>;
  onUpdateCategory: (
    id: string,
    data: { name?: string; color?: string },
  ) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
}

export function CategoryManager({
  categories,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
}: CategoryManagerProps) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editColor, setEditColor] = React.useState("");
  const [showCreate, setShowCreate] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newColor, setNewColor] = React.useState("#666666");
  const [saving, setSaving] = React.useState(false);

  const startEdit = (cat: CategoryRow) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditColor(cat.color);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditColor("");
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    try {
      await onUpdateCategory(editingId, {
        name: editName.trim(),
        color: editColor,
      });
      cancelEdit();
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await onCreateCategory({ name: newName.trim(), color: newColor });
      setNewName("");
      setNewColor("#666666");
      setShowCreate(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cat: CategoryRow) => {
    if (!confirm(`Delete category "${cat.name}"?`)) return;
    await onDeleteCategory(cat.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage event categories used to classify business events.
        </p>
        <Button size="sm" onClick={() => setShowCreate(true)} disabled={showCreate}>
          <Plus className="size-4" />
          Add Category
        </Button>
      </div>

      {showCreate && (
        <div className="flex items-end gap-3 rounded-lg border p-3">
          <div className="space-y-1 flex-1">
            <Label htmlFor="new-cat-name" className="text-xs">
              Name
            </Label>
            <Input
              id="new-cat-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Promotion"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-cat-color" className="text-xs">
              Color
            </Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                id="new-cat-color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-8 w-8 cursor-pointer rounded border-0"
              />
              <Input
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="w-24 font-mono text-xs"
              />
            </div>
          </div>
          <Button size="sm" onClick={handleCreate} disabled={saving}>
            <Check className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowCreate(false);
              setNewName("");
              setNewColor("#666666");
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No categories yet. Add one to classify business events.
        </p>
      ) : (
        <div className="space-y-2">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              {editingId === cat.id ? (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="h-6 w-6 cursor-pointer rounded border-0"
                    />
                    <Input
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="w-24 font-mono text-xs"
                    />
                  </div>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={saveEdit}
                    disabled={saving}
                  >
                    <Check className="size-3.5" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={cancelEdit}>
                    <X className="size-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <span
                    className="inline-block size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="flex-1 text-sm font-medium">{cat.name}</span>
                  {cat.isCore && (
                    <Badge variant="outline" className="text-xs">
                      Core
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => startEdit(cat)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(cat)}
                    disabled={cat.isCore}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
