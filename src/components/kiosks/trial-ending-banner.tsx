import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import type { TrialEndingSoonItem } from "@/app/(app)/locations/actions";
import { formatDate } from "@/lib/analytics/formatters";

// Phase 7.10 / D11 — banner surfaced on /kiosks when at least one location
// has a free-trial deadline within the configured window. Server-rendered
// (the host page calls `getTrialsEndingSoon` and passes the result in) so
// there's no client-side fetch on initial load.
export function TrialEndingBanner({
  items,
}: {
  items: TrialEndingSoonItem[];
}) {
  if (items.length === 0) return null;

  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800/60 dark:bg-amber-950/30"
      role="alert"
      data-testid="trial-ending-banner"
    >
      <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
      <div className="flex-1 space-y-1.5">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {items.length} free trial{items.length === 1 ? "" : "s"} ending in
          the next 30 days
        </p>
        <ul className="space-y-0.5 text-xs text-amber-900/90 dark:text-amber-200/80">
          {items.slice(0, 5).map((item) => (
            <li key={item.locationId} className="flex items-center gap-2">
              <Link
                href={`/locations/${item.locationId}`}
                className="hover:underline"
              >
                {item.name}
              </Link>
              <span className="text-muted-foreground">·</span>
              <span>
                {item.daysRemaining <= 0
                  ? "expires today"
                  : `${item.daysRemaining} day${item.daysRemaining === 1 ? "" : "s"} left`}
              </span>
              <span className="text-muted-foreground">
                ({formatDate(item.freeTrialEndDate)})
              </span>
            </li>
          ))}
          {items.length > 5 && (
            <li className="italic text-muted-foreground">
              + {items.length - 5} more — see /locations for the full list.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
