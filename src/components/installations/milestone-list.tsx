"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  createMilestone,
  deleteMilestone,
} from "@/app/(app)/installations/actions";
import type { MilestoneRecord } from "@/app/(app)/installations/actions";

// ---------------------------------------------------------------------------
// Milestone type helpers
// ---------------------------------------------------------------------------

const milestoneTypeLabels: Record<string, string> = {
  contract_signing: "Contract Signing",
  go_live: "Go-Live",
  review_date: "Review Date",
  other: "Other",
};

const milestoneTypeItems = [
  { value: "contract_signing", label: "Contract Signing" },
  { value: "go_live", label: "Go-Live" },
  { value: "review_date", label: "Review Date" },
  { value: "other", label: "Other" },
];

function MilestoneTypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className="text-xs font-normal text-wk-night-grey border-wk-mid-grey">
      {milestoneTypeLabels[type] ?? type}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Add milestone form schema
// ---------------------------------------------------------------------------

const addMilestoneSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["contract_signing", "go_live", "review_date", "other"]),
  targetDate: z.string().min(1, "Target date is required"),
});

type AddMilestoneValues = z.infer<typeof addMilestoneSchema>;

// ---------------------------------------------------------------------------
// MilestoneList
// ---------------------------------------------------------------------------

interface MilestoneListProps {
  milestones: MilestoneRecord[];
  installationId: string;
}

export function MilestoneList({ milestones, installationId }: MilestoneListProps) {
  const router = useRouter();
  const [showAddForm, setShowAddForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<AddMilestoneValues>({
    resolver: zodResolver(addMilestoneSchema),
    defaultValues: {
      name: "",
      type: "other",
      targetDate: "",
    },
  });

  const typeValue = watch("type");

  function onAddSubmit(data: AddMilestoneValues) {
    startTransition(async () => {
      const result = await createMilestone({
        installationId,
        name: data.name,
        type: data.type,
        targetDate: data.targetDate,
      });
      if ("error" in result) {
        toast.error("Couldn't add milestone. Try again or refresh the page.");
      } else {
        toast.success("Milestone added");
        reset();
        setShowAddForm(false);
        router.refresh();
      }
    });
  }

  function handleDeleteConfirm() {
    if (!deletingId) return;
    const id = deletingId;
    startTransition(async () => {
      const result = await deleteMilestone(id);
      if ("error" in result) {
        toast.error("Couldn't delete milestone. Try again.");
      } else {
        toast.success("Milestone deleted");
        setDeletingId(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Milestone list */}
      {milestones.length === 0 ? (
        <p className="text-sm text-wk-night-grey py-2">
          No milestones — add one to track key dates for this installation.
        </p>
      ) : (
        <ul className="divide-y divide-wk-mid-grey">
          {milestones.map((milestone) => (
            <li key={milestone.id} className="flex items-center justify-between py-2.5">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-wk-graphite">
                  {milestone.name}
                </span>
                <div className="flex items-center gap-2">
                  <MilestoneTypeBadge type={milestone.type} />
                  <span className="text-xs text-wk-night-grey">
                    {format(milestone.targetDate, "dd MMM yyyy")}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingId(milestone.id)}
                className="p-1 text-wk-mid-grey hover:text-wk-destructive transition-colors"
                aria-label={`Delete milestone ${milestone.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add milestone inline form */}
      {showAddForm ? (
        <form onSubmit={handleSubmit(onAddSubmit)} className="flex flex-col gap-3 rounded-lg border border-wk-mid-grey p-3 bg-wk-light-grey">
          <div className="flex flex-col gap-1">
            <Label htmlFor="milestone-name" className="text-xs">Name</Label>
            <Input
              id="milestone-name"
              placeholder="e.g. Contract signed"
              {...register("name")}
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-wk-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="milestone-type" className="text-xs">Type</Label>
            <Select
              value={typeValue}
              items={milestoneTypeItems}
              onValueChange={(v) => {
                if (v)
                  setValue("type", v as AddMilestoneValues["type"], {
                    shouldValidate: true,
                  });
              }}
            >
              <SelectTrigger id="milestone-type" className="w-full">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {milestoneTypeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="milestone-date" className="text-xs">Target Date</Label>
            <Input
              id="milestone-date"
              type="date"
              {...register("targetDate")}
              aria-invalid={!!errors.targetDate}
            />
            {errors.targetDate && (
              <p className="text-xs text-wk-destructive">{errors.targetDate.message}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="bg-wk-azure text-white hover:bg-wk-azure/90"
            >
              {isPending ? "Adding…" : "Add milestone"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                reset();
                setShowAddForm(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1.5 text-sm text-wk-azure hover:underline"
        >
          <Plus className="h-4 w-4" />
          Add milestone
        </button>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete milestone?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-wk-night-grey">
            This milestone will be permanently removed from the installation.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingId(null)}
              disabled={isPending}
            >
              Keep milestone
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={isPending}
            >
              {isPending ? "Deleting…" : "Delete milestone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
