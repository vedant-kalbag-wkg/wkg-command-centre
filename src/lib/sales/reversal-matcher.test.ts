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

  // Determinism: when two originals share the same transactionDate, the chosen
  // original must not depend on the order rows arrive in the input array.
  // The bug: prior to plan 06-07 the in-batch matcher's "most-recent-by-date"
  // loop used `>` only — on tied dates it kept whichever index came first,
  // which is determined by the caller's row arrival order (SQL row order has
  // no stable tiebreaker, so the same input could produce different output).
  it("in-batch tiebreaker also deterministic across 100 random input permutations", () => {
    const original1 = row("o1", "Q5A1", "10.00", "2026-01-05", "loc-A");
    const original2 = row("o2", "Q5A1", "10.00", "2026-01-05", "loc-B");
    const refund = row("r1", "Q5A1", "-10.00", "2026-01-06", "loc-bk");
    // Fixed seed via Math.random() is not seeded, but 100 random shuffles of a
    // 3-element array exhaustively covers all 6 permutations many times over.
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const shuffled = [original1, original2, refund].sort(() => Math.random() - 0.5);
      const res = matchInBatchReversals(shuffled);
      expect(res.matches).toHaveLength(1);
      results.add(res.matches[0].originalId);
    }
    expect(results.size).toBe(1);
  });

  it("in-batch tiebreaker prefers lower id when transactionDates equal", () => {
    // Pass originals in [o2, o1] order to prove the matcher does NOT just take
    // the first one — it deterministically picks o1 (lower id) regardless.
    const o2 = row("o2", "Q5A1", "10.00", "2026-01-05", "loc-B");
    const o1 = row("o1", "Q5A1", "10.00", "2026-01-05", "loc-A");
    const refund = row("r1", "Q5A1", "-10.00", "2026-01-06", "loc-bk");
    const res = matchInBatchReversals([o2, o1, refund]);
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].originalId).toBe("o1");
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

  // Determinism: the cross-batch matcher used to depend on input arrival order
  // when multiple candidates shared transactionDate (SQL `WHERE ref_no IN
  // (...) AND net_amount > 0` returns rows in no guaranteed order absent an
  // ORDER BY id). After plan 06-07: lower id wins on tied date, output stable.
  it("cross-batch matches deterministically across 100 random input permutations", () => {
    const refund = row("r1", "Q5A1", "-5.00", "2026-02-01", "loc-bk");
    const candidates: ReversalCandidate[] = [
      row("o1", "Q5A1", "20.00", "2026-01-15", "loc-A"),
      row("o2", "Q5A1", "20.00", "2026-01-15", "loc-B"),
      row("o3", "Q5A1", "20.00", "2026-01-15", "loc-C"),
    ];
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const shuffled = [...candidates].sort(() => Math.random() - 0.5);
      const res = applyCrossBatchMatches([refund], shuffled);
      expect(res.matches).toHaveLength(1);
      results.add(res.matches[0].originalId);
    }
    // Every permutation must select the same original — set size of 1 proves it.
    expect(results.size).toBe(1);
  });

  it("cross-batch tiebreaker prefers lower id when transactionDates equal", () => {
    // Pass [o2, o1] to prove the matcher does NOT default to first-seen.
    const refund = row("r1", "Q5A1", "-5.00", "2026-02-01", "loc-bk");
    const candidates: ReversalCandidate[] = [
      row("o2", "Q5A1", "20.00", "2026-01-15", "loc-B"),
      row("o1", "Q5A1", "20.00", "2026-01-15", "loc-A"),
    ];
    const res = applyCrossBatchMatches([refund], candidates);
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].originalId).toBe("o1");
  });
});
