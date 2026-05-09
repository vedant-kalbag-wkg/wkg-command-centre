"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { triggerRunNow } from "./actions";

export function RunNowButton() {
  const [pending, startTransition] = useTransition();

  const handleRun = () => {
    startTransition(async () => {
      try {
        const result = await triggerRunNow();
        if (result.ok) {
          toast.success("Run queued — refresh in ~30 seconds");
        } else if (result.error === "Rate limited") {
          toast.error(
            `Already queued — wait ~${result.minutesRemaining ?? 5} more minutes`,
          );
        } else {
          toast.error(result.error);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Trigger failed");
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run now</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Manually fire the weekly POC alert now. Use sparingly — the cron fires
          automatically Mondays 09:00 (Europe/London).
        </p>
        <Button onClick={handleRun} disabled={pending} className="max-w-xs">
          {pending ? "Queueing run…" : "Run now"}
        </Button>
      </CardContent>
    </Card>
  );
}
