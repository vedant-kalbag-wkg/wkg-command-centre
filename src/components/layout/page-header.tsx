import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  count?: number;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  count,
  breadcrumb,
  actions,
  toolbar,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("border-b bg-background", className)}>
      <div className="flex flex-col gap-1 px-6 py-4">
        {breadcrumb}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h1>
              {count !== undefined && (
                <span className="text-sm text-muted-foreground">
                  · {count.toLocaleString()}
                </span>
              )}
            </div>
            {description && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0">{actions}</div>
          )}
        </div>
      </div>
      {toolbar && (
        <div className="flex items-center gap-2 px-6 py-2 border-t bg-muted/30">
          {toolbar}
        </div>
      )}
    </div>
  );
}
