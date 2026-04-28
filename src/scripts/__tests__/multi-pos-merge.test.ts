/**
 * Phase 6 Plan 06-01 — Unit-level smoke for the bulk-merge primitive.
 *
 * The full transactional integration test (against a Testcontainers Postgres)
 * lives at `tests/scripts/multi-pos-merge.integration.test.ts` because
 * vitest.config.ts integration project includes only
 * `tests/**\/*.integration.test.ts`. This file holds the unit-level
 * assertions that don't need a real DB:
 *   - empty pairs array → all-zero result
 *   - exported constants/types are stable
 */
import { describe, it, expect, vi } from "vitest";
import {
  applyBulkMerge,
  MULTI_POS_MERGE_SCRIPT_TAG,
} from "@/lib/multi-pos-merge";

describe("applyBulkMerge (unit)", () => {
  it("returns all-zero result on empty pairs and does not open a transaction", async () => {
    const transaction = vi.fn();
    const fakeDb = { transaction };
    const result = await applyBulkMerge(
      [],
      { id: "actor-id", name: "Actor" },
      fakeDb,
    );
    expect(result.pairsMerged).toBe(0);
    expect(result.salesRecordsRewritten).toBe(0);
    expect(result.locationsArchived).toBe(0);
    expect(result.auditLogsWritten).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("exports the canonical script tag used for rollback predicate matching", () => {
    expect(MULTI_POS_MERGE_SCRIPT_TAG).toBe("scripts/multi-pos-merge.ts");
  });
});
