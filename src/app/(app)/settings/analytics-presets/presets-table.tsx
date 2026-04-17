"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pencil, Trash2 } from "lucide-react";
import type { PresetRow } from "./actions";

interface PresetsTableProps {
  presets: PresetRow[];
  onEdit: (preset: PresetRow) => void;
  onDelete: (preset: PresetRow) => void;
}

export function PresetsTable({ presets, onEdit, onDelete }: PresetsTableProps) {
  if (presets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No presets yet. Create one to save filter configurations.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Shared</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-24">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {presets.map((preset) => (
          <TableRow key={preset.id}>
            <TableCell className="font-medium">{preset.name}</TableCell>
            <TableCell className="text-muted-foreground">
              {preset.ownerName}
            </TableCell>
            <TableCell>
              {preset.isShared ? (
                <Badge variant="secondary">Shared</Badge>
              ) : (
                <Badge variant="outline">Private</Badge>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {new Date(preset.createdAt).toLocaleDateString()}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onEdit(preset)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onDelete(preset)}
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
