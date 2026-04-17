"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  DIMENSION_FIELDS,
  METRIC_FIELDS,
  type FieldDefinition,
} from "@/lib/stores/pivot-store";

// ─── Draggable Field Chip ───────────────────────────────────────────────────

function DraggableChip({ field }: { field: FieldDefinition }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: field.id,
      data: { field },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`cursor-grab rounded-md border px-3 py-1.5 text-xs font-medium select-none transition-colors ${
        field.type === "dimension"
          ? "border-[#00A6D3]/30 bg-[#00A6D3]/10 text-[#00A6D3] hover:bg-[#00A6D3]/20"
          : "border-[#121212]/20 bg-[#121212]/5 text-[#121212] hover:bg-[#121212]/10"
      }`}
    >
      {field.label}
    </div>
  );
}

// ─── Field List Panel ───────────────────────────────────────────────────────

export function FieldList() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Dimensions
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {DIMENSION_FIELDS.map((field) => (
            <DraggableChip key={field.id} field={field} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Metrics
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {METRIC_FIELDS.map((field) => (
            <DraggableChip key={field.id} field={field} />
          ))}
        </div>
      </div>
    </div>
  );
}
