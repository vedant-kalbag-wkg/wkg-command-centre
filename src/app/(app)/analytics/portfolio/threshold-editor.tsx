"use client";

import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  usePerformerThresholdStore,
  isValidCutoffPair,
  DEFAULT_GREEN_CUTOFF,
  DEFAULT_RED_CUTOFF,
} from "@/lib/stores/performer-threshold-store";

interface ThresholdEditorProps {
  /** Notified when BOTH cutoffs are valid and have changed */
  onChange?: (greenCutoff: number, redCutoff: number) => void;
}

/**
 * Two-input editor for the R/Y/G tier cutoffs used by the High Performer
 * and Low Performer cards. Persists to localStorage via Zustand persist
 * middleware. When the sum exceeds 100, shows an inline error and does
 * NOT commit to the store (so queries keep using the last-valid values).
 */
export function ThresholdEditor({ onChange }: ThresholdEditorProps) {
  const greenCutoff = usePerformerThresholdStore((s) => s.greenCutoff);
  const redCutoff = usePerformerThresholdStore((s) => s.redCutoff);
  const setStore = usePerformerThresholdStore((s) => s.set);
  const resetStore = usePerformerThresholdStore((s) => s.reset);

  const greenId = useId();
  const redId = useId();

  // Local drafts so the user can type freely before validation fires.
  // We seed once from the store and then let the inputs own their text.
  const [greenDraft, setGreenDraft] = useState(String(greenCutoff));
  const [redDraft, setRedDraft] = useState(String(redCutoff));

  const greenNum = Number(greenDraft);
  const redNum = Number(redDraft);
  const parsedOk =
    Number.isFinite(greenNum) &&
    Number.isFinite(redNum) &&
    greenDraft.trim() !== "" &&
    redDraft.trim() !== "";

  const error = useMemo<string | null>(() => {
    if (!parsedOk) return "Enter numbers for both cutoffs.";
    if (greenNum < 0 || redNum < 0) return "Cutoffs must be 0 or greater.";
    if (greenNum > 100 || redNum > 100) return "Cutoffs must not exceed 100.";
    if (!isValidCutoffPair(greenNum, redNum))
      return `Green + Red must be \u2264 100 (currently ${greenNum + redNum}).`;
    return null;
  }, [parsedOk, greenNum, redNum]);

  // Commit a single field to the store on blur, if the whole pair is valid.
  // This avoids effect-driven cascades and keeps stale values in the store
  // until the user gives us a valid new pair.
  function commitIfValid(nextGreen: number, nextRed: number) {
    if (
      !Number.isFinite(nextGreen) ||
      !Number.isFinite(nextRed) ||
      !isValidCutoffPair(nextGreen, nextRed)
    ) {
      return;
    }
    let changed = false;
    if (nextGreen !== greenCutoff) {
      setStore("greenCutoff", nextGreen);
      changed = true;
    }
    if (nextRed !== redCutoff) {
      setStore("redCutoff", nextRed);
      changed = true;
    }
    if (changed) onChange?.(nextGreen, nextRed);
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Performer Tier Thresholds</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Top N% of outlets are green (high performers); bottom N% are red
            (low performers). The remainder is yellow.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            resetStore();
            setGreenDraft(String(DEFAULT_GREEN_CUTOFF));
            setRedDraft(String(DEFAULT_RED_CUTOFF));
          }}
        >
          Reset
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={greenId} className="text-green-600">
            Green cutoff %
          </Label>
          <Input
            id={greenId}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            aria-label="Green cutoff percent"
            aria-invalid={!!error}
            value={greenDraft}
            onChange={(e) => {
              setGreenDraft(e.target.value);
              commitIfValid(Number(e.target.value), redNum);
            }}
            onBlur={() => commitIfValid(greenNum, redNum)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={redId} className="text-destructive">
            Red cutoff %
          </Label>
          <Input
            id={redId}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            aria-label="Red cutoff percent"
            aria-invalid={!!error}
            value={redDraft}
            onChange={(e) => {
              setRedDraft(e.target.value);
              commitIfValid(greenNum, Number(e.target.value));
            }}
            onBlur={() => commitIfValid(greenNum, redNum)}
          />
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Green {greenNum}% / Yellow {100 - greenNum - redNum}% / Red {redNum}%
        </p>
      )}
    </div>
  );
}
