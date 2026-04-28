"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  saveClusterDecision,
  applyApprovedMerges,
  type ClusterRow,
  type SavedDecision,
} from "./actions";

type DecisionValue = "approved" | "swapped" | "rejected" | "address_fix";

const DECISION_OPTIONS: Array<{
  value: DecisionValue;
  label: string;
  hint: string;
}> = [
  {
    value: "approved",
    label: "Approved",
    hint: "Merge defunct → canonical (FK rewrite + archive defunct)",
  },
  {
    value: "swapped",
    label: "Swapped",
    hint: "Invert canonical/defunct, then merge",
  },
  {
    value: "rejected",
    label: "Rejected",
    hint: "Not actually a duplicate; leave both rows in place",
  },
  {
    value: "address_fix",
    label: "Address fix",
    hint: "Address-data-quality issue; capture corrective action in notes",
  },
];

interface MergeReviewClientProps {
  clusters: ClusterRow[];
  savedDecisions: SavedDecision[];
}

/**
 * Inline RadioGroup primitive — base-ui radio-group felt heavy for a
 * 4-option per-cluster picker, so this renders styled native radios. The
 * `RadioGroup` name is preserved so the merge-review UI carries a single,
 * named decision-picker primitive across the cluster list.
 */
function RadioGroup({
  name,
  value,
  onChange,
  options,
  disabled,
}: {
  name: string;
  value: DecisionValue | null;
  onChange: (next: DecisionValue) => void;
  options: typeof DECISION_OPTIONS;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
              isSelected
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/40"
            } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={isSelected}
              onChange={() => onChange(opt.value)}
              disabled={disabled}
              aria-label={opt.label}
              className="mt-0.5"
            />
            <span className="flex flex-col">
              <span className="font-medium">{opt.label}</span>
              <span className="text-xs text-muted-foreground">{opt.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function MergeReviewClient({
  clusters,
  savedDecisions,
}: MergeReviewClientProps) {
  const router = useRouter();
  const [pendingPair, setPendingPair] = React.useState<string | null>(null);
  const [applying, setApplying] = React.useState(false);

  // Map (canonicalId|defunctId) → SavedDecision for fast lookup.
  const decisionMap = React.useMemo(() => {
    const m = new Map<string, SavedDecision>();
    for (const d of savedDecisions) {
      m.set(`${d.canonicalId}|${d.defunctId}`, d);
    }
    return m;
  }, [savedDecisions]);

  // Per-pair local state for in-flight edits (decision + notes) before save.
  const [drafts, setDrafts] = React.useState<
    Record<string, { decision: DecisionValue | null; notes: string }>
  >(() => {
    const init: Record<string, { decision: DecisionValue | null; notes: string }> = {};
    for (const d of savedDecisions) {
      init[`${d.canonicalId}|${d.defunctId}`] = {
        decision: d.decision,
        notes: d.notes ?? "",
      };
    }
    return init;
  });

  function pairKey(canonicalId: string, defunctId: string): string {
    return `${canonicalId}|${defunctId}`;
  }

  function getDraft(canonicalId: string, defunctId: string) {
    const key = pairKey(canonicalId, defunctId);
    return drafts[key] ?? { decision: null, notes: "" };
  }

  function setDraft(
    canonicalId: string,
    defunctId: string,
    next: Partial<{ decision: DecisionValue; notes: string }>,
  ) {
    const key = pairKey(canonicalId, defunctId);
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        decision: next.decision ?? prev[key]?.decision ?? null,
        notes: next.notes ?? prev[key]?.notes ?? "",
      },
    }));
  }

  async function handleSave(
    cluster: ClusterRow,
    pair: ClusterRow["defunctPairs"][number],
  ) {
    const key = pairKey(cluster.canonicalId, pair.defunctId);
    const draft = drafts[key];
    if (!draft || !draft.decision) {
      toast.error("Pick a decision first");
      return;
    }
    if (draft.decision === "address_fix" && draft.notes.trim() === "") {
      toast.error("Notes are required when decision is 'address_fix'");
      return;
    }
    setPendingPair(key);
    try {
      const result = await saveClusterDecision({
        canonicalId: cluster.canonicalId,
        defunctId: pair.defunctId,
        clusterId: cluster.clusterId,
        decision: draft.decision,
        notes: draft.notes.trim() === "" ? undefined : draft.notes.trim(),
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Decision saved");
        router.refresh();
      }
    } finally {
      setPendingPair(null);
    }
  }

  async function handleApply() {
    const pendingApprovals = savedDecisions.filter(
      (d) =>
        (d.decision === "approved" || d.decision === "swapped") &&
        d.appliedAt === null,
    );
    if (pendingApprovals.length === 0) {
      toast.error("No pending approved/swapped decisions to apply");
      return;
    }
    if (
      !window.confirm(
        `Apply ${pendingApprovals.length} merge(s)? This is destructive — every FK to defunct locations will be rewritten to canonical and defunct rows will be archived. Continue?`,
      )
    ) {
      return;
    }
    setApplying(true);
    try {
      const result = await applyApprovedMerges();
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          `Applied ${result.result.pairsMerged} merge(s). ${result.result.salesRecordsRewritten} sales rewritten, ${result.result.locationsArchived} location(s) archived.`,
        );
        router.refresh();
      }
    } finally {
      setApplying(false);
    }
  }

  // Count saved decisions ready for apply (approved/swapped, not yet applied).
  const pendingApprovalsCount = savedDecisions.filter(
    (d) =>
      (d.decision === "approved" || d.decision === "swapped") &&
      d.appliedAt === null,
  ).length;

  if (clusters.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
        <AlertTriangle className="size-8" />
        <p className="text-sm">
          No clusters found. The proposal CSV at
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
            tasks/analytics-audit/multi-pos-merge-proposal.csv
          </code>
          is missing or empty.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        <strong className="text-foreground">{clusters.length}</strong>{" "}
        cluster(s) loaded from proposal CSV.{" "}
        <strong className="text-foreground">{savedDecisions.length}</strong>{" "}
        decision(s) saved.{" "}
        <strong className="text-foreground">{pendingApprovalsCount}</strong>{" "}
        pending apply.
      </div>

      {clusters.map((cluster) => (
        <Card
          key={cluster.clusterId}
          data-testid="merge-cluster-card"
          className="p-4"
        >
          <header className="mb-3 flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">
                Cluster {cluster.clusterId} — {cluster.region}
              </h2>
              <p className="text-xs text-muted-foreground">
                Basis: {cluster.clusterBasis}
                {cluster.address ? ` · ${cluster.address}` : ""}
              </p>
            </div>
          </header>

          <section className="mb-3 rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-primary">
              Canonical (will absorb defunct rows)
            </div>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="font-medium">{cluster.canonicalName}</span>
              <span className="text-muted-foreground">
                outlet={cluster.canonicalOutletCode || "—"}
              </span>
              <span className="text-muted-foreground">
                sales={cluster.canonicalSalesCount.toLocaleString()}
              </span>
              <span className="text-muted-foreground">
                amount={cluster.canonicalAmountTotal.toLocaleString()}
              </span>
            </div>
          </section>

          <div className="flex flex-col gap-4">
            {cluster.defunctPairs.map((pair) => {
              const key = pairKey(cluster.canonicalId, pair.defunctId);
              const draft = getDraft(cluster.canonicalId, pair.defunctId);
              const saved = decisionMap.get(key);
              const isPending = pendingPair === key;
              const isApplied = saved?.appliedAt != null;
              return (
                <div
                  key={pair.defunctId}
                  className="rounded-md border p-3"
                  data-testid="merge-defunct-pair"
                >
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                    <span className="font-medium">{pair.defunctName}</span>
                    <span className="text-muted-foreground">
                      outlet={pair.defunctOutletCode || "—"}
                    </span>
                    <span className="text-muted-foreground">
                      sales={pair.defunctSalesCount.toLocaleString()}
                    </span>
                    <span className="text-muted-foreground">
                      amount={pair.defunctAmountTotal.toLocaleString()}
                    </span>
                    <span className="text-muted-foreground">
                      kiosks={pair.defunctKiosksCount}
                    </span>
                    {pair.notes && (
                      <span className="text-amber-600">
                        ⚠ {pair.notes}
                      </span>
                    )}
                  </div>

                  <RadioGroup
                    name={`decision-${key}`}
                    value={draft.decision}
                    onChange={(next) =>
                      setDraft(cluster.canonicalId, pair.defunctId, {
                        decision: next,
                      })
                    }
                    options={DECISION_OPTIONS}
                    disabled={isPending || isApplied}
                  />

                  {draft.decision === "address_fix" && (
                    <div className="mt-2">
                      <Label
                        htmlFor={`notes-${key}`}
                        className="text-xs text-muted-foreground"
                      >
                        Corrective action (required for address_fix)
                      </Label>
                      <Textarea
                        id={`notes-${key}`}
                        value={draft.notes}
                        onChange={(e) =>
                          setDraft(cluster.canonicalId, pair.defunctId, {
                            notes: e.target.value,
                          })
                        }
                        placeholder="e.g. Re-pull row from Monday board 12345; or hand-edit address to '...'"
                        disabled={isPending || isApplied}
                        rows={2}
                      />
                    </div>
                  )}

                  <div className="mt-2 flex items-center gap-3">
                    <Button
                      size="sm"
                      onClick={() => handleSave(cluster, pair)}
                      disabled={isPending || isApplied || !draft.decision}
                    >
                      {isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      Save decision
                    </Button>
                    {saved && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle2 className="size-3.5 text-green-600" />
                        Decision saved: {saved.decision}
                        {isApplied ? " · applied" : ""}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            {pendingApprovalsCount} pending merge(s) ready to apply.
          </div>
          <Button
            onClick={handleApply}
            disabled={applying || pendingApprovalsCount === 0}
            variant="default"
          >
            {applying ? <Loader2 className="size-4 animate-spin" /> : null}
            Apply approved merges
          </Button>
        </div>
      </div>
    </div>
  );
}
