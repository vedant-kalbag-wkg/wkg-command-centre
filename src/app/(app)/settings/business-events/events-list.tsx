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
import type { EventRow } from "./actions";

interface EventsListProps {
  events: EventRow[];
  onEdit: (event: EventRow) => void;
  onDelete: (event: EventRow) => void;
}

export function EventsList({ events, onEdit, onDelete }: EventsListProps) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No business events yet. Create one to annotate trend charts.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Start Date</TableHead>
          <TableHead>End Date</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead className="w-24">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.id}>
            <TableCell className="font-medium">{event.title}</TableCell>
            <TableCell>
              <Badge
                variant="secondary"
                className="gap-1.5"
              >
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: event.categoryColor }}
                />
                {event.categoryName}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {event.startDate}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {event.endDate ?? "--"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {event.scopeType
                ? `${event.scopeType}${event.scopeValue ? `: ${event.scopeValue}` : ""}`
                : "global"}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onEdit(event)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onDelete(event)}
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
