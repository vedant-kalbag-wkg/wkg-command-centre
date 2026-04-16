"use client";

import * as React from "react";
import type { Table, RowData } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";

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

interface EditableCellProps {
  value: string | number | null;
  rowId: string;
  columnId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: Table<any>;
  type?: "text" | "number";
  placeholder?: string;
}

export function EditableCell({
  value,
  rowId,
  columnId,
  table,
  type = "text",
  placeholder = "—",
}: EditableCellProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(
    value !== null && value !== undefined ? String(value) : ""
  );
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Sync external value changes (e.g. after router.refresh)
  React.useEffect(() => {
    if (!isEditing) {
      setEditValue(value !== null && value !== undefined ? String(value) : "");
    }
  }, [value, isEditing]);

  // Focus the input when entering edit mode
  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  function handleClick(e: React.MouseEvent) {
    // Stop propagation to prevent row onClick (navigation) from firing
    e.stopPropagation();
    setIsEditing(true);
  }

  async function commitEdit() {
    const originalStr =
      value !== null && value !== undefined ? String(value) : "";
    setIsEditing(false);
    if (editValue === originalStr) return;
    const newValue = editValue.trim() === "" ? null : editValue.trim();
    await table.options.meta?.updateField?.(rowId, columnId, newValue);
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
        className="h-8 text-sm border-wk-mid-grey focus-visible:ring-wk-azure focus-visible:border-wk-azure px-2 py-0 min-w-[80px]"
      />
    );
  }

  const displayValue =
    value !== null && value !== undefined && String(value) !== "" ? (
      <span className="text-sm">{String(value)}</span>
    ) : (
      <span className="text-wk-mid-grey text-sm">{placeholder}</span>
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
      className="inline-flex items-center min-w-[60px] cursor-text rounded px-1 -mx-1 hover:bg-wk-mid-grey/20 transition-colors"
      title="Click to edit"
    >
      {displayValue}
    </span>
  );
}
