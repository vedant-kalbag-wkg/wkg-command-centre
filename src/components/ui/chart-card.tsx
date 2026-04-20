"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

interface ChartCardProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function ChartCard({
  title,
  description,
  action,
  loading,
  empty,
  emptyMessage = "No data",
  collapsible,
  defaultCollapsed,
  className,
  children,
}: ChartCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
  const showContent = !collapsed;

  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {action}
          {collapsible && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={collapsed ? "Expand" : "Collapse"}
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronUp className="size-4" />
              )}
            </Button>
          )}
        </div>
      </div>
      {showContent && (
        <div className="flex-1 p-4">
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : empty ? (
            <EmptyState title={emptyMessage} />
          ) : (
            children
          )}
        </div>
      )}
    </Card>
  );
}
