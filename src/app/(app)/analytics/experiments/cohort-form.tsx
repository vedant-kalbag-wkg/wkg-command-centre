"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelectFilter } from "@/components/analytics/multi-select-filter";
import { Plus, Loader2 } from "lucide-react";
import { findSimilarHotels } from "./actions";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";

type ControlMode = "rest_of_portfolio" | "named_control" | "similar_hotels";

interface CohortFormProps {
  locations: { id: string; name: string }[];
  onSubmit: (data: {
    name: string;
    description?: string;
    locationIds: string[];
    controlType: "rest_of_portfolio" | "named_control";
    controlLocationIds?: string[];
    interventionDate?: string;
  }) => Promise<void>;
}

export function CohortForm({ locations, onSubmit }: CohortFormProps) {
  const filters = useAnalyticsFilters();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [controlMode, setControlMode] = useState<ControlMode>("rest_of_portfolio");
  const [controlLocationIds, setControlLocationIds] = useState<string[]>([]);
  const [interventionDate, setInterventionDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [findingSimlar, setFindingSimilar] = useState(false);
  const [similarMatches, setSimilarMatches] = useState<{ id: string; name: string }[]>([]);

  const locationOptions = locations.map((l) => ({
    value: l.id,
    label: l.name,
  }));

  function reset() {
    setName("");
    setDescription("");
    setLocationIds([]);
    setControlMode("rest_of_portfolio");
    setControlLocationIds([]);
    setInterventionDate("");
    setSimilarMatches([]);
  }

  async function handleFindSimilar() {
    if (locationIds.length === 0) return;
    setFindingSimilar(true);
    try {
      const matches = await findSimilarHotels(locationIds, filters);
      setSimilarMatches(matches);
      setControlLocationIds(matches.map((m) => m.id));
    } finally {
      setFindingSimilar(false);
    }
  }

  function handleControlModeChange(mode: ControlMode) {
    setControlMode(mode);
    if (mode === "similar_hotels") {
      handleFindSimilar();
    } else {
      setSimilarMatches([]);
      if (mode === "rest_of_portfolio") {
        setControlLocationIds([]);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || locationIds.length === 0) return;

    setSubmitting(true);
    try {
      // similar_hotels is saved as named_control with auto-populated IDs
      const effectiveControlType =
        controlMode === "similar_hotels" ? "named_control" : controlMode;

      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        locationIds,
        controlType: effectiveControlType,
        controlLocationIds:
          (controlMode === "named_control" || controlMode === "similar_hotels") &&
          controlLocationIds.length > 0
            ? controlLocationIds
            : undefined,
        interventionDate: interventionDate || undefined,
      });
      reset();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className="gap-1.5">
            <Plus className="size-4" />
            Create
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Experiment Cohort</DialogTitle>
          <DialogDescription>
            Define a group of locations to compare against a control group.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cohort-name">Name</Label>
            <Input
              id="cohort-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q1 Promo Hotels"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cohort-desc">Description (optional)</Label>
            <Input
              id="cohort-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Cohort Locations</Label>
            <MultiSelectFilter
              label="Select Locations"
              options={locationOptions}
              selected={locationIds}
              onChange={setLocationIds}
              placeholder="Search locations..."
            />
            {locationIds.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {locationIds.length} location{locationIds.length !== 1 ? "s" : ""}{" "}
                selected
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Control Group</Label>
            <div className="flex gap-2 flex-wrap">
              <Button
                type="button"
                variant={
                  controlMode === "rest_of_portfolio" ? "default" : "outline"
                }
                size="sm"
                onClick={() => handleControlModeChange("rest_of_portfolio")}
              >
                Rest of Portfolio
              </Button>
              <Button
                type="button"
                variant={
                  controlMode === "named_control" ? "default" : "outline"
                }
                size="sm"
                onClick={() => handleControlModeChange("named_control")}
              >
                Named Control
              </Button>
              <Button
                type="button"
                variant={
                  controlMode === "similar_hotels" ? "default" : "outline"
                }
                size="sm"
                disabled={locationIds.length === 0}
                onClick={() => handleControlModeChange("similar_hotels")}
              >
                {findingSimlar ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1" />
                    Finding...
                  </>
                ) : (
                  "Similar Hotels"
                )}
              </Button>
            </div>
            {controlMode === "named_control" && (
              <div className="mt-1">
                <MultiSelectFilter
                  label="Control Locations"
                  options={locationOptions}
                  selected={controlLocationIds}
                  onChange={setControlLocationIds}
                  placeholder="Search control locations..."
                />
                {controlLocationIds.length > 0 && (
                  <span className="text-xs text-muted-foreground mt-1">
                    {controlLocationIds.length} control location
                    {controlLocationIds.length !== 1 ? "s" : ""} selected
                  </span>
                )}
              </div>
            )}
            {controlMode === "similar_hotels" && !findingSimlar && (
              <div className="mt-1">
                {similarMatches.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No similar hotels found. Try adjusting your cohort selection.
                  </p>
                ) : (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">
                      {similarMatches.length} similar hotel
                      {similarMatches.length !== 1 ? "s" : ""} matched:
                    </span>
                    <ul className="text-xs text-muted-foreground list-disc pl-4 max-h-24 overflow-y-auto">
                      {similarMatches.map((m) => (
                        <li key={m.id}>{m.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cohort-intervention">
              Intervention Date (optional)
            </Label>
            <Input
              id="cohort-intervention"
              type="date"
              value={interventionDate}
              onChange={(e) => setInterventionDate(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting || !name.trim() || locationIds.length === 0}>
              {submitting ? "Creating..." : "Create Cohort"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
