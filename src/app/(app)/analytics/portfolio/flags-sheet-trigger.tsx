"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlagBadge } from "@/components/analytics/flag-badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { formatDate } from "@/lib/analytics/formatters";
import type { LocationFlag } from "@/lib/analytics/types";

interface Props {
  flags: LocationFlag[];
}

export function FlagsSheetTrigger({ flags }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Flag className="size-3.5" />
        Active flags ({flags.length})
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Active flags ({flags.length})</SheetTitle>
            <SheetDescription>
              Outlet flags raised across the portfolio.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-auto px-4 pb-4">
            {flags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active flags. Flags raised from the Outlet Tiers table will
                appear here.
              </p>
            ) : (
              <ul className="space-y-3">
                {flags.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-lg border bg-card p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <FlagBadge flagType={f.flagType} />
                      <span className="text-xs text-muted-foreground">
                        {formatDate(f.createdAt)}
                      </span>
                    </div>
                    {f.reason && (
                      <p className="mt-2 text-sm text-foreground">{f.reason}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Raised by {f.actorName}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
