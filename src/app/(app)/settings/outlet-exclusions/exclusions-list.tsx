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
import { Trash2 } from "lucide-react";
import type { ExclusionRow } from "./actions";

interface ExclusionsListProps {
  exclusions: ExclusionRow[];
  matchCounts: Record<string, number>;
  onDelete: (exclusion: ExclusionRow) => void;
}

export function ExclusionsList({
  exclusions,
  matchCounts,
  onDelete,
}: ExclusionsListProps) {
  if (exclusions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No exclusion rules defined. Add one to filter outlet codes from analytics.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pattern</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Label</TableHead>
          <TableHead>Matched</TableHead>
          <TableHead className="w-16">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {exclusions.map((excl) => (
          <TableRow key={excl.id}>
            <TableCell className="font-mono text-sm">{excl.outletCode}</TableCell>
            <TableCell>
              <Badge variant={excl.patternType === "regex" ? "default" : "secondary"}>
                {excl.patternType}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {excl.label ?? "--"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {matchCounts[excl.id] !== undefined ? matchCounts[excl.id] : "--"}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onDelete(excl)}
              >
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
