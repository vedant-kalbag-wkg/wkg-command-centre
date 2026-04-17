"use client"

import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
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
  if (loading) {
    return (
      <Card size="sm">
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-16" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      size="sm"
      className={cn(primary && "border-l-4 border-l-[var(--wk-azure,#00A6D3)]")}
    >
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          <span>{title}</span>
        </div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {change && (
          <div className="flex items-center gap-1 text-xs" style={{ color: change.color }}>
            {(() => {
              const Icon = directionIcons[change.direction]
              return <Icon className="size-3" />
            })()}
            <span>{change.text}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
