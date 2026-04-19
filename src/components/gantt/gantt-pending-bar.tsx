"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateInstallation } from "@/app/(app)/installations/actions";
import { useGanttStore } from "@/lib/stores/gantt-store";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function GanttPendingBar() {
  const router = useRouter();
  const pendingChange = useGanttStore((s) => s.pendingChange);
  const clearPending = useGanttStore((s) => s.clearPending);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pendingChange) return null;

  const { taskId, installationName, newStart, newEnd } = pendingChange;

  async function handleApply() {
    setSaving(true);
    setError(null);
    try {
      const result = await updateInstallation(taskId, {
        plannedStart: newStart.toISOString(),
        plannedEnd: newEnd.toISOString(),
      });
      if ("error" in result) {
        setError(
          "Couldn't save timeline changes. Check your connection and try again."
        );
      } else {
        clearPending();
        router.refresh();
      }
    } catch {
      setError(
        "Couldn't save timeline changes. Check your connection and try again."
      );
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    clearPending();
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-white border border-border rounded-lg shadow-lg px-5 py-3"
    >
      <p className="text-sm text-foreground">
        <span className="font-medium">{installationName}</span> moved to{" "}
        <span className="font-medium">
          {formatDate(newStart)} &ndash; {formatDate(newEnd)}
        </span>
      </p>

      {error && (
        <p className="text-xs text-destructive max-w-xs">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleApply}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {saving && (
            <span
              className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"
              aria-hidden="true"
            />
          )}
          Apply changes
        </button>

        <button
          type="button"
          onClick={handleDiscard}
          disabled={saving}
          className="text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors disabled:opacity-60"
        >
          Discard changes
        </button>
      </div>
    </div>
  );
}
