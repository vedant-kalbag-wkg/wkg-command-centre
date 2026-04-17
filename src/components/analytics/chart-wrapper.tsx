"use client"

import { ResponsiveContainer } from "recharts"
import { Skeleton } from "@/components/ui/skeleton"

interface ChartWrapperProps {
  loading?: boolean
  minHeight?: number
  children: React.ReactNode
}

export function ChartWrapper({
  loading = false,
  minHeight = 300,
  children,
}: ChartWrapperProps) {
  if (loading) {
    return <Skeleton className="w-full rounded-lg" style={{ minHeight }} />
  }

  return (
    <ResponsiveContainer width="100%" minHeight={minHeight}>
      {children as React.ReactElement}
    </ResponsiveContainer>
  )
}
