# Duplicate Location Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an admin-only `/settings/duplicates` page that scans the `locations` table for likely-duplicate hotel records, lets the admin tune a confidence threshold via slider, and routes each candidate pair into the existing `MergeDialog` for review or dismissal (with dismissals remembered so pairs don't re-appear).

**Architecture:** Detection is on-demand (admin presses **Scan**) — no write-path overhead. A pure-JS scoring function in `src/lib/duplicates/similarity.ts` combines normalized-name Jaccard bigram similarity with three boosts: customer code exact match, geo proximity (haversine ≤ 200m), and hotel-group match. A new `duplicate_dismissals` table stores canonical-ordered pair IDs so dismissed pairs are filtered out of subsequent scans. The existing `mergeLocations` server action and `MergeDialog` component are reused as-is for the merge step. Admin tunes threshold with a shadcn slider; results re-render client-side from a single scan payload (no re-scan per slider tick).

**Tech Stack:** Next.js 16 (App Router, Server Actions), Drizzle ORM, Postgres, React 19, shadcn/ui, Tailwind, Vitest (unit), Playwright (E2E).

---

## Task 0: Set up worktree & branch

**Step 1: Create worktree**

Run: `git worktree add .claude/worktrees/duplicates -b feature/duplicate-locations`
Expected: New worktree directory created on a fresh branch off current HEAD.

**Step 2: Switch to worktree**

Run: `cd .claude/worktrees/duplicates`
All subsequent file paths in this plan are relative to that worktree root.

---

## Task 1: Add `duplicate_dismissals` schema + migration

**Why:** Dismissed pairs must persist so they stop resurfacing across scans. Stored canonical-ordered (smaller UUID first) under a UNIQUE constraint so `(A,B)` and `(B,A)` collapse to one row.

**Files:**
- Modify: `src/db/schema.ts` (append after `locations` table block, before `kioskAssignments`)
- Generate: `migrations/0003_<auto>.sql` (via drizzle-kit)

**Step 1: Add schema block**

Append at the end of `src/db/schema.ts` (after the last existing table):

```typescript
// Duplicate dismissals — admin marks a pair of locations as "not duplicates";
// stored canonical-ordered (locationAId < locationBId lexicographically) so
// the UNIQUE constraint collapses both directions of the pair.
export const duplicateDismissals = pgTable(
  "duplicate_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationAId: uuid("location_a_id").notNull().references(() => locations.id),
    locationBId: uuid("location_b_id").notNull().references(() => locations.id),
    dismissedBy: text("dismissed_by").notNull(),
    dismissedByName: text("dismissed_by_name").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniquePair: uniqueIndex("duplicate_dismissals_pair_idx").on(
      table.locationAId,
      table.locationBId
    ),
  })
);
```

Add `uniqueIndex` to the existing `drizzle-orm/pg-core` import at the top if not already imported.

**Step 2: Generate migration**

Run: `npx drizzle-kit generate`
Expected: New file `migrations/0003_<word>.sql` with `CREATE TABLE "duplicate_dismissals"` and the unique index.

**Step 3: Apply migration**

Run: `npx drizzle-kit push` (project-standard apply; if `migrate` is preferred, use that instead).
Expected: Postgres table `duplicate_dismissals` exists. Verify with:

```
psql "$DATABASE_URL" -c "\d duplicate_dismissals"
```

**Step 4: Commit**

```bash
git add src/db/schema.ts migrations/
git commit -m "feat(duplicates): add duplicate_dismissals table"
```

---

## Task 2: Pure similarity utilities (TDD)

**Why:** Scoring is pure logic — testable without DB. Bigram Jaccard catches "Hilton Kensington" ↔ "Hilton, Kensington" robustly without a dependency.

**Files:**
- Create: `src/lib/duplicates/similarity.ts`
- Create: `src/lib/duplicates/similarity.test.ts`

**Step 1: Write failing tests**

`src/lib/duplicates/similarity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  normalizeForMatch,
  bigramJaccard,
  haversineMeters,
  scorePair,
} from "./similarity";

describe("normalizeForMatch", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeForMatch("  Hilton, London  Kensington! ")).toBe(
      "hilton london kensington"
    );
  });
  it("strips trailing [code] suffixes", () => {
    expect(normalizeForMatch("Hilton London [WK-001]")).toBe("hilton london");
  });
  it("returns empty string for null/undefined", () => {
    expect(normalizeForMatch(null)).toBe("");
    expect(normalizeForMatch(undefined)).toBe("");
  });
});

describe("bigramJaccard", () => {
  it("returns 1 for identical strings", () => {
    expect(bigramJaccard("hilton london", "hilton london")).toBe(1);
  });
  it("returns 0 for fully disjoint strings", () => {
    expect(bigramJaccard("abc", "xyz")).toBe(0);
  });
  it("returns ~0.85+ for near-identical hotel names", () => {
    expect(
      bigramJaccard("hilton london kensington", "hilton london kensington")
    ).toBeGreaterThanOrEqual(0.85);
  });
  it("returns < 0.6 for same-chain different-property", () => {
    // 'Hilton London Kensington' vs 'Hilton London Paddington' —
    // share chain prefix, differ on property name
    expect(
      bigramJaccard(
        "hilton london kensington",
        "hilton london paddington"
      )
    ).toBeLessThan(0.75);
  });
  it("handles short strings without crashing", () => {
    expect(bigramJaccard("a", "a")).toBe(1);
    expect(bigramJaccard("", "")).toBe(0);
  });
});

describe("haversineMeters", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineMeters(51.5, -0.1, 51.5, -0.1)).toBeCloseTo(0, 1);
  });
  it("returns ~111km for 1 degree of latitude", () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
});

describe("scorePair", () => {
  const base = {
    id: "a",
    name: "Hilton London Kensington",
    customerCode: null,
    hotelGroup: null,
    latitude: null,
    longitude: null,
  };

  it("scores identical names ~1.0", () => {
    const r = scorePair(base, { ...base, id: "b" });
    expect(r.score).toBeGreaterThanOrEqual(0.95);
    expect(r.reasons).toContain("name");
  });

  it("boosts when customer codes match exactly", () => {
    const a = { ...base, customerCode: "WK-001" };
    const b = { ...base, id: "b", name: "Hilton Kensington London", customerCode: "WK-001" };
    const r = scorePair(a, b);
    expect(r.reasons).toContain("code");
    expect(r.score).toBeGreaterThan(bigramJaccard(
      normalizeForMatch(a.name),
      normalizeForMatch(b.name)
    ));
  });

  it("boosts when within 200m geo proximity", () => {
    const a = { ...base, latitude: 51.5, longitude: -0.1 };
    const b = { ...base, id: "b", name: "Hilton Ken.", latitude: 51.5001, longitude: -0.1 };
    const r = scorePair(a, b);
    expect(r.reasons).toContain("geo");
  });

  it("does NOT boost geo when coords missing on either side", () => {
    const a = { ...base, latitude: 51.5, longitude: -0.1 };
    const b = { ...base, id: "b", latitude: null, longitude: null };
    const r = scorePair(a, b);
    expect(r.reasons).not.toContain("geo");
  });

  it("clamps score at 1.0", () => {
    const a = { ...base, customerCode: "X", hotelGroup: "Hilton", latitude: 51.5, longitude: -0.1 };
    const b = { ...a, id: "b" };
    const r = scorePair(a, b);
    expect(r.score).toBeLessThanOrEqual(1.0);
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/lib/duplicates/similarity.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `src/lib/duplicates/similarity.ts`**

```typescript
export interface ScorablePair {
  id: string;
  name: string;
  customerCode: string | null;
  hotelGroup: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface PairScore {
  score: number;
  reasons: Array<"name" | "code" | "geo" | "group">;
  nameSimilarity: number;
  distanceMeters: number | null;
}

const PUNCT_RE = /[^\p{L}\p{N}\s]/gu;
const CODE_SUFFIX_RE = /\s*\[[^\]]+\]\s*$/;
const WHITESPACE_RE = /\s+/g;

export function normalizeForMatch(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(CODE_SUFFIX_RE, "")
    .toLowerCase()
    .replace(PUNCT_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length < 2) {
    if (s.length === 1) out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

export function bigramJaccard(a: string, b: string): number {
  if (!a && !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return a === b ? 1 : 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const CODE_BOOST = 0.15;
const GEO_BOOST = 0.1;
const GROUP_BOOST = 0.05;
const GEO_RADIUS_M = 200;

export function scorePair(a: ScorablePair, b: ScorablePair): PairScore {
  const nameSim = bigramJaccard(
    normalizeForMatch(a.name),
    normalizeForMatch(b.name)
  );

  const reasons: PairScore["reasons"] = [];
  let score = nameSim;
  if (nameSim >= 0.5) reasons.push("name");

  if (
    a.customerCode &&
    b.customerCode &&
    a.customerCode.trim().toLowerCase() === b.customerCode.trim().toLowerCase()
  ) {
    score += CODE_BOOST;
    reasons.push("code");
  }

  let distanceMeters: number | null = null;
  if (
    a.latitude != null &&
    a.longitude != null &&
    b.latitude != null &&
    b.longitude != null
  ) {
    distanceMeters = haversineMeters(
      a.latitude,
      a.longitude,
      b.latitude,
      b.longitude
    );
    if (distanceMeters <= GEO_RADIUS_M) {
      score += GEO_BOOST;
      reasons.push("geo");
    }
  }

  if (
    a.hotelGroup &&
    b.hotelGroup &&
    a.hotelGroup.trim().toLowerCase() === b.hotelGroup.trim().toLowerCase()
  ) {
    score += GROUP_BOOST;
    reasons.push("group");
  }

  return { score: Math.min(1, score), reasons, nameSimilarity: nameSim, distanceMeters };
}
```

**Step 4: Run tests until they pass**

Run: `npx vitest run src/lib/duplicates/similarity.test.ts`
Expected: All pass. If "same-chain different-property" fails, tune the test threshold (it's a soft check; the goal is the slider, not a hard cutoff in the lib).

**Step 5: Commit**

```bash
git add src/lib/duplicates/
git commit -m "feat(duplicates): pure similarity scoring utilities"
```

---

## Task 3: Detection server action

**Why:** Wraps the pure scorer with DB I/O, dismissal filtering, and admin RBAC. Returns one payload that the client uses for all slider positions (no re-scan per drag).

**Files:**
- Create: `src/app/(app)/settings/duplicates/actions.ts`

**Step 1: Implement**

```typescript
"use server";

import { db } from "@/db";
import { locations, duplicateDismissals } from "@/db/schema";
import { isNull, and, eq, or } from "drizzle-orm";
import { requireRole, getSessionOrThrow } from "@/lib/rbac";
import { scorePair, type PairScore } from "@/lib/duplicates/similarity";

export interface DuplicateCandidate {
  a: { id: string; name: string; address: string | null; customerCode: string | null; hotelGroup: string | null };
  b: { id: string; name: string; address: string | null; customerCode: string | null; hotelGroup: string | null };
  score: number;
  reasons: PairScore["reasons"];
  distanceMeters: number | null;
}

const MIN_NAME_SIMILARITY = 0.4; // pre-filter to keep O(n²) tractable

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function scanDuplicateLocations(): Promise<
  { candidates: DuplicateCandidate[] } | { error: string }
> {
  try {
    await requireRole("admin");

    const rows = await db
      .select({
        id: locations.id,
        name: locations.name,
        address: locations.address,
        customerCode: locations.customerCode,
        hotelGroup: locations.hotelGroup,
        latitude: locations.latitude,
        longitude: locations.longitude,
      })
      .from(locations)
      .where(isNull(locations.archivedAt));

    const dismissed = await db
      .select({
        a: duplicateDismissals.locationAId,
        b: duplicateDismissals.locationBId,
      })
      .from(duplicateDismissals);

    const dismissedSet = new Set(dismissed.map((d) => `${d.a}|${d.b}`));

    const candidates: DuplicateCandidate[] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        const [pa, pb] = canonicalPair(a.id, b.id);
        if (dismissedSet.has(`${pa}|${pb}`)) continue;

        const score = scorePair(a, b);
        if (score.nameSimilarity < MIN_NAME_SIMILARITY) continue;

        candidates.push({
          a: {
            id: a.id,
            name: a.name,
            address: a.address,
            customerCode: a.customerCode,
            hotelGroup: a.hotelGroup,
          },
          b: {
            id: b.id,
            name: b.name,
            address: b.address,
            customerCode: b.customerCode,
            hotelGroup: b.hotelGroup,
          },
          score: score.score,
          reasons: score.reasons,
          distanceMeters: score.distanceMeters,
        });
      }
    }

    candidates.sort((x, y) => y.score - x.score);
    return { candidates };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to scan duplicates" };
  }
}

export async function dismissDuplicatePair(
  locationAId: string,
  locationBId: string
): Promise<{ success: true } | { error: string }> {
  try {
    await requireRole("admin");
    const session = await getSessionOrThrow();
    const [a, b] = canonicalPair(locationAId, locationBId);

    await db
      .insert(duplicateDismissals)
      .values({
        locationAId: a,
        locationBId: b,
        dismissedBy: session.user.id,
        dismissedByName: session.user.name,
      })
      .onConflictDoNothing();

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to dismiss pair" };
  }
}
```

Note: `or` and `eq` imports are intentional placeholders if needed later — remove if unused before committing (lint will flag).

**Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors. Fix any type mismatches before continuing.

**Step 3: Commit**

```bash
git add src/app/\(app\)/settings/duplicates/actions.ts
git commit -m "feat(duplicates): scan and dismiss server actions"
```

---

## Task 4: Add shadcn slider component

**Files:**
- Create: `src/components/ui/slider.tsx` (via shadcn CLI)

**Step 1: Add via CLI**

Run: `npx shadcn@latest add slider`
Expected: Creates `src/components/ui/slider.tsx`. Accept any prompt to install `@radix-ui/react-slider`.

**Step 2: Verify**

Run: `ls src/components/ui/slider.tsx`
Expected: File exists.

**Step 3: Commit**

```bash
git add src/components/ui/slider.tsx package.json package-lock.json
git commit -m "chore: add shadcn slider component"
```

---

## Task 5: Settings page route (server component)

**Files:**
- Create: `src/app/(app)/settings/duplicates/page.tsx`

**Step 1: Write**

```tsx
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/rbac";
import { DuplicatesClient } from "./duplicates-client";

export default async function DuplicatesPage() {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }

  return (
    <AppShell title="Duplicate Locations">
      <DuplicatesClient />
    </AppShell>
  );
}
```

**Step 2: Commit (after Task 6 — page won't compile without the client component)**

---

## Task 6: Client component — scan, slider, results, merge

**Files:**
- Create: `src/app/(app)/settings/duplicates/duplicates-client.tsx`

**Step 1: Write**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { MergeDialog } from "@/components/table/merge-dialog";
import { mergeLocationsAction } from "@/app/(app)/locations/merge-action";
import {
  scanDuplicateLocations,
  dismissDuplicatePair,
  type DuplicateCandidate,
} from "./actions";

const MERGE_FIELDS = [
  { key: "name", label: "Name" },
  { key: "address", label: "Address" },
  { key: "customerCode", label: "Customer Code" },
  { key: "hotelGroup", label: "Hotel Group" },
];

export function DuplicatesClient() {
  const router = useRouter();
  const [candidates, setCandidates] = React.useState<DuplicateCandidate[] | null>(null);
  const [threshold, setThreshold] = React.useState(0.75);
  const [isScanning, setIsScanning] = React.useState(false);
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [activePair, setActivePair] = React.useState<DuplicateCandidate | null>(null);
  const [dismissing, setDismissing] = React.useState<string | null>(null);

  async function handleScan() {
    setIsScanning(true);
    try {
      const result = await scanDuplicateLocations();
      if ("error" in result) {
        toast.error(result.error);
      } else {
        setCandidates(result.candidates);
        toast.success(`Found ${result.candidates.length} candidate pair(s)`);
      }
    } finally {
      setIsScanning(false);
    }
  }

  async function handleDismiss(pair: DuplicateCandidate) {
    const key = `${pair.a.id}|${pair.b.id}`;
    setDismissing(key);
    try {
      const result = await dismissDuplicatePair(pair.a.id, pair.b.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        setCandidates((prev) =>
          prev ? prev.filter((p) => `${p.a.id}|${p.b.id}` !== key) : prev
        );
        toast.success("Pair dismissed");
      }
    } finally {
      setDismissing(null);
    }
  }

  const visible = React.useMemo(
    () => (candidates ?? []).filter((c) => c.score >= threshold),
    [candidates, threshold]
  );

  const mergeRecords = activePair ? [activePair.a, activePair.b] : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end gap-4">
        <Button
          onClick={handleScan}
          disabled={isScanning}
          className="bg-wk-azure text-white hover:bg-wk-azure/90"
        >
          {isScanning ? (
            <Loader2 className="size-4 animate-spin mr-1.5" />
          ) : (
            <Search className="size-4 mr-1.5" />
          )}
          Scan for duplicates
        </Button>

        <div className="flex-1 max-w-md">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-wk-night-grey">
              Confidence threshold
            </label>
            <span className="text-xs font-mono text-wk-graphite">
              {threshold.toFixed(2)}
            </span>
          </div>
          <Slider
            value={[threshold]}
            onValueChange={(v) => setThreshold(v[0])}
            min={0.5}
            max={0.95}
            step={0.05}
          />
        </div>
      </div>

      {candidates === null ? (
        <p className="text-sm text-wk-night-grey">
          Press <strong>Scan</strong> to find candidate duplicate locations.
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-wk-night-grey">
          No pairs above the current threshold. Lower the slider to see weaker matches.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((pair) => {
            const key = `${pair.a.id}|${pair.b.id}`;
            return (
              <li
                key={key}
                className="flex items-center gap-3 rounded-lg border border-wk-mid-grey bg-white p-3"
              >
                <div className="flex-1 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="font-medium text-wk-graphite">{pair.a.name}</div>
                    {pair.a.address && (
                      <div className="text-xs text-wk-night-grey">{pair.a.address}</div>
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-wk-graphite">{pair.b.name}</div>
                    {pair.b.address && (
                      <div className="text-xs text-wk-night-grey">{pair.b.address}</div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5 min-w-[140px]">
                  <span className="text-xs font-mono text-wk-azure">
                    {(pair.score * 100).toFixed(0)}%
                  </span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {pair.reasons.map((r) => (
                      <span
                        key={r}
                        className="px-1.5 py-0.5 rounded bg-wk-sky-blue text-[10px] text-wk-azure"
                      >
                        {r === "geo" && pair.distanceMeters != null
                          ? `~${Math.round(pair.distanceMeters)}m`
                          : r}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setActivePair(pair);
                      setMergeOpen(true);
                    }}
                  >
                    Review
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDismiss(pair)}
                    disabled={dismissing === key}
                    aria-label="Dismiss pair"
                  >
                    {dismissing === key ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <X className="size-3.5" />
                    )}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        records={mergeRecords}
        fields={MERGE_FIELDS}
        getFieldValue={(r, k) => String((r as Record<string, unknown>)[k] ?? "")}
        getId={(r) => r.id}
        getName={(r) => r.name}
        onMerge={mergeLocationsAction}
        onSuccess={() => {
          // Drop merged pair from the list (target survives, source archived)
          if (activePair) {
            const key = `${activePair.a.id}|${activePair.b.id}`;
            setCandidates((prev) =>
              prev ? prev.filter((p) => `${p.a.id}|${p.b.id}` !== key) : prev
            );
          }
          setActivePair(null);
          router.refresh();
        }}
        entityLabel="location"
      />
    </div>
  );
}
```

**Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors.

**Step 3: Commit (page + client together)**

```bash
git add src/app/\(app\)/settings/duplicates/
git commit -m "feat(duplicates): /settings/duplicates page with slider and merge integration"
```

---

## Task 7: Add card to Settings index

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`

**Step 1: Add import**

In the existing `lucide-react` import line, add `Copy`:

```tsx
import { Users, GitBranch, ScrollText, Database, Copy } from "lucide-react";
```

**Step 2: Add card (admin-only)**

Insert a new `{isAdmin && (...)}` block after the existing Data Import card:

```tsx
{isAdmin && (
  <Link href="/settings/duplicates" className="group">
    <Card className="h-full cursor-pointer border-wk-mid-grey/40 transition-shadow group-hover:shadow-md">
      <CardHeader>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg bg-wk-sky-blue flex items-center justify-center">
            <Copy className="w-5 h-5 text-wk-azure" />
          </div>
          <CardTitle className="text-base font-medium">Duplicates</CardTitle>
        </div>
        <CardDescription className="text-sm text-wk-night-grey">
          Detect and merge duplicate hotel locations.
        </CardDescription>
      </CardHeader>
    </Card>
  </Link>
)}
```

**Step 3: Verify**

Run: `npm run dev` (in another terminal), open `http://localhost:3003/settings`, confirm the new card appears for an admin and links to `/settings/duplicates`.

**Step 4: Commit**

```bash
git add src/app/\(app\)/settings/page.tsx
git commit -m "feat(duplicates): link from settings index"
```

---

## Task 8: Playwright E2E

**Why:** Per project standard, every user-facing feature ships with a Playwright happy-path + edge-case test. Use the `playwright-cli` skill conventions.

**Files:**
- Create: `tests/duplicates/duplicates.spec.ts`
- (Optional) Test fixture in `tests/helpers/` if a duplicate-pair seeder doesn't already exist.

**Step 1: Inspect existing helpers**

Run: `ls tests/helpers/` and skim for an admin-login + location-seeding pattern. Reuse rather than reinventing.

**Step 2: Write happy path**

Outline (fill in concrete API calls based on existing helpers):

```typescript
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth"; // adjust to actual helper
import { seedLocation } from "../helpers/db";    // adjust to actual helper

test.describe("Duplicate locations — happy path", () => {
  test("admin scans, finds a near-duplicate pair, opens MergeDialog", async ({ page }) => {
    await seedLocation({ name: "Hilton London Kensington", customerCode: "WK-A" });
    await seedLocation({ name: "Hilton London  Kensington", customerCode: "WK-A" });

    await loginAsAdmin(page);
    await page.goto("/settings/duplicates");
    await page.getByRole("button", { name: /scan for duplicates/i }).click();

    await expect(page.getByText(/Hilton London Kensington/i).first()).toBeVisible();

    await page.getByRole("button", { name: /review/i }).first().click();
    await expect(page.getByText(/Merge 2 locations/i)).toBeVisible();
  });
});

test.describe("Duplicate locations — dismiss", () => {
  test("dismissed pair does not reappear after re-scan", async ({ page }) => {
    await seedLocation({ name: "Hilton London Paddington", customerCode: "WK-B" });
    await seedLocation({ name: "Hilton  London Paddington", customerCode: "WK-B" });

    await loginAsAdmin(page);
    await page.goto("/settings/duplicates");
    await page.getByRole("button", { name: /scan for duplicates/i }).click();

    const row = page.getByText(/Hilton London Paddington/i).first().locator("xpath=ancestor::li");
    await row.getByRole("button", { name: /dismiss pair/i }).click();
    await expect(page.getByText(/Pair dismissed/i)).toBeVisible();

    await page.getByRole("button", { name: /scan for duplicates/i }).click();
    await expect(page.getByText(/Hilton London Paddington/i)).toHaveCount(0);
  });
});
```

**Step 3: Run**

Run: `npx playwright test tests/duplicates/duplicates.spec.ts --reporter=line`
Expected: Both tests pass. If the seed helpers don't exist, factor them out from existing `tests/locations/` specs first — do not write tests against an empty DB and assume any pair will appear.

**Step 4: Commit**

```bash
git add tests/duplicates/
git commit -m "test(duplicates): happy path scan + dismiss persistence"
```

---

## Task 9: Manual smoke + final verification

**Step 1: Manual checklist**

In the browser as an admin:

1. `/settings` shows the **Duplicates** card.
2. `/settings/duplicates` loads; **Scan for duplicates** button is visible.
3. After scan: pairs render sorted by score; reason chips appear; geo chip shows distance when available.
4. Slider drag re-filters in-place without re-scanning (no spinner).
5. **Review** opens `MergeDialog` pre-populated with the two records; conflicts list correctly; merge succeeds; pair vanishes from list.
6. **Dismiss** removes the pair; second scan does NOT bring it back.
7. Non-admin user redirected from `/settings/duplicates` back to `/settings`.

**Step 2: Build check**

Run: `npm run build`
Expected: Build succeeds with no TypeScript or ESLint errors.

**Step 3: Final commit (only if there are residual changes)**

```bash
git status
# only if dirty:
git add -A && git commit -m "chore(duplicates): post-verification cleanup"
```

---

## Out of scope (intentional)

- Real-time duplicate scanning on insert/update (write-path cost; revisit if admin demand grows).
- Cross-table duplicate detection (kiosks, users) — `mergeKiosks` / `mergeUsers` exist but are not part of this scope.
- Persisted threshold preference per-admin — current slider is per-session only.
- Bulk dismiss / bulk merge across multiple pairs.
- Slider-driven re-scan on the server (we scan once and filter client-side, which is correct given a single in-memory pair list).
