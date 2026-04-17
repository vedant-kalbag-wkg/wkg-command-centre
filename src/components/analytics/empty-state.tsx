"use client"

import { InboxIcon } from "lucide-react"

interface EmptyStateProps {
  message?: string
  icon?: React.ReactNode
}

export function EmptyState({
  message = "No data for selected filters",
  icon,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      {icon ?? <InboxIcon className="size-10 opacity-40" />}
      <p className="text-sm">{message}</p>
    </div>
  )
}
