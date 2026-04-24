"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Pre-allocated style objects to avoid re-creation on every render
const DRAG_STYLE = { boxShadow: "0 8px 24px rgba(0,0,0,0.2)", transform: "scale(1.02)" } as const;
const EMPTY_STYLE = {} as const;

interface KioskCardProps {
  id: string;
  kioskId: string;
  venueName: string | null;
  regionGroup: string | null;
  cmsConfigStatus: string | null;
  isDragging?: boolean;
  /** When true, the card is rendered as a DragOverlay ghost (no useSortable) */
  isGhost?: boolean;
  /** When provided, called on click instead of navigating to detail page */
  onSelect?: (id: string) => void;
}

const KioskCardContent = React.memo(function KioskCardContent({
  id,
  kioskId,
  venueName,
  regionGroup,
  cmsConfigStatus,
  isDragging = false,
  onSelect,
}: Omit<KioskCardProps, "isGhost">) {
  const router = useRouter();
  const isCmsConfigured = cmsConfigStatus === "configured";

  const handleClick = () => {
    if (isDragging) return;
    if (onSelect) {
      onSelect(id);
    } else {
      router.push(`/kiosks/${id}`);
    }
  };

  return (
    <div
      data-testid="kiosk-card"
      className={cn(
        "w-full min-h-[80px] p-3 border rounded-lg cursor-pointer select-none bg-card",
        "border-border transition-shadow",
        "hover:shadow-md",
        isDragging
          ? "opacity-80 shadow-xl scale-[1.02]"
          : "opacity-100 shadow-sm"
      )}
      style={isDragging ? DRAG_STYLE : EMPTY_STYLE}
      onClick={handleClick}
    >
      {/* Kiosk ID — 14px Medium */}
      <p className="text-sm font-semibold text-foreground truncate mb-1">
        {kioskId}
      </p>

      {/* Venue name — 14px Book */}
      {venueName && (
        <p className="text-sm text-muted-foreground truncate mb-1.5">
          {venueName}
        </p>
      )}

      {/* Footer row: region badge + CMS status dot */}
      <div className="flex items-center justify-between gap-2 mt-auto">
        {regionGroup ? (
          <Badge
            variant="secondary"
            className="text-xs max-w-[120px] truncate"
          >
            {regionGroup}
          </Badge>
        ) : (
          <span />
        )}

        {/* CMS config status indicator */}
        <div
          className={cn(
            "w-2 h-2 rounded-full flex-shrink-0",
            isCmsConfigured ? "bg-[--color-wk-success]" : "bg-border"
          )}
          title={isCmsConfigured ? "CMS Configured" : "CMS Not Configured"}
        />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// KioskCard — draggable variant using useSortable
// ---------------------------------------------------------------------------

export function KioskCard({
  id,
  kioskId,
  venueName,
  regionGroup,
  cmsConfigStatus,
  isGhost = false,
  onSelect,
}: KioskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isGhost) {
    return (
      <KioskCardContent
        id={id}
        kioskId={kioskId}
        venueName={venueName}
        regionGroup={regionGroup}
        cmsConfigStatus={cmsConfigStatus}
        isDragging={true}
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <KioskCardContent
        id={id}
        kioskId={kioskId}
        venueName={venueName}
        regionGroup={regionGroup}
        cmsConfigStatus={cmsConfigStatus}
        isDragging={isDragging}
        onSelect={onSelect}
      />
    </div>
  );
}
