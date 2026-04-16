"use client";

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { flexRender, type Header } from "@tanstack/react-table";
import { GripVertical } from "lucide-react";
import { TableHead } from "@/components/ui/table";

interface DraggableTableHeadProps<TData> {
  header: Header<TData, unknown>;
}

function DraggableTableHeadInner<TData>({
  header,
}: DraggableTableHeadProps<TData>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: header.id });

  const style: React.CSSProperties = {
    width: header.getSize(),
    minWidth: header.column.id === "select" ? 40 : 60,
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? "none" : transition,
    opacity: isDragging ? 0.6 : 1,
    position: "relative",
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <TableHead
      ref={setNodeRef}
      className="text-xs font-medium text-wk-graphite uppercase tracking-wide select-none group/header"
      style={style}
    >
      <div className="flex items-center gap-0.5">
        {/* Drag handle */}
        {!header.isPlaceholder && header.column.id !== "select" && (
          <span
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing opacity-0 group-hover/header:opacity-50 hover:!opacity-100 transition-opacity shrink-0"
          >
            <GripVertical className="size-3.5 text-wk-night-grey" />
          </span>
        )}

        {/* Column header content (clickable for sort) */}
        {header.isPlaceholder ? null : (
          <span
            className="inline-flex items-center gap-1 cursor-pointer flex-1 min-w-0 truncate"
            onClick={header.column.getToggleSortingHandler()}
          >
            {flexRender(
              header.column.columnDef.header,
              header.getContext()
            )}
            {header.column.getIsSorted() === "asc" && " \u2191"}
            {header.column.getIsSorted() === "desc" && " \u2193"}
          </span>
        )}
      </div>

      {/* Resize handle */}
      {header.column.getCanResize() && (
        <div
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none ${
            header.column.getIsResizing()
              ? "bg-wk-azure"
              : "bg-transparent hover:bg-wk-azure/40"
          }`}
        />
      )}
    </TableHead>
  );
}

export const DraggableTableHead = React.memo(DraggableTableHeadInner) as typeof DraggableTableHeadInner;
