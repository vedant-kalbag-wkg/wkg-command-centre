"use client";

import * as React from "react";
import type { Table, RowData } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Extend TableMeta to include our updateField callback
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    updateField?: (
      rowId: string,
      columnId: string,
      value: string | null
    ) => void | Promise<void>;
  }
}

export type EditableCellOption = { value: string; label: string };

interface EditableCellProps {
  value: string | number | null;
  rowId: string;
  columnId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: Table<any>;
  type?: "text" | "number" | "select";
  placeholder?: string;
  /**
   * When type === "select", `options` is required. The stored value is
   * matched against `value`; the shown label comes from `label`.
   * `displayValue` is an optional override for showing the label outside the
   * dropdown (e.g. when the underlying cell value is an FK id but the row
   * already denormalises the display name).
   */
  options?: EditableCellOption[];
  displayValue?: string | null;
}

export const EditableCell = React.memo(function EditableCell({
  value,
  rowId,
  columnId,
  table,
  type = "text",
  placeholder = "—",
  options,
  displayValue,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(
    value !== null && value !== undefined ? String(value) : ""
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Sync external value changes (e.g. after router.refresh)
  React.useEffect(() => {
    if (!isEditing) {
      setEditValue(value !== null && value !== undefined ? String(value) : "");
    }
  }, [value, isEditing]);

  // Focus the input when entering edit mode
  React.useEffect(() => {
    if (isEditing && type !== "select") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing, type]);

  function handleClick(e: React.MouseEvent) {
    // Stop propagation to prevent row onClick (navigation) from firing
    e.stopPropagation();
    setIsEditing(true);
  }

  async function commitEdit(next?: string | null) {
    const originalStr =
      value !== null && value !== undefined ? String(value) : "";
    const raw = next !== undefined ? next : editValue;
    setIsEditing(false);
    if (raw === null) {
      if (originalStr === "") return;
      setIsSaving(true);
      try {
        await table.options.meta?.updateField?.(rowId, columnId, null);
      } finally {
        setIsSaving(false);
      }
      return;
    }
    const trimmed = typeof raw === "string" ? raw.trim() : String(raw);
    if (trimmed === originalStr) return;
    const newValue = trimmed === "" ? null : trimmed;
    setIsSaving(true);
    try {
      await table.options.meta?.updateField?.(rowId, columnId, newValue);
    } finally {
      setIsSaving(false);
    }
  }

  function handleBlur() {
    commitEdit();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      // Revert to original value
      setEditValue(
        value !== null && value !== undefined ? String(value) : ""
      );
      setIsEditing(false);
    }
  }

  // --- Select type ---------------------------------------------------------
  if (type === "select") {
    const opts = options ?? [];
    const currentValueStr =
      value !== null && value !== undefined ? String(value) : "";
    const matched = opts.find((o) => o.value === currentValueStr);
    const label =
      displayValue !== undefined && displayValue !== null && displayValue !== ""
        ? displayValue
        : matched?.label ?? currentValueStr;

    if (!isEditing) {
      return (
        <span
          role="button"
          tabIndex={0}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              setIsEditing(true);
            }
          }}
          className="inline-flex items-center min-w-[60px] max-w-full cursor-pointer rounded px-1 -mx-1 hover:bg-border/20 transition-colors overflow-hidden"
          title="Click to edit"
        >
          {label ? (
            <span className="text-sm truncate">{label}</span>
          ) : (
            <span className="text-muted-foreground text-sm">{placeholder}</span>
          )}
        </span>
      );
    }

    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Select
          items={opts}
          value={currentValueStr}
          onValueChange={(val) => {
            // null = user cleared. base-ui may emit null/undefined on clear.
            void commitEdit(val === null || val === undefined ? null : String(val));
          }}
          defaultOpen
        >
          <SelectTrigger
            size="sm"
            className="h-8 min-w-[120px] w-full text-sm"
            onBlur={() => {
              // Close edit on blur without forced save (value already saved on change)
              setIsEditing(false);
            }}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {opts.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // --- Text / number -------------------------------------------------------
  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        type={type}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="h-8 text-sm border-border focus-visible:ring-ring focus-visible:border-primary px-2 py-0 min-w-[80px]"
      />
    );
  }

  const display =
    value !== null && value !== undefined && String(value) !== "" ? (
      <span className="text-sm truncate">{String(value)}</span>
    ) : (
      <span className="text-muted-foreground text-sm">{placeholder}</span>
    );

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          setIsEditing(true);
        }
      }}
      aria-busy={isSaving || undefined}
      className="inline-flex items-center min-w-[60px] max-w-full cursor-text rounded px-1 -mx-1 hover:bg-border/20 transition-colors overflow-hidden"
      title="Click to edit"
    >
      {display}
    </span>
  );
});
