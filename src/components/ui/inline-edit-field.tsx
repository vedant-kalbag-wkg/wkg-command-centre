"use client";

import { useState, useRef, useCallback, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Loader2, CalendarIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";

export type InlineEditFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "date"
  | "switch";

export interface InlineEditFieldOption {
  label: string;
  value: string;
}

interface InlineEditFieldProps {
  value: string | boolean | null | undefined;
  onSave: (newValue: string | boolean) => Promise<void>;
  fieldName: string;
  type: InlineEditFieldType;
  options?: InlineEditFieldOption[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function InlineEditField({
  value,
  onSave,
  fieldName,
  type,
  options = [],
  disabled = false,
  placeholder,
  className,
}: InlineEditFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState<string>(() => {
    if (value === null || value === undefined) return "";
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value);
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const displayValue = () => {
    if (value === null || value === undefined || value === "") return placeholder ?? "—";
    if (type === "switch") return (value as boolean) ? "Yes" : "No";
    if (type === "select") {
      const opt = options.find((o) => o.value === String(value));
      return opt?.label ?? String(value);
    }
    if (type === "date" && value) {
      try {
        return format(new Date(value as string), "dd MMM yyyy");
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  const handleSave = useCallback(
    async (val: string | boolean) => {
      if (isSaving) return;
      setIsSaving(true);
      setError(null);
      try {
        await onSave(val);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 200);
        setIsEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save. Try again.");
      } finally {
        setIsSaving(false);
      }
    },
    [isSaving, onSave]
  );

  const handleBlur = () => {
    if (type === "switch" || type === "select" || type === "date") return;
    handleSave(editValue);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" && type !== "textarea") {
      e.preventDefault();
      handleSave(editValue);
    }
    if (e.key === "Escape") {
      setEditValue(value === null || value === undefined ? "" : String(value));
      setIsEditing(false);
      setError(null);
    }
  };

  const startEdit = () => {
    if (disabled) return;
    setEditValue(() => {
      if (value === null || value === undefined) return "";
      if (typeof value === "boolean") return value ? "true" : "false";
      return String(value);
    });
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const borderClass = showSuccess
    ? "border-[--color-wk-success]"
    : error
    ? "border-destructive"
    : isEditing
    ? "border-primary"
    : "border-border";

  // Switch type — toggle directly without entering edit mode
  if (type === "switch") {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Switch
          checked={!!value}
          disabled={disabled || isSaving}
          onCheckedChange={(checked) => handleSave(checked)}
        />
        {isSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {error && <p className="text-[12px] text-destructive">{error}</p>}
      </div>
    );
  }

  // Select type
  if (type === "select") {
    // Pass items to Select.Root so SelectValue can display the label when dropdown is closed
    const selectItems = options.map((opt) => ({ value: opt.value, label: opt.label }));
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <Select
          value={value ? String(value) : ""}
          disabled={disabled || isSaving}
          items={selectItems}
          onValueChange={(val) => {
            if (val !== null) handleSave(val as string);
          }}
        >
          <SelectTrigger
            className={cn(
              "h-9 text-sm border transition-colors",
              borderClass,
              showSuccess && "border-[--color-wk-success]",
              isSaving && "opacity-60"
            )}
          >
            <SelectValue placeholder={placeholder ?? `Select ${fieldName}`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isSaving && (
          <div className="flex items-center gap-1 text-[12px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving…
          </div>
        )}
        {error && <p className="text-[12px] text-destructive">{error}</p>}
      </div>
    );
  }

  // Date type — uses Popover from base-ui (no asChild support)
  if (type === "date") {
    const dateValue = value
      ? (() => {
          try {
            return new Date(value as string);
          } catch {
            return undefined;
          }
        })()
      : undefined;

    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <Popover>
          <PopoverTrigger
            disabled={disabled || isSaving}
            className={cn(
              "inline-flex h-9 w-full items-center justify-start rounded-lg border px-3 text-sm font-normal transition-colors",
              "bg-background text-left",
              borderClass,
              !dateValue && "text-muted-foreground",
              isSaving && "opacity-60"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {dateValue ? format(dateValue, "dd MMM yyyy") : (placeholder ?? "Select date")}
          </PopoverTrigger>
          <PopoverContent align="start">
            <Calendar
              mode="single"
              selected={dateValue}
              onSelect={(date) => {
                if (date) {
                  handleSave(date.toISOString());
                }
              }}
            />
          </PopoverContent>
        </Popover>
        {isSaving && (
          <div className="flex items-center gap-1 text-[12px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving…
          </div>
        )}
        {error && <p className="text-[12px] text-destructive">{error}</p>}
      </div>
    );
  }

  // Text / textarea / number — inline click-to-edit
  if (!isEditing) {
    return (
      <div
        className={cn("flex flex-col gap-1", className)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span
          onClick={startEdit}
          className={cn(
            "min-h-[1.5rem] cursor-text text-sm text-foreground transition-all",
            isHovered && !disabled && "underline decoration-border underline-offset-2",
            disabled && "cursor-not-allowed opacity-60",
            showSuccess && "text-[--color-wk-success]",
            !value && "text-muted-foreground"
          )}
        >
          {displayValue()}
        </span>
        {error && <p className="text-[12px] text-destructive">{error}</p>}
      </div>
    );
  }

  const inputBaseClass = cn(
    "w-full rounded-md border px-3 py-1.5 text-sm outline-none transition-colors",
    "focus:ring-1 focus:ring-ring",
    borderClass,
    isSaving && "opacity-60"
  );

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="relative">
        {type === "textarea" ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            disabled={isSaving}
            rows={3}
            className={cn(inputBaseClass, "resize-y")}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={type === "number" ? "number" : "text"}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            disabled={isSaving}
            className={inputBaseClass}
          />
        )}
        {isSaving && (
          <Loader2 className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  );
}
