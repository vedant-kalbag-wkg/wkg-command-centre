"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  triggerMondayImportAction,
  type MondayImportActionResult,
} from "./actions";

export function MondayImportButton({ hasToken }: { hasToken: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] =
    useState<MondayImportActionResult | null>(null);

  function run() {
    setOpen(false);
    const toastId = toast.loading("Running Monday import… this can take 30-60s");

    startTransition(async () => {
      try {
        const result = await triggerMondayImportAction();
        setLastResult(result);

        if (result.status === "success") {
          toast.success(
            `Monday import complete — ${result.result.rowsInserted} rows, ${result.result.placeholdersCreated} placeholders`,
            { id: toastId },
          );
        } else if (result.status === "lock_contention") {
          toast.error(
            "Another import is currently running. Wait a moment and try again.",
            { id: toastId },
          );
        } else if (result.status === "missing_token") {
          toast.error("MONDAY_API_TOKEN not configured on this deployment.", {
            id: toastId,
          });
        } else {
          toast.error(`Import failed: ${result.message}`, { id: toastId });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unexpected error";
        setLastResult({ status: "error", message });
        toast.error(`Import failed: ${message}`, { id: toastId });
      }
    });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {!hasToken && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              MONDAY_API_TOKEN not configured
            </CardTitle>
            <CardDescription>
              Set <code>MONDAY_API_TOKEN</code> on this deployment before
              running the import. In dev, add it to <code>.env.local</code>;
              in prod, set it in Vercel project env vars.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button
              variant="destructive"
              size="lg"
              disabled={!hasToken || pending}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {pending ? "Running…" : "Run Monday Import"}
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Monday import</DialogTitle>
            <DialogDescription>
              This will <strong>TRUNCATE <code>location_products</code></strong>{" "}
              and rebuild it from Monday.com. Takes 30-60 seconds. Any hotels
              on Live Estate / Australia DCM missing outlet codes on mirror9
              will get placeholder <code>locations</code> rows created
              automatically. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button variant="destructive" onClick={run}>
              Yes, run import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lastResult && <ResultCard result={lastResult} />}
    </div>
  );
}

function ResultCard({ result }: { result: MondayImportActionResult }) {
  if (result.status === "success") {
    const { rowsInserted, placeholdersCreated, placeholderNames, hotelsSkipped, durationMs } =
      result.result;
    return (
      <Card variant="elevated">
        <CardHeader>
          <CardTitle>Last import — success</CardTitle>
          <CardDescription>
            Completed in {(durationMs / 1000).toFixed(1)}s
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Rows inserted</dt>
            <dd className="font-medium tabular-nums">{rowsInserted.toLocaleString()}</dd>
            <dt className="text-muted-foreground">Placeholders created</dt>
            <dd className="font-medium tabular-nums">{placeholdersCreated}</dd>
            <dt className="text-muted-foreground">Hotels skipped</dt>
            <dd className="font-medium tabular-nums">{hotelsSkipped}</dd>
          </dl>
          {placeholderNames.length > 0 && (
            <div className="mt-4">
              <div className="text-sm text-muted-foreground mb-1.5">
                New placeholder hotels (review under Outlet Types):
              </div>
              <ul className="list-disc pl-5 text-sm">
                {placeholderNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (result.status === "lock_contention") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Another import is running</CardTitle>
          <CardDescription>
            Wait a moment and try again. The advisory lock releases
            automatically when the running import finishes.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (result.status === "missing_token") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">
            MONDAY_API_TOKEN not configured
          </CardTitle>
          <CardDescription>
            Set <code>MONDAY_API_TOKEN</code> on this deployment.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-destructive">Import failed</CardTitle>
        <CardDescription className="font-mono text-xs">
          {result.message}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
