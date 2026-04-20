"use client";

import * as React from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { KioskListItem } from "@/app/(app)/kiosks/actions";

interface KioskDetailSheetProps {
  kiosk: KioskListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KioskDetailSheet({
  kiosk,
  open,
  onOpenChange,
}: KioskDetailSheetProps) {
  if (!kiosk) return null;

  const isCmsConfigured = kiosk.cmsConfigStatus === "configured";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:max-w-[360px] flex flex-col">
        <SheetHeader className="border-b pb-4">
          <SheetTitle className="text-base font-semibold text-foreground">
            {kiosk.kioskId}
          </SheetTitle>
        </SheetHeader>

        {/* Details body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <dl className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Venue
              </dt>
              <dd className="text-sm text-foreground">
                {kiosk.venueName ?? "Unassigned"}
              </dd>
            </div>

            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Region
              </dt>
              <dd className="text-sm text-foreground">
                {kiosk.regionGroup ?? "—"}
              </dd>
            </div>

            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Stage
              </dt>
              <dd className="flex items-center gap-2">
                {kiosk.pipelineStageColor && (
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: kiosk.pipelineStageColor }}
                  />
                )}
                <span className="text-sm text-foreground">
                  {kiosk.pipelineStageName ?? "—"}
                </span>
              </dd>
            </div>

            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Outlet Code
              </dt>
              <dd className="text-sm text-foreground">
                {kiosk.outletCode ?? "—"}
              </dd>
            </div>

            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Hardware
              </dt>
              <dd className="text-sm text-foreground">
                {kiosk.hardwareModel ?? "—"}
              </dd>
            </div>

            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                CMS Config
              </dt>
              <dd>
                <Badge
                  variant={isCmsConfigured ? "default" : "secondary"}
                  className={cn(
                    "text-xs",
                    isCmsConfigured
                      ? "bg-[--color-wk-success] text-white"
                      : "text-muted-foreground"
                  )}
                >
                  {isCmsConfigured ? "Configured" : "Not configured"}
                </Badge>
              </dd>
            </div>

            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Install Date
              </dt>
              <dd className="text-sm text-foreground">
                {kiosk.installationDate
                  ? format(new Date(kiosk.installationDate), "d MMM yyyy")
                  : "—"}
              </dd>
            </div>
          </dl>
        </div>

        <SheetFooter className="border-t pt-4">
          <Link
            href={`/kiosks/${kiosk.id}`}
            className={cn(
              buttonVariants({ variant: "default" }),
              "w-full bg-primary text-primary-foreground hover:bg-primary/90 justify-center"
            )}
          >
            View full details
          </Link>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
