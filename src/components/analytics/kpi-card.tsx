"use client"

import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

interface KpiCardProps {
  title: string
  value: string
  change?: { text: string; color: string; direction: "up" | "down" | "neutral" }
  loading?: boolean
  primary?: boolean
  icon?: React.ReactNode
}

const directionIcons = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus,
}

export function KpiCard({
  title,
  value,
  change,
  loading = false,
  primary = false,
  icon,
}: KpiCardProps) {
  const borderClass = primary ? "border-l-4 border-l-[var(--wk-azure,#00A6D3)]" : ""

  if (loading) {
    return (
      <div
        className={cn(
          "flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm p-4",
          borderClass,
        )}
      >
        <Skeleton className="h-4 w-20 mb-3" />
        <Skeleton className="h-7 w-24 mb-2" />
        <Skeleton className="h-4 w-16" />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm p-4",
        borderClass,
      )}
    >
      {/* Title row */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-sm font-medium text-muted-foreground truncate">
          {title}
        </span>
        {icon && (
          <div className="shrink-0 text-muted-foreground">{icon}</div>
        )}
      </div>

      {/* Value */}
      <p
        className="text-xl lg:text-2xl font-bold leading-tight"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </p>

      {/* Change indicator */}
      {change && (
        <div
          className="flex items-center gap-1 text-sm font-medium mt-1"
          style={{ color: change.color }}
        >
          {(() => {
            const Icon = directionIcons[change.direction]
            return <Icon size={14} className="shrink-0" />
          })()}
          <span className="whitespace-nowrap">{change.text}</span>
        </div>
      )}
    </div>
  )
}
