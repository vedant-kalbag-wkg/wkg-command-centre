"use client";

import Link from "next/link";
import { useEffect } from "react";
import { format } from "date-fns";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CalendarEventData } from "@/lib/calendar-utils";

interface CalendarEventPopoverProps {
  event: CalendarEventData | null;
  open: boolean;
  onClose: () => void;
}

function formatDateRange(start: Date, end: Date): string {
  if (start.toDateString() === end.toDateString()) {
    return format(start, "d MMM yyyy");
  }
  return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    planned: "bg-border text-white",
    active: "bg-primary text-primary-foreground",
    complete: "bg-[--color-wk-success] text-white",
  };
  const className = variants[status] ?? "bg-border text-white";
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function MilestoneTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    contract_signing: "Contract Signing",
    go_live: "Go-live",
    review_date: "Review Date",
    other: "Other",
  };
  return (
    <Badge variant="secondary" className="text-xs">
      {labels[type] ?? type}
    </Badge>
  );
}

export function CalendarEventPopover({
  event,
  open,
  onClose,
}: CalendarEventPopoverProps) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open || !event) return null;

  const renderContent = () => {
    if (event.type === "installation") {
      return (
        <>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">
                {event.title}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatDateRange(event.start, event.end)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex flex-col gap-1.5 mb-3">
            {event.status && <StatusBadge status={event.status} />}
            {event.regionSlug && event.regionSlug !== "default" && (
              <p className="text-xs text-muted-foreground">
                Region: {event.regionSlug}
              </p>
            )}
          </div>
          <Link
            href={`/installations/${event.entityId}`}
            className="text-xs font-medium text-primary hover:underline"
            onClick={onClose}
          >
            View installation →
          </Link>
        </>
      );
    }

    if (event.type === "milestone") {
      return (
        <>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">
                {event.milestoneName ?? event.title}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {format(event.start, "d MMM yyyy")}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex flex-col gap-1.5 mb-3">
            {event.milestoneType && (
              <MilestoneTypeBadge type={event.milestoneType} />
            )}
            {event.installationName && (
              <p className="text-xs text-muted-foreground">
                Installation: {event.installationName}
              </p>
            )}
          </div>
          <Link
            href={`/installations/${event.entityId}`}
            className="text-xs font-medium text-primary hover:underline"
            onClick={onClose}
          >
            View installation →
          </Link>
        </>
      );
    }

    // trial-expiry
    return (
      <>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <p className="text-sm font-semibold text-foreground leading-tight">
              {event.kioskDisplayId ?? event.title}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Trial ends {format(event.start, "d MMM yyyy")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <Link
          href={`/kiosks/${event.entityId}`}
          className="text-xs font-medium text-primary hover:underline"
          onClick={onClose}
        >
          View kiosk →
        </Link>
      </>
    );
  };

  return (
    <>
      {/* Backdrop — click to close */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Popover card — anchored top-right of calendar area */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Event details: ${event.title}`}
        className="absolute top-14 right-4 z-50 w-64 rounded-lg border border-border bg-popover p-4 shadow-md text-popover-foreground"
      >
        {renderContent()}
      </div>
    </>
  );
}
