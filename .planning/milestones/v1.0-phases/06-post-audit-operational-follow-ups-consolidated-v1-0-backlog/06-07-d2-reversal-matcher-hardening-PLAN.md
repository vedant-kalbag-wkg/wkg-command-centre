---
plan_id: 06-07
plan_name: d2-reversal-matcher-hardening
phase: 6
wave: 5
depends_on: []
requirements_addressed: [SC6, SC10]
files_modified:
  - src/lib/sales/reversal-matcher.ts
  - src/lib/sales/reversal-matcher.test.ts
  - scripts/measure-reversal-orphan-rate.ts
  - tasks/todo.md
autonomous: true
estimated_tasks: 3
---

<must_haves>
**Phase 6 is verified for SC6 ONLY when:** (1) the cross-batch ORDER BY non-determinism at `src/lib/sales/reversal-matcher.ts:148-153` is fixed with a deterministic tiebreaker (e.g. `id ASC` after `transactionDate DESC`); (2) `src/lib/sales/reversal-matcher.test.ts` gains a new property-based test that runs ≥100 random input permutations of cross-batch candidates with identical `transactionDate` and asserts the matcher output is identical across all permutations; (3) `scripts/measure-reversal-orphan-rate.ts` exists, runs against any `DATABASE_URL`, and prints the current orphan count + percentage; (4) the test file carries a comment block recording the staging-DB orphan-rate baseline so future drift triggers a test failure or alert.

Per RESEARCH.md (lines 412–418) + handoff §4: integer-cents math is OUT OF SCOPE — explicitly deferred. NUMERIC(12,2) round-trips through `Number()` exactly at the magnitudes we see, so `.toFixed(2)` string-key canonicalisation is sufficient. This plan does NOT touch `abs(n)` or the magnitude-comparison logic.

**SC10 contribution:** `tasks/todo.md` line 146 (D2 reversal-matcher follow-ups) is checked `[x]` after this plan completes.
</must_haves>

<objective>
Harden two real-but-not-urgent issues in the D2 reversal-matcher: (a) the cross-batch ORDER BY non-determinism that causes different match outputs for the same input depending on row arrival order; (b) the lack of measurement / regression coverage for the 2% orphan rate that the audit observed on prod data.

Per RESEARCH.md "Reality check": the matcher lives at `src/lib/sales/reversal-matcher.ts` (NOT in `src/lib/sales-csv.ts` as CONTEXT.md said). The existing 11 vitest tests cover happy paths but not the determinism or orphan-rate concerns.

Per CONTEXT D-19, this plan ships as PR 5 (its own PR; not bundled). Lowest-risk plan in the phase — pure-function refactor with strong test coverage.

Output: 1 src edit (reversal-matcher.ts:148-153 + minor signature additions); 1 test extension (≥3 new tests); 1 new measurement script; tasks/todo.md tick.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-CONTEXT.md
@.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-RESEARCH.md
@src/lib/sales/reversal-matcher.ts
@src/lib/sales/reversal-matcher.test.ts
@tasks/handoff-2026-04-27-pr-28-open.md
@tasks/todo.md
</context>

<interfaces>
<!-- Current cross-batch tiebreaker (src/lib/sales/reversal-matcher.ts:140-167) — the bug -->
```typescript
for (const refund of unmatchedRefunds) {
  const list = candidatesByRefNo.get(refund.refNo);
  if (!list || list.length === 0) {
    orphans.push(refund);
    continue;
  }
  const refundMag = abs(refund.netAmount);
  let bestIdx = -1;
  for (let i = 0; i < list.length; i++) {
    if (abs(list[i].netAmount) >= refundMag) {
      if (bestIdx === -1 || list[i].transactionDate > list[bestIdx].transactionDate) {
        bestIdx = i;
      }
    }
  }
  // ...
}
```
When two candidates share `transactionDate`, `bestIdx` is determined by INSERTION ORDER of `list` — i.e. the order rows arrive at this function. Different SQL executions returning rows in different orders produce different match outputs. Fix: add a deterministic tiebreaker on `id` (or an explicit secondary sort key).

<!-- Schema column type for amounts: NUMERIC(12, 2) — Drizzle `numeric(12, 2)`. -->
<!-- Per handoff §4: cents-math is "prophylactic at the magnitudes we see" — deferred. -->

<!-- ReversalCandidate type (lines 34-44) -->
```typescript
export type ReversalCandidate = {
  id: string;
  refNo: string;
  netAmount: string;
  transactionDate: string;
  locationId: string;
};
```

<!-- Existing test file (src/lib/sales/reversal-matcher.test.ts) — 11 tests, lines 1-103. The `row(...)` helper at lines 8-14 is the test fixture pattern to mirror in new tests. -->

<!-- The orphan rate is observed in production but has no measurement code. RESEARCH.md (lines 419-424): "No counter or logging in `reversal-matcher.ts` exposes the 2% number directly." -->
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix cross-batch ORDER BY non-determinism with property-based tests</name>
  <files>
    src/lib/sales/reversal-matcher.ts,
    src/lib/sales/reversal-matcher.test.ts
  </files>
  <read_first>
    - src/lib/sales/reversal-matcher.ts (all 170 lines — particularly lines 140–167 for the bug; lines 60 for `abs`; lines 34–58 for the types)
    - src/lib/sales/reversal-matcher.test.ts (all 103 lines — pattern + the existing `row(...)` helper at lines 8–14)
    - tasks/handoff-2026-04-27-pr-28-open.md §4 — confirms cents-math is OUT of scope
  </read_first>
  <behavior>
    **Tests written FIRST.** Three new tests in the existing `describe("applyCrossBatchMatches", ...)` block:

    Test 1: "selects deterministic original when multiple candidates share transactionDate" — given 3 candidates with the same `transactionDate='2026-01-15'` and same `refNo='Q5A1'` and amount `'20.00'`, plus 1 refund of `'-5.00'`, the matched original must always be the same regardless of input array order. Run the test 100 times with `list.sort(() => Math.random() - 0.5)` between calls; assert all 100 results identical.

    Test 2: "tiebreaker prefers higher id when transactionDates equal" (or whatever convention is chosen — see Action). Given 2 candidates with same date but different ids `o1` and `o2`, assert the chosen original has the expected id per the tiebreaker rule.

    Test 3: "in-batch matcher also uses deterministic tiebreaker on equal transactionDate" — same as Test 1 but for `matchInBatchReversals`. The existing in-batch matcher at lines 94–97 has the same kind of "most-recent-by-date" loop and the same non-determinism bug:
    ```typescript
    let bestIdx = 0;
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].transactionDate > candidates[bestIdx].transactionDate) bestIdx = i;
    }
    ```
    On equal `transactionDate`, the `>` returns false and `bestIdx` stays at the earlier index (0). This is technically deterministic given a fixed input, but the input ORDER itself is non-deterministic at the call site. The fix: add the same `id` tiebreaker so the OUTPUT is deterministic for any insertion order.
  </behavior>
  <action>
**(A) RED — write the 3 tests first** in `src/lib/sales/reversal-matcher.test.ts`. Use the existing `row(...)` helper. For the property-style test, use vanilla loops (no fast-check needed — the repo doesn't have it; introducing a new dep here is overkill):

```typescript
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
  expect(results.size).toBe(1); // every permutation chose the same original
});

it("cross-batch tiebreaker prefers lower id when transactionDates equal", () => {
  const refund = row("r1", "Q5A1", "-5.00", "2026-02-01", "loc-bk");
  const candidates: ReversalCandidate[] = [
    row("o2", "Q5A1", "20.00", "2026-01-15", "loc-B"),
    row("o1", "Q5A1", "20.00", "2026-01-15", "loc-A"),
  ];
  const res = applyCrossBatchMatches([refund], candidates);
  expect(res.matches[0].originalId).toBe("o1"); // lower id wins on tied date
});

it("in-batch tiebreaker also deterministic across permutations", () => {
  const original1 = row("o1", "Q5A1", "10.00", "2026-01-05", "loc-A");
  const original2 = row("o2", "Q5A1", "10.00", "2026-01-05", "loc-B");
  const refund = row("r1", "Q5A1", "-10.00", "2026-01-06", "loc-bk");

  const results = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const shuffled = [original1, original2, refund].sort(() => Math.random() - 0.5);
    const res = matchInBatchReversals(shuffled);
    expect(res.matches).toHaveLength(1);
    results.add(res.matches[0].originalId);
  }
  expect(results.size).toBe(1);
});
```

**Tiebreaker convention chosen: lower `id` wins on tied `transactionDate`.** Rationale: `id` is a UUID assigned by the ingest path (`randomUUID()` per row, per the comment at line 34–37). It's stable across re-runs and deterministic. Lexicographic UUID comparison is fine for a tiebreaker — the choice of "lower" vs "higher" is arbitrary; we pick "lower" to match the natural ascending-sort default.

**(B) GREEN — fix the implementation.**

In `src/lib/sales/reversal-matcher.ts`:

Lines 148–153 (cross-batch loop), change from:
```typescript
for (let i = 0; i < list.length; i++) {
  if (abs(list[i].netAmount) >= refundMag) {
    if (bestIdx === -1 || list[i].transactionDate > list[bestIdx].transactionDate) {
      bestIdx = i;
    }
  }
}
```
to:
```typescript
for (let i = 0; i < list.length; i++) {
  if (abs(list[i].netAmount) >= refundMag) {
    if (bestIdx === -1) {
      bestIdx = i;
    } else if (list[i].transactionDate > list[bestIdx].transactionDate) {
      bestIdx = i;
    } else if (list[i].transactionDate === list[bestIdx].transactionDate && list[i].id < list[bestIdx].id) {
      bestIdx = i;
    }
  }
}
```

Lines 94–97 (in-batch loop), change from:
```typescript
let bestIdx = 0;
for (let i = 1; i < candidates.length; i++) {
  if (candidates[i].transactionDate > candidates[bestIdx].transactionDate) bestIdx = i;
}
```
to:
```typescript
let bestIdx = 0;
for (let i = 1; i < candidates.length; i++) {
  if (candidates[i].transactionDate > candidates[bestIdx].transactionDate) {
    bestIdx = i;
  } else if (candidates[i].transactionDate === candidates[bestIdx].transactionDate && candidates[i].id < candidates[bestIdx].id) {
    bestIdx = i;
  }
}
```

Add a JSDoc note above each function pointing at the tiebreaker:
```typescript
/**
 * ...
 * Tiebreaker on equal transactionDate: lower `id` wins. This makes the match
 * output deterministic regardless of input array ordering — required because
 * the call site fetches candidates via SQL whose row order is not guaranteed
 * stable across runs (no ORDER BY id at the SQL layer). See plan 06-07 for
 * the regression-test scaffold.
 */
```

**(C) Update the existing comment block at the top of `reversal-matcher.ts`** to document the determinism guarantee. The current top-of-file JSDoc covers matching rules but not ordering guarantees — append a paragraph.

**(D) Verify ALL tests pass — both the new 3 AND the existing 11.**
  </action>
  <verify>
    <automated>
npx vitest run --project unit src/lib/sales/reversal-matcher.test.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - File `src/lib/sales/reversal-matcher.test.ts` has ≥ 14 tests (existing 11 + 3 new): `grep -c "^  it(" src/lib/sales/reversal-matcher.test.ts` returns ≥ 14.
    - `grep -c "100 random input permutations\|deterministic" src/lib/sales/reversal-matcher.test.ts` returns ≥ 2.
    - File `src/lib/sales/reversal-matcher.ts` contains the literal string `list[i].id < list[bestIdx].id` (cross-batch tiebreaker).
    - File `src/lib/sales/reversal-matcher.ts` contains the literal string `candidates[i].id < candidates[bestIdx].id` (in-batch tiebreaker).
    - `npx vitest run --project unit src/lib/sales/reversal-matcher.test.ts` exits 0 with all 14+ tests passing.
    - `grep -c "Tiebreaker on equal transactionDate" src/lib/sales/reversal-matcher.ts` returns ≥ 1 (JSDoc noted).
  </acceptance_criteria>
  <done>
    Both in-batch and cross-batch matchers are deterministic across input permutations; 3 new property-style tests pin the determinism; the existing 11 happy-path tests still pass (no behaviour regression for the cases they cover).
  </done>
</task>

<task type="auto">
  <name>Task 2: Orphan-rate measurement script + baseline comment in test file</name>
  <files>
    scripts/measure-reversal-orphan-rate.ts,
    src/lib/sales/reversal-matcher.test.ts
  </files>
  <read_first>
    - scripts/backfill-kiosk-install-dates.ts (the `Pool` + `client.query` pattern for read-only DB scripts)
    - src/lib/sales/reversal-matcher.ts (the `applyCrossBatchMatches` function — the script will run it offline against fetched data)
    - src/db/schema.ts (the `salesRecords` columns relevant to the matcher: `id`, `refNo`, `netAmount`, `transactionDate`, `locationId`, `isReversal`, `originalRecordId`)
  </read_first>
  <action>
**(A) Create `scripts/measure-reversal-orphan-rate.ts`** — a READ-ONLY script that fetches all reversal rows + their potential cross-batch originals from the live DB, runs `applyCrossBatchMatches`, and reports the orphan rate.

```typescript
/**
 * Measure the cross-batch reversal orphan rate against a live DB.
 *
 * Phase 6 plan 06-07 — the audit observed a ~2% orphan gap (refund rows where
 * no matching original exists in the data window). This script runs the
 * matcher offline against current production data and prints the gap so a
 * baseline can be recorded in the test file's drift-detection comment.
 *
 * Usage (read-only — no writes):
 *   DATABASE_URL=... npx tsx scripts/measure-reversal-orphan-rate.ts
 */
import { Pool } from "pg";
import { applyCrossBatchMatches, type ReversalCandidate } from "@/lib/sales/reversal-matcher";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    // 1. Fetch every reversal row whose original_record_id is currently NULL
    //    (the candidates for cross-batch matching at ingest time).
    const refunds = await client.query<{
      id: string;
      ref_no: string;
      net_amount: string;
      transaction_date: string;
      location_id: string;
    }>(`
      SELECT id, ref_no, net_amount, transaction_date::text, location_id
        FROM sales_records
       WHERE is_reversal = true
         AND original_record_id IS NULL
    `);

    if (refunds.rows.length === 0) {
      console.log("No unmatched refunds — orphan rate is 0/0.");
      return;
    }

    // 2. For each refund's ref_no, fetch the candidate originals (positive amounts only).
    const refNos = [...new Set(refunds.rows.map((r) => r.ref_no))];
    const candidatesRes = await client.query<{
      id: string;
      ref_no: string;
      net_amount: string;
      transaction_date: string;
      location_id: string;
    }>(`
      SELECT id, ref_no, net_amount, transaction_date::text, location_id
        FROM sales_records
       WHERE is_reversal = false
         AND ref_no = ANY($1::text[])
         AND net_amount::numeric > 0
    `, [refNos]);

    // 3. Map to ReversalCandidate shape and run the matcher.
    const refundCandidates: ReversalCandidate[] = refunds.rows.map((r) => ({
      id: r.id, refNo: r.ref_no, netAmount: r.net_amount,
      transactionDate: r.transaction_date, locationId: r.location_id,
    }));
    const originalCandidates: ReversalCandidate[] = candidatesRes.rows.map((r) => ({
      id: r.id, refNo: r.ref_no, netAmount: r.net_amount,
      transactionDate: r.transaction_date, locationId: r.location_id,
    }));

    const { matches, orphans } = applyCrossBatchMatches(refundCandidates, originalCandidates);

    const totalRefunds = refundCandidates.length;
    const orphanRate = (orphans.length / totalRefunds) * 100;
    console.log("");
    console.log("═══ Reversal Orphan Rate ═══");
    console.log(`  Total refunds (with NULL original_record_id): ${totalRefunds}`);
    console.log(`  Cross-batch matches found: ${matches.length}`);
    console.log(`  Orphans (still no original): ${orphans.length}`);
    console.log(`  Orphan rate: ${orphanRate.toFixed(2)}%`);
    console.log("");
    console.log("Update the baseline comment in src/lib/sales/reversal-matcher.test.ts:");
    console.log(`  // Orphan baseline measured YYYY-MM-DD on prod: ${orphans.length}/${totalRefunds} = ${orphanRate.toFixed(2)}%`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

**(B) Run the script against staging and capture the output.** Operator runs:
```bash
DATABASE_URL='<staging>' npx tsx scripts/measure-reversal-orphan-rate.ts
```
Note the result. Then run on prod (read-only — safe):
```bash
DATABASE_URL='<prod>' npx tsx scripts/measure-reversal-orphan-rate.ts
```

**(C) Add the baseline comment to `src/lib/sales/reversal-matcher.test.ts`** at the top of the `describe("applyCrossBatchMatches", ...)` block:

```typescript
describe("applyCrossBatchMatches", () => {
  // ───────────────────────────────────────────────────────────────────────
  // Orphan-rate baseline (measured by scripts/measure-reversal-orphan-rate.ts)
  //
  //   Staging YYYY-MM-DD: <orphans>/<totalRefunds> = <X.XX>% orphan rate
  //   Production YYYY-MM-DD: <orphans>/<totalRefunds> = <Y.YY>% orphan rate
  //
  // The original audit observed ~2% orphan rate — these are refunds with no
  // matching original in the data window. Per handoff-2026-04-27-pr-28-open.md
  // §4, the gap is a known data property (refunds for bookings that predate
  // the imported sales window) and not a matcher bug. If a future re-run
  // shows orphan rate > 5%, investigate: either the matcher regressed, or
  // the data shape changed (e.g. mid-batch ingest failures producing more
  // unmatched halves).
  //
  // To re-measure: DATABASE_URL=... npx tsx scripts/measure-reversal-orphan-rate.ts
  // ───────────────────────────────────────────────────────────────────────
```

The numeric baseline values are filled in by the operator after running the script (Task 2 step B). Use placeholder `<X.XX>` in the committed code if the operator hasn't run yet, with a `TODO: fill from prod measurement after deploy` note.

**(D) Optional: add a self-check test that re-runs the matcher over a SYNTHETIC fixture matching the orphan-pattern shape** — refunds whose original was older than the data window. This is documented in RESEARCH.md as a "fixture set that reproduces the 2% orphan pattern":

```typescript
it("orphan path: refunds with no in-window original become orphans (regression scaffold)", () => {
  // Synthetic shape: 5 refunds, 2 have valid in-window originals, 3 do not.
  const refunds: ReversalCandidate[] = [
    row("r1", "A", "-10.00", "2026-02-01", "loc"),
    row("r2", "B", "-20.00", "2026-02-02", "loc"),
    row("r3", "ORPHAN1", "-30.00", "2026-02-03", "loc"),
    row("r4", "ORPHAN2", "-40.00", "2026-02-04", "loc"),
    row("r5", "ORPHAN3", "-50.00", "2026-02-05", "loc"),
  ];
  const candidates: ReversalCandidate[] = [
    row("o1", "A", "10.00", "2026-01-15", "loc"),
    row("o2", "B", "20.00", "2026-01-16", "loc"),
  ];
  const res = applyCrossBatchMatches(refunds, candidates);
  expect(res.matches).toHaveLength(2);
  expect(res.orphans).toHaveLength(3);
  expect(res.orphans.map((r) => r.id).sort()).toEqual(["r3", "r4", "r5"]);
});
```
  </action>
  <verify>
    <automated>
test -f scripts/measure-reversal-orphan-rate.ts && grep -c "Orphan-rate baseline\|Orphan rate" src/lib/sales/reversal-matcher.test.ts && npx vitest run --project unit src/lib/sales/reversal-matcher.test.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - File `scripts/measure-reversal-orphan-rate.ts` exists.
    - `grep -c "applyCrossBatchMatches" scripts/measure-reversal-orphan-rate.ts` returns ≥ 1 (it imports + runs the matcher).
    - `grep -c "DATABASE_URL" scripts/measure-reversal-orphan-rate.ts` returns ≥ 1 (env validation).
    - `grep -c "Orphan-rate baseline" src/lib/sales/reversal-matcher.test.ts` returns ≥ 1.
    - `npx vitest run --project unit src/lib/sales/reversal-matcher.test.ts` exits 0 with all tests still passing.
    - One-time manual: operator runs `npx tsx scripts/measure-reversal-orphan-rate.ts` against staging + prod and updates the baseline numbers in the test-file comment.
  </acceptance_criteria>
  <done>
    Orphan rate is now measurable (any time, any DB) via a single command; the test file documents the historical baseline so future drift produces a code-review signal; an additional regression-scaffold test pins the orphan-detection contract.
  </done>
</task>

<task type="auto">
  <name>Task 3: Close todo.md + per-plan summary commit</name>
  <files>
    tasks/todo.md
  </files>
  <read_first>
    - tasks/todo.md (line 146 — D2 reversal-matcher follow-up entry)
  </read_first>
  <action>
Edit `tasks/todo.md` line 146. Current state:
```
- [ ] **D2 reversal matcher follow-ups** (in-batch partial-refund matcher, cross-batch ORDER BY determinism, integer-cents math) — **deferred**. The matcher's existing magnitude path canonicalises via `.toFixed(2)` string keys, so the cents-math concern is prophylactic at the magnitudes we see (NUMERIC(12,2) round-trip is exact through `Number()` here). The 2% orphan gap and cross-batch ordering are real but warrant their own PR with a regression-test scaffold against synthetic in-batch / cross-batch fixtures.
```

Change to:
```
- [x] **D2 reversal matcher follow-ups** — Phase 6 plan 06-07 (PR #NN). (a) Cross-batch ORDER BY non-determinism FIXED at `src/lib/sales/reversal-matcher.ts:148-167` with `id` tiebreaker on tied `transactionDate` (also applied to in-batch matcher at lines 94-97). (b) Property-based test in `reversal-matcher.test.ts` runs 100 random input permutations and asserts identical matcher output. (c) Orphan-rate measurement at `scripts/measure-reversal-orphan-rate.ts`; baseline recorded in test-file comment. (d) Integer-cents math DEFERRED — prophylactic at NUMERIC(12,2) magnitudes per handoff §4; revisit if ever scaled to currencies/values where Number() loses precision.
```

Per-plan summary commit on the plan's branch (`gsd/phase-06-d2-reversal-hardening`): `fix(sales): deterministic cross-batch reversal matching + orphan-rate measurement (SC6)`.
  </action>
  <verify>
    <automated>
grep -c '^- \[x\] \*\*D2 reversal matcher follow-ups\*\*' tasks/todo.md
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c '^- \[x\] \*\*D2 reversal matcher follow-ups\*\*' tasks/todo.md` returns 1.
    - `grep -c '^- \[ \] \*\*D2 reversal matcher follow-ups\*\*' tasks/todo.md` returns 0.
    - The plan branch's most recent commit subject contains the literal string `reversal` and references SC6 (or D2).
  </acceptance_criteria>
  <done>
    todo.md tick; plan branch ready for PR.
  </done>
</task>

</tasks>

<verification>
- `npx vitest run --project unit src/lib/sales/reversal-matcher.test.ts` exits 0 with ≥ 14 passing tests
- `npx tsx scripts/measure-reversal-orphan-rate.ts` (against staging) prints orphan rate and exits 0
- `npm run typecheck` exits 0
- `tasks/todo.md` line 146 ticked
</verification>

<success_criteria>
1. SC6 — cross-batch ORDER BY non-determinism fixed; property-based test (100 permutations) pins the determinism contract; orphan-rate measurement script + baseline comment in test file; cents-math hardening explicitly deferred per handoff §4.
2. SC10 contribution — `tasks/todo.md` line 146 ticked.
</success_criteria>

<output>
After completion, create `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-07-SUMMARY.md`: the tiebreaker convention chosen; orphan-rate baseline measurements (staging + prod); links to the new tests; PR # + merge SHA.
</output>
