"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Ban } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExclusionsList } from "./exclusions-list";
import { ExclusionForm } from "./exclusion-form";
import {
  listExclusions,
  listRegions,
  createExclusion,
  deleteExclusion,
  testPattern,
  type ExclusionRow,
  type RegionOption,
} from "./actions";

export default function OutletExclusionsPage() {
  const [exclusions, setExclusions] = React.useState<ExclusionRow[]>([]);
  const [regions, setRegions] = React.useState<RegionOption[]>([]);
  const [matchCounts, setMatchCounts] = React.useState<Record<string, number>>({});
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    const [exclResult, regionsResult] = await Promise.all([
      listExclusions(),
      listRegions(),
    ]);

    if ("regions" in regionsResult) {
      setRegions(regionsResult.regions);
    }

    if ("exclusions" in exclResult) {
      setExclusions(exclResult.exclusions);
      // Compute match counts per exclusion (region-scoped — mirrors how the
      // exclusion is actually evaluated at query time).
      const counts: Record<string, number> = {};
      await Promise.all(
        exclResult.exclusions.map(async (excl) => {
          const testResult = await testPattern(
            excl.outletCode,
            excl.patternType,
            excl.regionId,
          );
          if ("matches" in testResult) {
            counts[excl.id] = testResult.matches.length;
          }
        }),
      );
      setMatchCounts(counts);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async (data: {
    outletCode: string;
    patternType: "exact" | "regex";
    regionId: string;
    label?: string;
  }) => {
    const result = await createExclusion(data);
    if ("error" in result) throw new Error(result.error);
    await refresh();
  };

  const handleDelete = async (excl: ExclusionRow) => {
    if (!confirm(`Delete exclusion rule "${excl.outletCode}" (${excl.regionCode})?`)) return;
    const result = await deleteExclusion(excl.id);
    if ("error" in result) {
      alert(result.error);
    } else {
      await refresh();
    }
  };

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Outlet Exclusions"
        description="Exclude outlet codes from analytics calculations using exact matches or regex patterns. Each rule applies to a single region."
        count={loading ? undefined : exclusions.length}
        actions={
          <Link href="/settings">
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to Settings
            </Button>
          </Link>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="space-y-6">
          <ExclusionForm regions={regions} onSubmit={handleCreate} />

          {loading ? (
            <EmptyState icon={Ban} title="Loading exclusions…" />
          ) : exclusions.length === 0 ? (
            <EmptyState
              icon={Ban}
              title="No exclusion rules defined"
              description="Add an exact match or regex pattern above to filter outlet codes from analytics."
            />
          ) : (
            <ExclusionsList
              exclusions={exclusions}
              matchCounts={matchCounts}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>
    </div>
  );
}
