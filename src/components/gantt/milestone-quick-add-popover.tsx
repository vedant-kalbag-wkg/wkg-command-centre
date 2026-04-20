"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Note: PopoverTrigger in base-ui does not support asChild — render content directly as children
import { createMilestone } from "@/app/(app)/installations/actions";
import { Plus } from "lucide-react";

const MILESTONE_TYPE_OPTIONS: Array<{
  value: "contract_signing" | "go_live" | "review_date" | "other";
  label: string;
}> = [
  { value: "contract_signing", label: "Contract Signing" },
  { value: "go_live", label: "Go-Live" },
  { value: "review_date", label: "Review Date" },
  { value: "other", label: "Other" },
];

interface MilestoneQuickAddPopoverProps {
  installationId: string;
  installationName: string;
  defaultDate?: string; // ISO date string (YYYY-MM-DD)
  onAdded?: () => void;
}

export function MilestoneQuickAddPopover({
  installationId,
  installationName,
  defaultDate,
  onAdded,
}: MilestoneQuickAddPopoverProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<
    "contract_signing" | "go_live" | "review_date" | "other"
  >("go_live");
  const [targetDate, setTargetDate] = useState(
    defaultDate ?? new Date().toISOString().slice(0, 10)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const result = await createMilestone({
        installationId,
        name: name.trim(),
        type,
        targetDate: new Date(targetDate).toISOString(),
      });

      if ("error" in result) {
        setError(
          "Couldn't add milestone. Try again or refresh the page."
        );
      } else {
        // Reset form
        setName("");
        setType("go_live");
        setTargetDate(defaultDate ?? new Date().toISOString().slice(0, 10));
        setOpen(false);
        onAdded?.();
        router.refresh();
      }
    } catch {
      setError("Couldn't add milestone. Try again or refresh the page.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex items-center gap-1.5 h-7 px-3 rounded text-xs font-medium text-muted-foreground border border-dashed border-border hover:bg-muted transition-colors">
        <Plus className="h-3 w-3" aria-hidden="true" />
        Add milestone
      </PopoverTrigger>

      <PopoverContent className="w-80" align="start">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">
              Add milestone
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {installationName}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="milestone-name" className="text-xs">
              Name
            </Label>
            <Input
              id="milestone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Go-Live sign-off"
              className="h-8 text-sm"
              required
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="milestone-type" className="text-xs">
              Type
            </Label>
            <select
              id="milestone-type"
              value={type}
              onChange={(e) =>
                setType(
                  e.target.value as
                    | "contract_signing"
                    | "go_live"
                    | "review_date"
                    | "other"
                )
              }
              disabled={saving}
              className="w-full h-8 text-sm bg-white border border-border rounded px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {MILESTONE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="milestone-date" className="text-xs">
              Target date
            </Label>
            <Input
              id="milestone-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="h-8 text-sm"
              required
              disabled={saving}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            type="submit"
            disabled={saving || !name.trim()}
            className="w-full h-8 bg-primary hover:bg-primary/90 text-primary-foreground text-sm"
          >
            {saving ? "Adding..." : "Add milestone"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
