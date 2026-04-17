"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { ExclusionsList } from "./exclusions-list";
import { ExclusionForm } from "./exclusion-form";
import {
  listExclusions,
  createExclusion,
  deleteExclusion,
  testPattern,
  type ExclusionRow,
} from "./actions";

export default function OutletExclusionsPage() {
  const [exclusions, setExclusions] = React.useState<ExclusionRow[]>([]);
  const [matchCounts, setMatchCounts] = React.useState<Record<string, number>>({});
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    const result = await listExclusions();
    if ("exclusions" in result) {
      setExclusions(result.exclusions);
      // Compute match counts for each exclusion
      const counts: Record<string, number> = {};
      await Promise.all(
        result.exclusions.map(async (excl) => {
          const testResult = await testPattern(
            excl.outletCode,
            excl.patternType,
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
    label?: string;
  }) => {
    const result = await createExclusion(data);
    if ("error" in result) throw new Error(result.error);
    await refresh();
  };

  const handleDelete = async (excl: ExclusionRow) => {
    if (!confirm(`Delete exclusion rule "${excl.outletCode}"?`)) return;
    const result = await deleteExclusion(excl.id);
    if ("error" in result) {
      alert(result.error);
    } else {
      await refresh();
    }
  };

  return (
    <AppShell
      title="Outlet Exclusions"
      action={
        <Link href="/settings">
          <Button variant="ghost" size="sm" className="text-wk-night-grey">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Settings
          </Button>
        </Link>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Exclude outlet codes from analytics calculations using exact matches or
          regex patterns.
        </p>

        <ExclusionForm onSubmit={handleCreate} />

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Loading...
          </p>
        ) : (
          <ExclusionsList
            exclusions={exclusions}
            matchCounts={matchCounts}
            onDelete={handleDelete}
          />
        )}
      </div>
    </AppShell>
  );
}
