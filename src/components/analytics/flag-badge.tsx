"use client";

import { AlertTriangle, Eye, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlagType } from "@/lib/analytics/types";

const flagConfig: Record<
  FlagType,
  { label: string; icon: typeof AlertTriangle; className: string }
> = {
  relocate: {
    label: "Relocate",
    icon: AlertTriangle,
    className:
      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  },
  monitor: {
    label: "Monitor",
    icon: Eye,
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
  strategic_exception: {
    label: "Strategic",
    icon: Shield,
    className:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  },
};

interface FlagBadgeProps {
  flagType: FlagType;
  className?: string;
}

export function FlagBadge({ flagType, className }: FlagBadgeProps) {
  const config = flagConfig[flagType];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        config.className,
        className,
      )}
    >
      <Icon className="size-3" />
      {config.label}
    </span>
  );
}
