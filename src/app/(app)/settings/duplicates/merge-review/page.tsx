import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/lib/rbac";
import {
  loadMergeProposalClusters,
  listSavedDecisions,
} from "./actions";
import { MergeReviewClient } from "./merge-review-client";

export default async function MergeReviewPage() {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }
  const clusters = await loadMergeProposalClusters();
  const savedDecisions = await listSavedDecisions();

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Multi-POS Merge Review"
        description="Review the duplicate-location clusters proposed by scripts/propose-multi-pos-merge.ts. Approve, swap, reject, or flag as an address-data fix per cluster. Apply runs the merge transactionally."
        breadcrumb={
          <Link
            href="/settings/duplicates"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to Duplicates
          </Link>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <MergeReviewClient clusters={clusters} savedDecisions={savedDecisions} />
      </div>
    </div>
  );
}
