import { describe, it, expect } from "vitest";
import {
  matchInBatchReversals,
  applyCrossBatchMatches,
  type ReversalCandidate,
} from "./reversal-matcher";

const row = (
  id: string,
  refNo: string,
  netAmount: string,
  transactionDate: string,
  locationId: string,
): ReversalCandidate => ({ id, refNo, netAmount, transactionDate, locationId });

describe("matchInBatchReversals", () => {
  it("pairs a refund with its same-batch original by refNo + magnitude", () => {
    const original = row("o1", "Q5A1", "12.48", "2026-01-01", "loc-original");
    const refund = row("r1", "Q5A1", "-12.48", "2026-01-02", "loc-customer-service");
    const res = matchInBatchReversals([original, refund]);
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0]).toEqual({
      refundId: "r1",
      originalId: "o1",
      originalLocationId: "loc-original",
      isPartialReversal: false,
    });
    expect(res.unmatchedRefunds).toHaveLength(0);
  });

  it("returns an unmatched refund when no original shares the refNo", () => {
    const refund = row("r1", "ORPHAN", "-5.00", "2026-01-02", "loc-bk");
    const res = matchInBatchReversals([refund]);
    expect(res.matches).toHaveLength(0);
    expect(res.unmatchedRefunds).toEqual([refund]);
  });

  it("picks the most recent original by transactionDate when multiple qualify", () => {
    const older = row("o1", "Q5A1", "10.00", "2026-01-01", "loc-older");
    const newer = row("o2", "Q5A1", "10.00", "2026-01-05", "loc-newer");
    const refund = row("r1", "Q5A1", "-10.00", "2026-01-06", "loc-bk");
    const res = matchInBatchReversals([older, newer, refund]);
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].originalId).toBe("o2");
    expect(res.matches[0].originalLocationId).toBe("loc-newer");
  });

  it("does not consume the same original twice", () => {
    const original = row("o1", "Q5A1", "10.00", "2026-01-01", "loc-original");
    const refundA = row("r1", "Q5A1", "-10.00", "2026-01-02", "loc-bk");
    const refundB = row("r2", "Q5A1", "-10.00", "2026-01-03", "loc-bk");
    const res = matchInBatchReversals([original, refundA, refundB]);
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].refundId).toBe("r1");
    expect(res.unmatchedRefunds).toHaveLength(1);
    expect(res.unmatchedRefunds[0].id).toBe("r2");
  });

  it("does not match refunds against differing magnitudes (in-batch is full-only)", () => {
    const original = row("o1", "Q5A1", "20.00", "2026-01-01", "loc-original");
    const partial = row("r1", "Q5A1", "-5.00", "2026-01-02", "loc-bk");
    const res = matchInBatchReversals([original, partial]);
    expect(res.matches).toHaveLength(0);
    expect(res.unmatchedRefunds).toHaveLength(1);
  });
});

describe("applyCrossBatchMatches", () => {
  it("matches a partial refund against a larger committed original and flags it partial", () => {
    const refund = row("r1", "Q5A1", "-5.00", "2026-02-01", "loc-bk");
    const committed = row("o1", "Q5A1", "20.00", "2026-01-15", "loc-original");
    const res = applyCrossBatchMatches([refund], [committed]);
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0]).toEqual({
      refundId: "r1",
      originalId: "o1",
      originalLocationId: "loc-original",
      isPartialReversal: true,
    });
    expect(res.orphans).toHaveLength(0);
  });

  it("flags an equal-magnitude cross-batch match as full (not partial)", () => {
    const refund = row("r1", "Q5A1", "-20.00", "2026-02-01", "loc-bk");
    const committed = row("o1", "Q5A1", "20.00", "2026-01-15", "loc-original");
    const res = applyCrossBatchMatches([refund], [committed]);
    expect(res.matches[0].isPartialReversal).toBe(false);
  });

  it("returns the refund as an orphan when no committed original is large enough", () => {
    const refund = row("r1", "Q5A1", "-20.00", "2026-02-01", "loc-bk");
    const tooSmall = row("o1", "Q5A1", "10.00", "2026-01-15", "loc-original");
    const res = applyCrossBatchMatches([refund], [tooSmall]);
    expect(res.matches).toHaveLength(0);
    expect(res.orphans).toEqual([refund]);
  });

  it("returns the refund as an orphan when no committed original shares the refNo", () => {
    const refund = row("r1", "ORPHAN", "-1.00", "2026-02-01", "loc-bk");
    const res = applyCrossBatchMatches([refund], []);
    expect(res.orphans).toEqual([refund]);
  });
});
