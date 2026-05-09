---
phase: 09-poc-underperformance-alerts
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/performance-alerts/classify-dispatch.ts
  - src/lib/performance-alerts/classify-dispatch.test.ts
  - src/lib/performance-alerts/iso-week.ts
  - src/lib/performance-alerts/iso-week.test.ts
  - src/lib/performance-alerts/poc-batching.ts
  - src/lib/performance-alerts/poc-batching.test.ts
  - src/lib/performance-alerts/hash.ts
autonomous: true
requirements: [POC-ALERT-01]
must_haves:
  truths:
    - "decideAlert(prior, newTier, now) returns 'flip-in' for first-bottom-classification"
    - "decideAlert returns 'chronic' for prior=bottom AND last_alerted_at >= 30 days ago"
    - "decideAlert returns 'no-alert' for prior=bottom AND last_alerted_at < 30 days ago"
    - "isoWeekKey(date) computes ISO-8601 week in Europe/London wall-clock — handles 2026-12-28 / 2027-01-04 boundary cases correctly"
    - "groupByPoc(rows) batches kiosks by internal_poc_id, separates NULL-POC kiosks into a sentinel skip group"
    - "sha256(s) returns a stable 64-char hex string for the same input"
  artifacts:
    - path: "src/lib/performance-alerts/classify-dispatch.ts"
      provides: "Pure decideAlert function — flip-in / chronic / no-alert decision (D-10)"
      exports: ["decideAlert", "Decision", "Tier"]
    - path: "src/lib/performance-alerts/iso-week.ts"
      provides: "isoWeekKey(date) — Europe/London ISO-8601 week string"
      exports: ["isoWeekKey"]
    - path: "src/lib/performance-alerts/poc-batching.ts"
      provides: "groupByPoc(rows) — pure reducer that buckets kiosks by internal_poc_id"
      exports: ["groupByPoc", "PocGroup"]
    - path: "src/lib/performance-alerts/hash.ts"
      provides: "sha256(s) — stable hex hash for payloadHash idempotency keying"
      exports: ["sha256"]
  key_links:
    - from: "decideAlert + isoWeekKey + groupByPoc + sha256"
      to: "src/inngest/functions/weekly-poc-alerts.ts (plan 09-03)"
      via: "imports — these four pure functions are the testable core that the cron orchestrates"
---

<objective>
Build the pure-functional core of the cron logic — three decision/transform
functions plus a tiny hash helper — with co-located unit tests
(failing-by-default Wave 0 stubs that pass once the implementation is
written). Doing this independently of the cron lets us cover all the
edge cases that VALIDATION.md (a)+(b)+(c)+(f) require, without running
Testcontainers or Inngest's dev server. The cron in plan 09-03 then
orchestrates these utilities — which keeps the cron's body small enough
to fit in one Inngest function and isolates the decision rules in pure
code that's easy to reason about.

PATTERNS.md flags `decideAlert` and `isoWeekKey` as **NOVEL** — there is
no codebase analog. The reference shapes come from RESEARCH.md § Code
Examples lines 530-558 (`decideAlert`) and § Pitfall 1 lines 320-323
(ISO-week). `groupByPoc` has a structural twin in
`src/lib/analytics/metrics.ts § classifyOutletTier` (pure typed
reducer). `sha256` is a 5-line wrapper over Node's `crypto` module.

Purpose: Wave 0 test stubs from VALIDATION.md must exist on disk so
plan 09-03's cron implementation can be verified by re-running the
unit tests. Pure logic also dodges the entire ISO-week timezone
class of bugs (RESEARCH § Pitfall 1) by pinning the boundary cases as
named tests.

Output:
- 4 source files in `src/lib/performance-alerts/`
- 3 test files (no test for `hash.ts` — it's a thin Node `crypto`
  wrapper; if the hash differs, every dependent test fails loudly)
- All tests pass when run with `npx vitest run --project unit src/lib/performance-alerts/`
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md
@.planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md
@.planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md
@.planning/phases/09-poc-underperformance-alerts/09-VALIDATION.md

@src/lib/analytics/metrics.ts
@vitest.config.ts

<interfaces>
<!-- Reference shapes for the executor — extracted from RESEARCH.md and PATTERNS.md. -->

decideAlert spec (RESEARCH § Code Examples lines 530-558):
```typescript
type Tier = "Premium" | "Standard" | "Developing" | "Emerging";
//        per RESEARCH § Open Q1: store classifyOutletTier's verbatim return value;
//        "Emerging" is the bottom-tier sentinel.

export type Decision = "flip-in" | "chronic" | "no-alert";

export function decideAlert(
  prior: { tier: Tier; lastAlertedAt: Date | null } | null,
  newTier: Tier,
  now: Date,
): Decision;
```

Decision rules (CONTEXT D-10 — verbatim):
- `is_flip_in` = (prior_tier ≠ 'bottom' OR no prior state) AND (new_tier = 'bottom') → ALWAYS alert
- `is_chronic` = (new_tier = 'bottom') AND (prior_tier = 'bottom') AND (last_alerted_at IS NULL OR now − last_alerted_at ≥ 30 days) → ALERT
- Otherwise → no alert this run, but state is still updated

isoWeekKey spec (RESEARCH § Pitfall 1):
```typescript
// Returns an ISO-8601 week string like "2026-W19" computed in Europe/London
// wall-clock time (NOT UTC). Pitfall 1 case: a Date at 2026-12-28T01:00Z is
// Monday 2026-12-28 in London (week 53), but at 2027-01-03T23:55Z it's still
// Sunday in London (also week 53). At 2027-01-04T01:00Z it's Monday week 1.
export function isoWeekKey(date: Date): string;
```

groupByPoc spec (PATTERNS § poc-batching.ts + RESEARCH § Anti-Patterns):
```typescript
type ClassifiedKiosk = {
  kioskId: string;
  internalPocId: string | null;
  // ... other classification fields opaque to this reducer ...
  decision: "flip-in" | "chronic" | "no-alert";
};

type PocGroup = {
  pocUserId: string | null;  // null = the skip-no-poc sentinel bucket
  kiosks: ClassifiedKiosk[];
};

export function groupByPoc(rows: ClassifiedKiosk[]): PocGroup[];
```
</interfaces>

<test_substrate>
The vitest unit project (per `vitest.config.ts`):
- Test files match `**/*.test.ts` adjacent to source.
- Run via `npx vitest run --project unit <pathspec>`.
- No DB, no network — pure functions only.

Use the standard vitest API: `import { describe, it, expect } from "vitest"`.
</test_substrate>
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none — pure functions, no I/O, no user input) | Defensive code only matters for the consumers (cron + tests). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-02-01 | Tampering | `decideAlert` decision rule | mitigate | Pure function, no I/O; behaviour pinned by unit tests covering every D-10 branch (flip-in, chronic, no-alert × prior-null/prior-bottom/prior-other). Reviewer can read the rule in 20 lines. |
| T-09-02-02 | Tampering | `isoWeekKey` boundary | mitigate | Pinned with the three RESEARCH § Pitfall 1 cases (2026-12-28 Mon, 2027-01-03 Sun, 2027-01-04 Mon). If the implementation ever computes ISO week in UTC instead of London, the boundary tests fail. |
| T-09-02-03 | Information Disclosure | `sha256` of `(poc_user_id, run_iso_week)` | accept | This is a stable hash for idempotency keying, NOT a secret. The user_id + ISO week are not secrets either. SHA-256 is appropriate (not bcrypt — we want determinism, not slow-hashing). |
| T-09-02-04 | Tampering | `groupByPoc` ordering | accept | Deterministic insertion-order grouping. Order does not affect downstream correctness (the cron's email-emit step doesn't depend on POC order). |

ASVS controls applied:
- V5.1 (Input Validation): `decideAlert` validates the `newTier` value via TypeScript's union type at compile time; runtime input comes from `classifyOutletTier`'s typed return value.
- V6.2.1 (Cryptography): SHA-256 used for idempotency keying (NOT for password hashing); algorithm is appropriate.
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: classify-dispatch.ts + tests (decideAlert pure logic)</name>
  <files>src/lib/performance-alerts/classify-dispatch.ts, src/lib/performance-alerts/classify-dispatch.test.ts</files>
  <read_first>
    - .planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md § Code Examples lines 530-558 (canonical spec).
    - .planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md § D-10 (the verbatim alert dispatch rule).
    - src/lib/analytics/metrics.ts — confirms `classifyOutletTier` returns one of `"Premium" | "Standard" | "Developing" | "Emerging"` (the `Tier` type aligns with this).
    - .planning/phases/09-poc-underperformance-alerts/09-VALIDATION.md row (b) — automated command this task's tests must pass under.
  </read_first>
  <behavior>
    Tests (write FIRST, watch them FAIL, then write the implementation):
    - Test 1: `prior=null, newTier="Emerging"` → returns `"flip-in"` (no prior state + new bottom = alert).
    - Test 2: `prior={tier:"Standard", lastAlertedAt:null}, newTier="Emerging"` → `"flip-in"` (was non-bottom, now bottom).
    - Test 3: `prior={tier:"Emerging", lastAlertedAt:null}, newTier="Emerging"` → `"chronic"` (was bottom, no last-alerted record means cap is open).
    - Test 4: `prior={tier:"Emerging", lastAlertedAt: 31 days ago}, newTier="Emerging"` → `"chronic"` (cap exceeded).
    - Test 5: `prior={tier:"Emerging", lastAlertedAt: 29 days ago}, newTier="Emerging"` → `"no-alert"` (still inside cap).
    - Test 6: `prior={tier:"Emerging", lastAlertedAt: exactly 30 days ago}, newTier="Emerging"` → `"chronic"` (boundary inclusive — uses `>=`).
    - Test 7: `prior=null, newTier="Premium"` → `"no-alert"` (new tier is not bottom).
    - Test 8: `prior={tier:"Emerging", lastAlertedAt: 5 days ago}, newTier="Standard"` → `"no-alert"` (kiosk recovered out of bottom).
  </behavior>
  <action>
    1. Create `src/lib/performance-alerts/classify-dispatch.test.ts` first with the 8 cases above. Use `vi.useFakeTimers()` + `vi.setSystemTime(new Date("2026-05-04T09:00:00Z"))` so `now` is deterministic; pass it explicitly into `decideAlert` (the function takes `now` as a parameter — does NOT call `Date.now()` internally).
    2. Run `npx vitest run --project unit src/lib/performance-alerts/classify-dispatch.test.ts` and confirm it fails (file `classify-dispatch.ts` does not exist).
    3. Create `src/lib/performance-alerts/classify-dispatch.ts`:

    ```typescript
    /**
     * Pure decision function for the weekly POC underperformance alert (D-10).
     *
     * Tier strings match the verbatim return value of classifyOutletTier
     * (src/lib/analytics/metrics.ts) — "Emerging" is the bottom-tier sentinel
     * (per Phase 9 RESEARCH § Open Q1).
     *
     * `now` is passed in (not read from Date.now) so callers can use fake
     * timers in tests.
     */
    export type Tier = "Premium" | "Standard" | "Developing" | "Emerging";
    export type Decision = "flip-in" | "chronic" | "no-alert";

    const BOTTOM_TIER: Tier = "Emerging";
    const CHRONIC_CAP_MS = 30 * 24 * 60 * 60 * 1000;

    export function decideAlert(
      prior: { tier: Tier; lastAlertedAt: Date | null } | null,
      newTier: Tier,
      now: Date,
    ): Decision {
      if (newTier !== BOTTOM_TIER) return "no-alert";
      // is_flip_in: no prior state OR prior tier was not bottom
      if (!prior || prior.tier !== BOTTOM_TIER) return "flip-in";
      // is_chronic: prior was bottom AND (never alerted OR cap window exceeded)
      if (
        prior.lastAlertedAt === null ||
        now.getTime() - prior.lastAlertedAt.getTime() >= CHRONIC_CAP_MS
      ) {
        return "chronic";
      }
      return "no-alert";
    }
    ```

    4. Re-run the test command. All 8 tests must pass.
  </action>
  <verify>
    <automated>npx vitest run --project unit src/lib/performance-alerts/classify-dispatch.test.ts</automated>
  </verify>
  <done>
    - `classify-dispatch.ts` exports `decideAlert`, `Decision`, `Tier`.
    - `classify-dispatch.test.ts` covers the 8 cases above.
    - All tests pass.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: iso-week.ts + tests (Europe/London ISO-8601 week computation)</name>
  <files>src/lib/performance-alerts/iso-week.ts, src/lib/performance-alerts/iso-week.test.ts</files>
  <read_first>
    - .planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md § Pitfall 1 lines 313-326 (canonical spec for the boundary cases).
    - .planning/phases/09-poc-underperformance-alerts/09-VALIDATION.md row (f) (the test command and the three boundary dates).
    - .planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md § D-17 (uses `run_iso_week` for `payloadHash` keying — that's why this function needs to be deterministic across the Sunday→Monday boundary in London).
  </read_first>
  <behavior>
    Tests (write FIRST):
    - 2026-12-28 Mon 09:00 London → `"2026-W53"` (week 53 starts on this Monday).
    - 2026-12-31 Thu 12:00 London → `"2026-W53"` (still week 53).
    - 2027-01-03 Sun 23:55 London → `"2026-W53"` (Sunday belongs to the *previous* ISO week).
    - 2027-01-04 Mon 00:01 London → `"2027-W01"` (week 1 of 2027).
    - 2027-01-04 Mon 09:00 Europe/London (= 2027-01-04T09:00:00+00:00 UTC because London is GMT in January) → `"2027-W01"`.
    - 2026-05-04 Mon 09:00 Europe/London (= 2026-05-04T08:00:00Z UTC because London is BST in May) → `"2026-W19"` (verifies BST handling).
    - 2026-05-04 Mon 00:00 UTC (= 2026-05-04T01:00 London BST) → `"2026-W19"` (still in week 19 in London).
    - Sanity: `isoWeekKey(new Date("2027-01-04T00:00:00Z"))` returns `"2027-W01"` (note: this is 00:00 London too, since UTC=GMT in Jan).
  </behavior>
  <action>
    1. Create `src/lib/performance-alerts/iso-week.test.ts` first with the 7+ cases above.
    2. Run `npx vitest run --project unit src/lib/performance-alerts/iso-week.test.ts` and confirm it fails.
    3. Create `src/lib/performance-alerts/iso-week.ts` using `Intl.DateTimeFormat` to extract the London-zone year/month/day, then standard ISO-8601 week math on those parts:

    ```typescript
    /**
     * Compute the ISO-8601 week of the supplied moment in Europe/London
     * wall-clock time. Returns "YYYY-Www" (e.g. "2026-W19").
     *
     * Why London-zone (not UTC):
     *   The cron fires at 09:00 Europe/London. Manual "Run now" triggers may
     *   fire late Sunday London-time. Both must produce the same key for the
     *   same calendar week so payloadHash idempotency works.
     *
     * Why ISO-8601:
     *   Week 1 is the week containing the year's first Thursday; weeks start
     *   Monday. December 31 may belong to week 1 of next year; January 1 may
     *   belong to week 52/53 of previous year. Examples in the test file.
     */
    const LONDON_FORMATTER = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    export function isoWeekKey(date: Date): string {
      // Extract Y/M/D in Europe/London wall-clock.
      const parts = LONDON_FORMATTER.formatToParts(date);
      const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
      const year = get("year");
      const month = get("month");
      const day = get("day");

      // Construct a UTC date with those components — this gives us a "London
      // calendar day" Date independent of the time-of-day. ISO week math is
      // calendar-day based, so this is correct.
      const localDay = new Date(Date.UTC(year, month - 1, day));

      // ISO-8601 week algorithm:
      //   1. Take the Thursday of this calendar week.
      //   2. Year-of-Thursday is the ISO year.
      //   3. Week number = floor((thursday - jan4OfIsoYear) / 7days) + 1.
      // Reference: https://en.wikipedia.org/wiki/ISO_week_date#Calculating_the_week_number_from_an_ordinal_date

      const dayOfWeek = (localDay.getUTCDay() + 6) % 7; // 0=Mon, 6=Sun
      const thursday = new Date(localDay);
      thursday.setUTCDate(localDay.getUTCDate() - dayOfWeek + 3);
      const isoYear = thursday.getUTCFullYear();
      const jan4 = new Date(Date.UTC(isoYear, 0, 4));
      const jan4DayOfWeek = (jan4.getUTCDay() + 6) % 7;
      const week1Monday = new Date(jan4);
      week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayOfWeek);
      const weekNumber =
        Math.floor((thursday.getTime() - week1Monday.getTime()) / (7 * 24 * 3600 * 1000)) + 1;

      return `${isoYear}-W${weekNumber.toString().padStart(2, "0")}`;
    }
    ```

    4. Re-run tests; all must pass.
  </action>
  <verify>
    <automated>npx vitest run --project unit src/lib/performance-alerts/iso-week.test.ts</automated>
  </verify>
  <done>
    - `iso-week.ts` exports `isoWeekKey`.
    - `iso-week.test.ts` covers all 7+ boundary cases above.
    - All tests pass.
    - The function does NOT call `getTimezoneOffset` or hardcode any `+1h` / `-1h` arithmetic (RESEARCH § Pitfall 2).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: poc-batching.ts + tests + hash.ts (the remaining pure utilities)</name>
  <files>src/lib/performance-alerts/poc-batching.ts, src/lib/performance-alerts/poc-batching.test.ts, src/lib/performance-alerts/hash.ts</files>
  <read_first>
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "src/lib/performance-alerts/poc-batching.ts" (PocGroup shape).
    - .planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md § D-06 + D-07 (per-POC batching + NULL POC = skip).
    - .planning/phases/09-poc-underperformance-alerts/09-VALIDATION.md row (c) (test command).
    - src/lib/analytics/metrics.ts § `classifyOutletTier` — the structural twin (pure typed reducer).
  </read_first>
  <behavior>
    `groupByPoc` tests (write FIRST):
    - Empty input → `[]`.
    - 1 kiosk with `internalPocId="alpha"` → 1 group with 1 kiosk.
    - 3 kiosks all with `internalPocId="alpha"` → 1 group with 3 kiosks (per-POC batching).
    - 2 kiosks `alpha` + 1 kiosk `beta` → 2 groups: alpha (2 kiosks), beta (1 kiosk).
    - 1 kiosk `internalPocId=null` → 1 sentinel group with `pocUserId: null` and 1 kiosk (skip-no-poc).
    - 2 kiosks alpha + 1 kiosk null + 1 kiosk beta → 3 groups: alpha (2), null (1), beta (1).
    - Insertion-order preserved within each group.

    `sha256` test (one inline test in `poc-batching.test.ts` is fine — or skip; the hash function is trivial):
    - `sha256("alpha:2026-W19")` returns a 64-char lowercase hex string.
    - `sha256("alpha:2026-W19") === sha256("alpha:2026-W19")` (deterministic).
    - `sha256("alpha:2026-W19") !== sha256("alpha:2026-W20")` (different inputs differ).
  </behavior>
  <action>
    1. Create `src/lib/performance-alerts/poc-batching.test.ts` with the 6 `groupByPoc` cases above + a small `sha256` import test (or write a separate `hash.test.ts` — your choice).

    2. Run the test command — confirm failure.

    3. Create `src/lib/performance-alerts/hash.ts`:

    ```typescript
    import { createHash } from "node:crypto";

    /**
     * Stable SHA-256 hex of the input. Used for payloadHash idempotency
     * keying in the weekly POC alert cron (Phase 9). Deterministic; not
     * for password hashing.
     */
    export function sha256(s: string): string {
      return createHash("sha256").update(s, "utf8").digest("hex");
    }
    ```

    4. Create `src/lib/performance-alerts/poc-batching.ts`:

    ```typescript
    /**
     * Pure reducer that buckets classified-and-decided kiosk rows by their
     * internal_poc_id. Kiosks with NULL POC bucket into a single sentinel
     * group with pocUserId=null — the cron's emit-skip-rows step handles
     * those (D-07: write one email_log skip row per kiosk, no email).
     *
     * Insertion-order preserved within each group so downstream renderings
     * (the email body kiosk-list) reflect the SQL ORDER BY chosen upstream.
     */
    export type ClassifiedKiosk = {
      kioskId: string;
      internalPocId: string | null;
      // ...other fields are opaque to this reducer; T is preserved by generics
      [k: string]: unknown;
    };

    export type PocGroup<T extends ClassifiedKiosk = ClassifiedKiosk> = {
      pocUserId: string | null;  // null = the skip-no-poc sentinel bucket
      kiosks: T[];
    };

    export function groupByPoc<T extends ClassifiedKiosk>(rows: T[]): PocGroup<T>[] {
      const map = new Map<string | null, T[]>();
      for (const row of rows) {
        const key = row.internalPocId ?? null;
        const arr = map.get(key);
        if (arr) {
          arr.push(row);
        } else {
          map.set(key, [row]);
        }
      }
      return Array.from(map.entries()).map(([pocUserId, kiosks]) => ({ pocUserId, kiosks }));
    }
    ```

    5. Re-run tests; all must pass.

    6. Note: the test file imports `sha256` from `./hash` — verify both modules resolve correctly.
  </action>
  <verify>
    <automated>npx vitest run --project unit src/lib/performance-alerts/poc-batching.test.ts</automated>
  </verify>
  <done>
    - All three files exist (`poc-batching.ts`, `poc-batching.test.ts`, `hash.ts`).
    - Tests pass.
    - `groupByPoc` handles empty input, single POC, multi-POC, and NULL-POC sentinel buckets correctly.
    - `sha256` returns deterministic 64-char hex.
  </done>
</task>

</tasks>

<verification>
- `npx vitest run --project unit src/lib/performance-alerts/` exits 0 (all 3 test files pass)
- `grep -c "export function decideAlert" src/lib/performance-alerts/classify-dispatch.ts` returns 1
- `grep -c "export function isoWeekKey" src/lib/performance-alerts/iso-week.ts` returns 1
- `grep -c "export function groupByPoc" src/lib/performance-alerts/poc-batching.ts` returns 1
- `grep -c "export function sha256" src/lib/performance-alerts/hash.ts` returns 1
- No new TS errors: `npx tsc --noEmit` clean
</verification>

<success_criteria>
1. Four pure modules exist in `src/lib/performance-alerts/`.
2. Three Wave-0 unit-test stubs from VALIDATION.md (rows b, c, f) are now passing tests.
3. The cron in plan 09-03 can `import { decideAlert, isoWeekKey, groupByPoc, sha256 }` without further codegen or stubbing.
4. ISO-week boundary cases pinned (RESEARCH § Pitfall 1).
</success_criteria>

<output>
After completion, create `.planning/phases/09-poc-underperformance-alerts/09-02-SUMMARY.md` with:
- Files created
- Test counts per file (e.g. "8 cases in classify-dispatch.test.ts, 7 in iso-week.test.ts, 6 in poc-batching.test.ts")
- Confirmation that the BOTTOM_TIER mapping is `"Emerging"` (RESEARCH Open Q1 lock)
</output>
