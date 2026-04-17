# M6: Port Analytics Pages — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port all 7 analytics pages, 3 admin pages, export (CSV + branded Excel), weather overlays, impersonation, and full test coverage from data-dashboard into kiosk-tool — rewriting every Supabase call to Drizzle via `scopedSalesCondition()`.

**Architecture:** Server actions for page data fetching (matching kiosk-tool convention), API routes only for export streaming. Analytics pages live under `(app)/analytics/*` with a sub-layout providing a persistent filter bar. Zustand stores for filter/trend/pivot state. Recharts for visualization.

**Tech Stack:** Next.js 16 + React 19, Drizzle ORM + postgres-js, Recharts 3, ExcelJS, Zustand 5, @dnd-kit, shadcn/ui, TanStack Table, react-day-picker, date-fns

**Source repo:** `/Users/vedant/Work/WeKnowGroup/data-dashboard` — reference for UI layout, component structure, and query logic. All Supabase RPCs rewritten as Drizzle `sql` templates.

---

## Plan 1: Foundation — Types, Formatters, Metrics, Dependencies

### Task 1.1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install analytics dependencies**

```bash
npm install recharts exceljs date-fns
```

**Step 2: Verify installation**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(m6): add recharts, exceljs, date-fns dependencies"
```

---

### Task 1.2: Analytics Type Definitions

**Files:**
- Create: `src/lib/analytics/types.ts`

**Step 1: Create type definitions**

Port and adapt types from `data-dashboard/src/types/analytics.ts`. Key types needed:

```typescript
// src/lib/analytics/types.ts

// ─── Filter Types ─────────────────────────────────────────────────────────────

export type DatePreset =
  | "this-month" | "last-month" | "last-3-months"
  | "this-quarter" | "last-quarter" | "ytd" | "last-year"

export type FilterDimension =
  | "hotelIds" | "regionIds" | "productIds"
  | "hotelGroupIds" | "locationGroupIds" | "categoryIds"

export type AnalyticsFilters = {
  dateFrom: string       // YYYY-MM-DD
  dateTo: string         // YYYY-MM-DD
  hotelIds?: string[]    // location IDs
  regionIds?: string[]
  productIds?: string[]
  hotelGroupIds?: string[]
  locationGroupIds?: string[]
  categoryIds?: string[] // product category names
}

// ─── Portfolio Types ──────────────────────────────────────────────────────────

export type PortfolioSummary = {
  totalRevenue: number
  totalTransactions: number
  totalQuantity: number
  avgBasketValue: number
  uniqueProducts: number
  uniqueOutlets: number
}

export type CategoryPerformanceRow = {
  categoryName: string
  revenue: number
  transactions: number
  quantity: number
  avgValue: number
}

export type TopProductRow = {
  rank: number
  productName: string
  categoryName: string
  revenue: number
  transactions: number
  quantity: number
}

export type DailyTrendRow = {
  date: string           // YYYY-MM-DD
  revenue: number
  transactions: number
}

export type HourlyDistributionRow = {
  hour: number           // 0-23
  revenue: number
  transactions: number
}

export type OutletTierRow = {
  outletCode: string
  hotelName: string
  revenue: number
  transactions: number
  percentile: number
  sharePercentage: number
  tier: OutletTier
}

export type OutletTier = "Premium" | "Standard" | "Developing" | "Emerging"

export type PortfolioData = {
  summary: PortfolioSummary
  previousSummary: PortfolioSummary | null
  categoryPerformance: CategoryPerformanceRow[]
  topProducts: TopProductRow[]
  dailyTrends: DailyTrendRow[]
  hourlyDistribution: HourlyDistributionRow[]
  outletTiers: OutletTierRow[]
}

// ─── Heat Map Types ───────────────────────────────────────────────────────────

export type HeatMapHotel = {
  rank: number
  locationId: string
  outletCode: string
  hotelName: string
  revenue: number
  transactions: number
  revenuePerRoom: number | null
  txnPerKiosk: number | null
  avgBasketValue: number
  compositeScore: number
}

export type HeatMapData = {
  topPerformers: HeatMapHotel[]
  bottomPerformers: HeatMapHotel[]
  allPerformers: HeatMapHotel[]
  scoreWeights: ScoreWeights
}

export type ScoreWeights = {
  revenue: number        // 0.30
  transactions: number   // 0.20
  revenuePerRoom: number // 0.25
  txnPerKiosk: number    // 0.15
  basketValue: number    // 0.10
}

// ─── Trend Builder Types ──────────────────────────────────────────────────────

export type TrendMetric = "revenue" | "transactions" | "avg_basket_value" | "booking_fee"

export type SeriesFilters = {
  productIds?: string[]
  locationIds?: string[]
  hotelGroupIds?: string[]
  regionIds?: string[]
  locationGroupIds?: string[]
  categoryIds?: string[]
}

export type SeriesConfig = {
  id: string
  metric: TrendMetric
  filters: SeriesFilters
  color: string
  label: string
  labelEdited?: boolean
  hidden: boolean
}

export type TrendDataPoint = {
  date: string           // YYYY-MM-DD
  value: number
}

export type TrendGranularity = "auto" | "daily" | "weekly" | "monthly"

// ─── Pivot Types ──────────────────────────────────────────────────────────────

export type PivotAggregation = "sum" | "avg" | "count" | "min" | "max"

export type PivotValueConfig = {
  field: string
  aggregation: PivotAggregation
}

export type PivotConfig = {
  rowFields: string[]
  columnFields: string[]
  values: PivotValueConfig[]
  periodComparison?: "mom" | "yoy" | null
}

export type PivotCell = {
  value: number
  formatted: string
}

export type PivotRow = {
  dimensions: Record<string, string>
  cells: Record<string, PivotCell>
}

export type PivotResponse = {
  headers: string[]
  rows: PivotRow[]
  grandTotals: Record<string, PivotCell>
  rowCount: number
  truncated: boolean
}

// ─── Dimension Page Types ─────────────────────────────────────────────────────

export type HotelGroupData = {
  id: string
  name: string
  revenue: number
  transactions: number
  hotelCount: number
  revenueChange: number | null
  transactionChange: number | null
}

export type HotelGroupDetail = {
  metrics: { revenue: number; transactions: number; hotelCount: number; avgRevenuePerHotel: number }
  hotels: HotelInGroup[]
  trends: DailyTrendRow[]
  previousMetrics: { revenue: number; transactions: number } | null
}

export type HotelInGroup = {
  locationId: string
  outletCode: string
  hotelName: string
  revenue: number
  transactions: number
  quantity: number
  rooms: number | null
  kiosks: number | null
  starRating: number | null
  revenuePerRoom: number | null
}

export type RegionData = {
  id: string
  name: string
  revenue: number
  transactions: number
  hotelGroupCount: number
  locationGroupCount: number
}

export type RegionDetail = {
  metrics: { revenue: number; transactions: number; hotelGroupCount: number; locationGroupCount: number }
  hotelGroupBreakdown: { name: string; revenue: number; transactions: number; hotelCount: number; avgRevenuePerHotel: number }[]
  locationGroupBreakdown: { name: string; revenue: number; transactions: number; outletCount: number; totalRooms: number | null }[]
  previousMetrics: { revenue: number; transactions: number } | null
}

export type LocationGroupData = {
  id: string
  name: string
  revenue: number
  transactions: number
  hotelCount: number
  totalRooms: number | null
  revenuePerRoom: number | null
  txnPerKiosk: number | null
  avgBasketValue: number
}

export type LocationGroupDetail = {
  metrics: { revenue: number; transactions: number; hotelCount: number; totalRooms: number | null }
  capacityMetrics: { revenuePerRoom: number | null; txnPerRoom: number | null; txnPerKiosk: number | null; avgBasketValue: number; totalRooms: number | null; totalKiosks: number | null }
  peerAnalysis: { metric: string; value: number; percentile: number }[]
  hotelBreakdown: HotelInGroup[]
  previousMetrics: { revenue: number; transactions: number } | null
}

// ─── Weather Types ────────────────────────────────────────────────────────────

export type DailyWeather = {
  date: string
  temperatureMax: number
  temperatureMin: number
  precipitation: number
}

// ─── Business Event Types ─────────────────────────────────────────────────────

export type BusinessEventDisplay = {
  id: string
  title: string
  description: string | null
  startDate: string
  endDate: string | null
  categoryId: string
  categoryName: string
  categoryColor: string
  scopeType: "global" | "hotel" | "region" | "hotel_group"
  scopeValue: string | null
}

// ─── Dimension Option Types (for filter dropdowns) ────────────────────────────

export type DimensionOptions = {
  locations: { id: string; name: string; outletCode: string }[]
  products: { id: string; name: string; category: string | null }[]
  hotelGroups: { id: string; name: string }[]
  regions: { id: string; name: string }[]
  locationGroups: { id: string; name: string }[]
  categories: string[]
}

// ─── Change Indicator ─────────────────────────────────────────────────────────

export type ChangeDirection = "up" | "down" | "neutral"

export type ChangeIndicator = {
  text: string
  color: string
  direction: ChangeDirection
}
```

**Step 2: Commit**

```bash
git add src/lib/analytics/types.ts
git commit -m "feat(m6): analytics type definitions"
```

---

### Task 1.3: Formatters Module

**Files:**
- Create: `src/lib/analytics/formatters.ts`
- Create: `src/lib/analytics/formatters.test.ts`

**Step 1: Write failing tests**

Port formatters from `data-dashboard/src/lib/analytics/formatters.ts`. Test key behaviors:

```typescript
// src/lib/analytics/formatters.test.ts
import { describe, it, expect } from "vitest";
import {
  formatCurrency, formatNumber, formatCompactNumber,
  formatPercentChange, formatChangeIndicator,
  toLocalISODate, formatDate, autoGranularity,
  dateToBucket, formatNullValue,
} from "./formatters";

describe("formatCurrency", () => {
  it("formats GBP with 2 decimal places", () => {
    expect(formatCurrency(12345.67)).toBe("£12,345.67");
  });
  it("handles zero", () => {
    expect(formatCurrency(0)).toBe("£0.00");
  });
  it("handles negative", () => {
    expect(formatCurrency(-500)).toBe("-£500.00");
  });
});

describe("formatNumber", () => {
  it("formats integers without decimals", () => {
    expect(formatNumber(12345)).toBe("12,345");
  });
  it("formats with specified decimals", () => {
    expect(formatNumber(12345.678, 2)).toBe("12,345.68");
  });
});

describe("formatCompactNumber", () => {
  it("formats thousands as k", () => {
    expect(formatCompactNumber(1200)).toBe("1.2k");
  });
  it("formats millions as M", () => {
    expect(formatCompactNumber(45300000)).toBe("45.3M");
  });
  it("formats billions as B", () => {
    expect(formatCompactNumber(1200000000)).toBe("1.2B");
  });
  it("returns raw number below 1000", () => {
    expect(formatCompactNumber(999)).toBe("999");
  });
});

describe("formatPercentChange", () => {
  it("positive change has + prefix", () => {
    expect(formatPercentChange(12000, 10000)).toBe("+20.0%");
  });
  it("negative change has - prefix", () => {
    expect(formatPercentChange(9500, 10000)).toBe("-5.0%");
  });
  it("zero to zero is +0.0%", () => {
    expect(formatPercentChange(0, 0)).toBe("+0.0%");
  });
  it("from zero is +100.0%", () => {
    expect(formatPercentChange(100, 0)).toBe("+100.0%");
  });
});

describe("formatChangeIndicator", () => {
  it("null returns neutral dash", () => {
    const result = formatChangeIndicator(null);
    expect(result.direction).toBe("neutral");
  });
  it("positive >= 0.1 returns up", () => {
    const result = formatChangeIndicator(5.3);
    expect(result.direction).toBe("up");
    expect(result.color).toBe("#166534");
  });
  it("negative <= -0.1 returns down", () => {
    const result = formatChangeIndicator(-3.2);
    expect(result.direction).toBe("down");
    expect(result.color).toBe("#991B1B");
  });
  it("tiny change returns neutral", () => {
    const result = formatChangeIndicator(0.05);
    expect(result.direction).toBe("neutral");
  });
});

describe("toLocalISODate", () => {
  it("formats date as YYYY-MM-DD local", () => {
    const d = new Date(2025, 5, 15); // June 15
    expect(toLocalISODate(d)).toBe("2025-06-15");
  });
});

describe("autoGranularity", () => {
  it("≤31 days → daily", () => {
    const from = new Date("2025-06-01");
    const to = new Date("2025-06-30");
    expect(autoGranularity(from, to)).toBe("daily");
  });
  it("≤90 days → weekly", () => {
    const from = new Date("2025-04-01");
    const to = new Date("2025-06-15");
    expect(autoGranularity(from, to)).toBe("weekly");
  });
  it(">90 days → monthly", () => {
    const from = new Date("2025-01-01");
    const to = new Date("2025-12-31");
    expect(autoGranularity(from, to)).toBe("monthly");
  });
});

describe("formatNullValue", () => {
  it("null returns em dash", () => {
    expect(formatNullValue(null)).toBe("\u2014");
  });
  it("value passes through formatter", () => {
    expect(formatNullValue(100, (v) => `${v}%`)).toBe("100%");
  });
});
```

**Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/lib/analytics/formatters.test.ts
```

**Step 3: Implement formatters**

Port from `data-dashboard/src/lib/analytics/formatters.ts` — the full module with: `formatCurrency`, `formatNumber`, `formatCompactNumber`, `formatPercentChange`, `formatChangeIndicator`, `toLocalISODate`, `formatDate`, `formatNullValue`, `autoGranularity`, `dateToBucket`, `getISOWeekMonday`, `getMonthBucket`.

All formatters use en-GB locale and GBP currency. The `NEUTRAL_THRESHOLD` is 0.1 percentage points.

**Step 4: Run tests — expect PASS**

```bash
npx vitest run src/lib/analytics/formatters.test.ts
```

**Step 5: Commit**

```bash
git add src/lib/analytics/formatters.ts src/lib/analytics/formatters.test.ts
git commit -m "feat(m6): analytics formatters (GBP, en-GB locale)"
```

---

### Task 1.4: Metrics Module

**Files:**
- Create: `src/lib/analytics/metrics.ts`
- Create: `src/lib/analytics/metrics.test.ts`

**Step 1: Write failing tests**

Port from `data-dashboard/src/lib/analytics/metrics.ts`. Test all pure calculation functions:

```typescript
// src/lib/analytics/metrics.test.ts
import { describe, it, expect } from "vitest";
import {
  calculatePeriodChange, getPreviousPeriodDates,
  calculateCompositeScore, calculateRevenuePerRoom,
  calculateTxnPerKiosk, calculateAvgBasketValue,
  classifyOutletTier, calculatePercentile,
} from "./metrics";

describe("calculatePeriodChange", () => {
  it("calculates percentage change", () => {
    expect(calculatePeriodChange(12000, 10000)).toBeCloseTo(20.0);
  });
  it("returns null when previous is zero", () => {
    expect(calculatePeriodChange(100, 0)).toBeNull();
  });
  it("handles negative change", () => {
    expect(calculatePeriodChange(8000, 10000)).toBeCloseTo(-20.0);
  });
});

describe("getPreviousPeriodDates", () => {
  it("calculates same-duration previous period", () => {
    const { prevFrom, prevTo } = getPreviousPeriodDates("2025-02-01", "2025-02-28");
    expect(prevTo).toBe("2025-01-31");
    // 28 days back from Jan 31
    expect(prevFrom).toBe("2025-01-04");
  });
});

describe("calculateCompositeScore", () => {
  it("computes weighted score", () => {
    const score = calculateCompositeScore([
      { value: 100, weight: 0.5 },
      { value: 50, weight: 0.5 },
    ]);
    expect(score).toBeCloseTo(75);
  });
  it("redistributes weight when value is null", () => {
    const score = calculateCompositeScore([
      { value: 80, weight: 0.5 },
      { value: null, weight: 0.3 },
      { value: 60, weight: 0.2 },
    ]);
    // 80*(0.5/0.7) + 60*(0.2/0.7) ≈ 74.29
    expect(score).toBeCloseTo(74.29, 1);
  });
  it("returns 0 when all values null", () => {
    expect(calculateCompositeScore([{ value: null, weight: 1 }])).toBe(0);
  });
});

describe("classifyOutletTier", () => {
  it("≥80 → Premium", () => expect(classifyOutletTier(85)).toBe("Premium"));
  it("≥50 → Standard", () => expect(classifyOutletTier(60)).toBe("Standard"));
  it("≥20 → Developing", () => expect(classifyOutletTier(30)).toBe("Developing"));
  it("<20 → Emerging", () => expect(classifyOutletTier(10)).toBe("Emerging"));
});

describe("calculatePercentile", () => {
  it("returns 0 for empty array", () => {
    expect(calculatePercentile(50, [])).toBe(0);
  });
  it("calculates rank correctly", () => {
    const all = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(calculatePercentile(50, all)).toBe(50); // 5 of 10
  });
});

describe("capacity metrics", () => {
  it("revenue per room", () => {
    expect(calculateRevenuePerRoom(10000, 50)).toBe(200);
  });
  it("revenue per room with null rooms", () => {
    expect(calculateRevenuePerRoom(10000, null)).toBeNull();
  });
  it("txn per kiosk", () => {
    expect(calculateTxnPerKiosk(500, 5)).toBe(100);
  });
  it("avg basket value", () => {
    expect(calculateAvgBasketValue(10000, 200)).toBe(50);
  });
  it("avg basket value with zero txns", () => {
    expect(calculateAvgBasketValue(10000, 0)).toBeNull();
  });
});
```

**Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/lib/analytics/metrics.test.ts
```

**Step 3: Implement metrics**

Port all functions from `data-dashboard/src/lib/analytics/metrics.ts`: `calculatePeriodChange`, `getPreviousPeriodDates`, `calculateCompositeScore`, `calculateRevenuePerRoom`, `calculateTxnPerKiosk`, `calculateAvgBasketValue`, `classifyOutletTier`, `calculatePercentile`.

Use `toLocalISODate` from the formatters module for date formatting.

**Step 4: Run tests — expect PASS**

```bash
npx vitest run src/lib/analytics/metrics.test.ts
```

**Step 5: Commit**

```bash
git add src/lib/analytics/metrics.ts src/lib/analytics/metrics.test.ts
git commit -m "feat(m6): analytics metrics (composite score, period change, capacity)"
```

---

## Plan 2: Filter Infrastructure — Store, URL Sync, Filter Bar, Sub-Layout

### Task 2.1: Analytics Filter Store (Zustand)

**Files:**
- Create: `src/lib/stores/analytics-filter-store.ts`

Port and adapt from `data-dashboard/src/lib/stores/filter-store.ts`. Three stores:

1. **`useAnalyticsFilterStore`** — full filter state (date range + 6 dimensions) for all analytics pages except pivot/trend
2. **`usePivotFilterStore`** — independent copy for pivot builder
3. **`useTrendFilterStore`** — date range only (each trend series captures its own filters)

Include:
- `getPresetRange(preset: DatePreset)` — computes date range from preset name
- `filtersToSearchParams(state)` — serializes to URL params: `from`, `to`, `hotels`, `regions`, `products`, `hgroups`, `lgroups`, `cats`
- `searchParamsToFilters(params)` — deserializes from URL params
- Default date range: current month

**Commit:**

```bash
git add src/lib/stores/analytics-filter-store.ts
git commit -m "feat(m6): analytics filter store (Zustand) with URL sync"
```

---

### Task 2.2: Dimension Options Loader

**Files:**
- Create: `src/app/(app)/analytics/actions.ts`

Server actions for loading filter dimension options (respecting user scopes):

```typescript
"use server";

import { db } from "@/db";
import { locations, products, hotelGroups, regions, locationGroups,
  locationHotelGroupMemberships, locationRegionMemberships,
  locationGroupMemberships, salesRecords } from "@/db/schema";
import { sql, eq, inArray, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { DimensionOptions, AnalyticsFilters } from "@/lib/analytics/types";

export async function getDimensionOptions(): Promise<DimensionOptions> {
  // Fetch all dimensions — scoping is applied at query time, not at option loading
  // (scoped users see all options but query results are filtered)
  const [locs, prods, hGroups, regs, lGroups] = await Promise.all([
    db.select({ id: locations.id, name: locations.name, outletCode: locations.outletCode })
      .from(locations).where(isNull(locations.archivedAt)),
    db.select({ id: products.id, name: products.name, category: products.category })
      .from(products).where(isNull(products.archivedAt)),
    db.select({ id: hotelGroups.id, name: hotelGroups.name }).from(hotelGroups),
    db.select({ id: regions.id, name: regions.name }).from(regions),
    db.select({ id: locationGroups.id, name: locationGroups.name }).from(locationGroups),
  ]);

  // Extract unique categories from products
  const categories = [...new Set(prods.map(p => p.category).filter(Boolean))] as string[];

  return {
    locations: locs.map(l => ({ id: l.id, name: l.name ?? l.outletCode ?? l.id, outletCode: l.outletCode ?? "" })),
    products: prods.map(p => ({ id: p.id, name: p.name, category: p.category })),
    hotelGroups: hGroups.map(g => ({ id: g.id, name: g.name })),
    regions: regs.map(r => ({ id: r.id, name: r.name })),
    locationGroups: lGroups.map(g => ({ id: g.id, name: g.name })),
    categories,
  };
}
```

**Commit:**

```bash
git add src/app/(app)/analytics/actions.ts
git commit -m "feat(m6): dimension options loader server action"
```

---

### Task 2.3: Multi-Select Filter Component

**Files:**
- Create: `src/components/analytics/multi-select-filter.tsx`

Key UX requirement: "Select All" selects only the **visible/filtered** subset, not all options.

Reference: `data-dashboard/src/components/dashboard/filter-bar.tsx` (the dimension pill pattern). Build as a standalone component using shadcn Popover + Command.

Props:
```typescript
interface MultiSelectFilterProps {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (values: string[]) => void
  placeholder?: string
}
```

Behavior:
- Searchable input filters options list
- Checkbox per option
- "Select All" button selects only currently visible (search-filtered) options
- "Clear" button deselects all
- Badge count shows `N selected`

**Commit:**

```bash
git add src/components/analytics/multi-select-filter.tsx
git commit -m "feat(m6): multi-select filter component (select-all = visible subset)"
```

---

### Task 2.4: Date Range Picker Component

**Files:**
- Create: `src/components/analytics/date-range-picker.tsx`

Uses `react-day-picker` (already in deps via shadcn calendar). Includes preset buttons (This Month, Last Month, Last 3 Months, This Quarter, Last Quarter, YTD, Last Year).

Reference: `data-dashboard/src/components/dashboard/filter-bar.tsx` date picker section.

**Commit:**

```bash
git add src/components/analytics/date-range-picker.tsx
git commit -m "feat(m6): date range picker with presets"
```

---

### Task 2.5: Shared Analytics Components

**Files:**
- Create: `src/components/analytics/kpi-card.tsx`
- Create: `src/components/analytics/section-accordion.tsx`
- Create: `src/components/analytics/chart-wrapper.tsx`
- Create: `src/components/analytics/empty-state.tsx`
- Create: `src/components/analytics/export-button.tsx`

Port from data-dashboard:
- **KPI Card**: `data-dashboard/src/components/dashboard/kpi-card.tsx` — metric value + change indicator (TrendingUp/Down/Minus icons, green/red/gray)
- **Section Accordion**: `data-dashboard/src/components/dashboard/section-accordion.tsx` — collapsible sections with chevron animation
- **Chart Wrapper**: Responsive container + loading skeleton for Recharts charts
- **Empty State**: "No data for selected filters" with icon
- **Export Button**: Dropdown with CSV / Excel options, triggers download

**Commit:**

```bash
git add src/components/analytics/
git commit -m "feat(m6): shared analytics components (KPI card, accordion, chart wrapper, export)"
```

---

### Task 2.6: Analytics Filter Bar

**Files:**
- Create: `src/components/analytics/filter-bar.tsx`

Composes DateRangePicker + MultiSelectFilter components. Reads from analytics filter store, writes to URL search params on "Apply". Loads dimension options via `getDimensionOptions()` on mount.

6 dimension filters: Locations, Products, Hotel Groups, Regions, Location Groups, Categories.

**Commit:**

```bash
git add src/components/analytics/filter-bar.tsx
git commit -m "feat(m6): analytics filter bar with URL sync"
```

---

### Task 2.7: Analytics Sub-Layout

**Files:**
- Create: `src/app/(app)/analytics/layout.tsx`

Server component that wraps all analytics pages. Provides:
- FilterBar (client component, loaded once)
- Impersonation banner (when active — implement placeholder, wire in Task 10.1)
- Children slot for page content

```typescript
// src/app/(app)/analytics/layout.tsx
import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <AnalyticsFilterBar />
      {children}
    </div>
  );
}
```

**Commit:**

```bash
git add src/app/(app)/analytics/layout.tsx
git commit -m "feat(m6): analytics sub-layout with persistent filter bar"
```

---

### Task 2.8: Sidebar Navigation Update

**Files:**
- Modify: `src/components/layout/app-sidebar.tsx`

Add "Analytics" section between Operations and Settings. 7 links:
- Portfolio → `/analytics/portfolio`
- Pivot Table → `/analytics/pivot-table`
- Heat Map → `/analytics/heat-map`
- Trend Builder → `/analytics/trend-builder`
- Hotel Groups → `/analytics/hotel-groups`
- Regions → `/analytics/regions`
- Location Groups → `/analytics/location-groups`

Add 3 settings links (admin only):
- Analytics Presets → `/settings/analytics-presets`
- Outlet Exclusions → `/settings/outlet-exclusions`
- Business Events → `/settings/business-events`

Use icons from lucide-react: `BarChart3`, `Table2`, `Grid3X3`, `TrendingUp`, `Building2`, `Globe`, `MapPin`, `Filter`, `Ban`, `CalendarRange`.

Add a `SidebarGroupLabel` for "Operations" above existing items and "Analytics" above new items. Settings admin items need role check — pass user role as prop.

**Commit:**

```bash
git add src/components/layout/app-sidebar.tsx
git commit -m "feat(m6): sidebar analytics + admin sections"
```

---

## Plan 3: Query Layer — Shared Helpers, Portfolio, Heat Map

### Task 3.1: Shared Query Helpers

**Files:**
- Create: `src/lib/analytics/queries/shared.ts`

Build the common query infrastructure:

```typescript
// src/lib/analytics/queries/shared.ts
import { db } from "@/db";
import { outletExclusions, locations, salesRecords } from "@/db/schema";
import { sql, eq, like, SQL, and, or, inArray, between } from "drizzle-orm";
import type { AnalyticsFilters } from "@/lib/analytics/types";

/**
 * Build a WHERE clause that excludes outlets matching outletExclusion patterns.
 * Reads exclusion rules from DB, returns SQL condition or undefined.
 */
export async function buildExclusionCondition(): Promise<SQL | undefined> {
  const exclusions = await db.select().from(outletExclusions);
  if (exclusions.length === 0) return undefined;

  const conditions: SQL[] = [];
  for (const ex of exclusions) {
    if (ex.patternType === "exact") {
      conditions.push(sql`${locations.outletCode} = ${ex.pattern}`);
    } else if (ex.patternType === "regex") {
      conditions.push(sql`${locations.outletCode} ~ ${ex.pattern}`);
    }
  }

  if (conditions.length === 0) return undefined;
  // Exclude matching outlets: NOT (match1 OR match2 OR ...)
  return sql`NOT (${sql.join(conditions, sql` OR `)})`;
}

/**
 * Build dimension filter conditions from AnalyticsFilters.
 * Returns SQL conditions array for locationId, productId, etc.
 */
export function buildDimensionFilters(filters: AnalyticsFilters): SQL[] {
  const conditions: SQL[] = [];

  // Date range is always applied
  conditions.push(
    sql`${salesRecords.transactionDate} BETWEEN ${filters.dateFrom} AND ${filters.dateTo}`
  );

  if (filters.productIds?.length) {
    conditions.push(inArray(salesRecords.productId, filters.productIds));
  }
  if (filters.hotelIds?.length) {
    conditions.push(inArray(salesRecords.locationId, filters.hotelIds));
  }
  // hotelGroupIds, regionIds, locationGroupIds → subqueries via membership tables
  // (implemented in individual query functions where JOIN context is available)

  return conditions;
}
```

**Commit:**

```bash
git add src/lib/analytics/queries/shared.ts
git commit -m "feat(m6): shared query helpers (exclusion builder, dimension filters)"
```

---

### Task 3.2: Portfolio Queries

**Files:**
- Create: `src/lib/analytics/queries/portfolio.ts`

Rewrite all 6 Supabase RPCs as Drizzle `sql` template queries. Each function:
1. Takes `AnalyticsFilters` + `UserCtx` (from session)
2. Calls `scopedSalesCondition()` for user scope
3. Calls `buildExclusionCondition()` for outlet exclusions
4. Executes parameterized SQL aggregation
5. Returns typed result

Functions to implement:
- `getPortfolioSummary(filters, userCtx)` → `PortfolioSummary`
- `getCategoryPerformance(filters, userCtx)` → `CategoryPerformanceRow[]`
- `getTopProducts(filters, userCtx, limit=20)` → `TopProductRow[]`
- `getDailyTrends(filters, userCtx)` → `DailyTrendRow[]`
- `getHourlyDistribution(filters, userCtx)` → `HourlyDistributionRow[]`
- `getOutletTiers(filters, userCtx)` → `OutletTierRow[]`
- `getPortfolioData(filters, userCtx)` → `PortfolioData` (orchestrates all above in parallel + previous period)

Reference the RPC signatures from the data-dashboard exploration. Join `salesRecords` with `locations` and `products` tables. Group/aggregate in SQL.

**Commit:**

```bash
git add src/lib/analytics/queries/portfolio.ts
git commit -m "feat(m6): portfolio query functions (Drizzle sql templates)"
```

---

### Task 3.3: Portfolio Integration Tests

**Files:**
- Create: `tests/db/analytics-portfolio.integration.test.ts`

Test against real Postgres with seeded data. Verify:
- Summary aggregations are correct
- Category breakdown sums match summary total
- Top products sorted by revenue descending
- Daily trends cover the full date range
- Hourly distribution covers hours 0-23
- Outlet tiers have correct percentile rankings
- Scoping: user with location scope sees only their hotels
- Exclusions: excluded outlet codes don't appear in results

Use the existing integration test pattern (see `tests/db/dimension-resolver.integration.test.ts`).

**Commit:**

```bash
git add tests/db/analytics-portfolio.integration.test.ts
git commit -m "test(m6): portfolio query integration tests"
```

---

### Task 3.4: Portfolio Page + Components

**Files:**
- Create: `src/app/(app)/analytics/portfolio/page.tsx`
- Create: `src/app/(app)/analytics/portfolio/actions.ts`
- Create: `src/app/(app)/analytics/portfolio/analytics-summary.tsx`
- Create: `src/app/(app)/analytics/portfolio/category-performance.tsx`
- Create: `src/app/(app)/analytics/portfolio/top-products.tsx`
- Create: `src/app/(app)/analytics/portfolio/daily-trends.tsx`
- Create: `src/app/(app)/analytics/portfolio/hourly-distribution.tsx`
- Create: `src/app/(app)/analytics/portfolio/outlet-tiers.tsx`

**Server action** (`actions.ts`): Calls `getPortfolioData()` with filters parsed from search params + session user context.

**Page** (`page.tsx`): Server component that reads search params, calls action, renders 6 SectionAccordion sections.

**Components**: Port from `data-dashboard/src/components/tabs/portfolio/`. Adapt:
- Replace Supabase data shapes with our Drizzle return types
- Use Recharts (same library, same API)
- Use our KpiCard, SectionAccordion, ChartWrapper components
- Use our formatters module

Reference files:
- `data-dashboard/src/components/tabs/portfolio/analytics-summary.tsx`
- `data-dashboard/src/components/tabs/portfolio/category-performance.tsx`
- `data-dashboard/src/components/tabs/portfolio/top-products.tsx`
- `data-dashboard/src/components/tabs/portfolio/daily-trends.tsx`
- `data-dashboard/src/components/tabs/portfolio/hourly-distribution.tsx`
- `data-dashboard/src/components/tabs/portfolio/outlet-tiers.tsx`

Chart colors: Azure (#00A6D3) for primary series, Graphite (#121212) for secondary.

**Commit:**

```bash
git add src/app/(app)/analytics/portfolio/
git commit -m "feat(m6): portfolio analytics page with 6 sections"
```

---

### Task 3.5: Heat Map Queries

**Files:**
- Create: `src/lib/analytics/queries/heat-map.ts`

Rewrite `data-dashboard/src/app/api/analytics/heat-map/route.ts` logic as Drizzle queries:

1. Aggregate sales by outlet (revenue, transactions, quantity)
2. Join with locations for rooms, kiosks metadata
3. Calculate capacity metrics: revenuePerRoom, txnPerKiosk, avgBasketValue
4. Min-max normalize each metric to 0-100
5. Calculate composite score with weights: revenue 30%, transactions 20%, rev/room 25%, txn/kiosk 15%, basket 10%
6. Sort by score, split into top 20 / bottom 20 / all

Function: `getHeatMapData(filters, userCtx)` → `HeatMapData`

**Commit:**

```bash
git add src/lib/analytics/queries/heat-map.ts
git commit -m "feat(m6): heat map query with composite scoring"
```

---

### Task 3.6: Heat Map Page + Components

**Files:**
- Create: `src/app/(app)/analytics/heat-map/page.tsx`
- Create: `src/app/(app)/analytics/heat-map/actions.ts`
- Create: `src/app/(app)/analytics/heat-map/score-legend.tsx`
- Create: `src/app/(app)/analytics/heat-map/performance-table.tsx`

Port from data-dashboard. Performance table has:
- Color-coded cells (green ≥70%, amber ≥40%, red <40% of column max)
- Sticky hotel name column for horizontal scroll
- Columns: Rank, Hotel, Revenue, Transactions, Rev/Room, Txn/Kiosk, Score

Reference: `data-dashboard/src/components/tabs/heat-map/`

**Commit:**

```bash
git add src/app/(app)/analytics/heat-map/
git commit -m "feat(m6): heat map page with composite score legend + performance table"
```

---

## Plan 4: Dimension Pages — Hotel Groups, Regions, Location Groups

### Task 4.1: Hotel Groups Queries + Page

**Files:**
- Create: `src/lib/analytics/queries/hotel-groups.ts`
- Create: `src/app/(app)/analytics/hotel-groups/page.tsx`
- Create: `src/app/(app)/analytics/hotel-groups/actions.ts`
- Create: `src/app/(app)/analytics/hotel-groups/group-selector.tsx`
- Create: `src/app/(app)/analytics/hotel-groups/group-metrics.tsx`
- Create: `src/app/(app)/analytics/hotel-groups/hotel-list.tsx`
- Create: `src/app/(app)/analytics/hotel-groups/temporal-charts.tsx`

Query functions:
- `getHotelGroupsList(filters, userCtx)` → `HotelGroupData[]` — all groups with aggregated metrics
- `getHotelGroupDetail(groupIds, filters, userCtx)` → `HotelGroupDetail` — KPIs, hotel breakdown, daily trends

Join `salesRecords` → `locations` → `locationHotelGroupMemberships` → `hotelGroups`. Group by hotel group, aggregate sales.

Reference: `data-dashboard/src/app/api/analytics/hotel-groups/route.ts` and `data-dashboard/src/components/tabs/hotel-groups/`

**Commit:**

```bash
git add src/lib/analytics/queries/hotel-groups.ts src/app/(app)/analytics/hotel-groups/
git commit -m "feat(m6): hotel groups analytics page"
```

---

### Task 4.2: Regions Queries + Page

**Files:**
- Create: `src/lib/analytics/queries/regions.ts`
- Create: `src/app/(app)/analytics/regions/page.tsx`
- Create: `src/app/(app)/analytics/regions/actions.ts`
- Create: `src/app/(app)/analytics/regions/region-selector.tsx`
- Create: `src/app/(app)/analytics/regions/region-metrics.tsx`
- Create: `src/app/(app)/analytics/regions/hotel-group-breakdown.tsx`
- Create: `src/app/(app)/analytics/regions/location-group-breakdown.tsx`

Query functions:
- `getRegionsList(filters, userCtx)` → `RegionData[]`
- `getRegionDetail(regionIds, filters, userCtx)` → `RegionDetail`

Reference: `data-dashboard/src/app/api/analytics/regions/route.ts` and components.

**Commit:**

```bash
git add src/lib/analytics/queries/regions.ts src/app/(app)/analytics/regions/
git commit -m "feat(m6): regions analytics page"
```

---

### Task 4.3: Location Groups Queries + Page

**Files:**
- Create: `src/lib/analytics/queries/location-groups.ts`
- Create: `src/app/(app)/analytics/location-groups/page.tsx`
- Create: `src/app/(app)/analytics/location-groups/actions.ts`
- Create: `src/app/(app)/analytics/location-groups/location-selector.tsx`
- Create: `src/app/(app)/analytics/location-groups/location-metrics.tsx`
- Create: `src/app/(app)/analytics/location-groups/capacity-metrics.tsx`
- Create: `src/app/(app)/analytics/location-groups/peer-analysis.tsx`
- Create: `src/app/(app)/analytics/location-groups/hotel-breakdown.tsx`

Query functions:
- `getLocationGroupsList(filters, userCtx)` → `LocationGroupData[]`
- `getLocationGroupDetail(groupIds, filters, userCtx)` → `LocationGroupDetail`

Includes capacity-normalized metrics (rev/room, txn/kiosk) and peer analysis (percentile ranking against all groups).

Reference: `data-dashboard/src/app/api/analytics/location-groups/route.ts` and components.

**Commit:**

```bash
git add src/lib/analytics/queries/location-groups.ts src/app/(app)/analytics/location-groups/
git commit -m "feat(m6): location groups analytics page with capacity metrics"
```

---

## Plan 5: Trend Builder — Store, Queries, Weather, Events

### Task 5.1: Trend Store (Zustand)

**Files:**
- Create: `src/lib/stores/trend-store.ts`

Port from `data-dashboard/src/lib/stores/trend-store.ts`. Key state:
- `pendingSeries` / `appliedSeries` split
- `granularity`: auto / daily / weekly / monthly
- `showWeather`, `showEvents`, `activeEventCategories`
- Actions: `addSeries`, `removeSeries`, `updateSeries`, `applyChanges`, `toggleAppliedHidden`, `loadPreset`, `loadSavedView`, `resetAll`
- `CHART_COLORS`: 8 WeKnow brand colors
- `generateSeriesLabel(metric, filters)` auto-label generator
- Max 6 series

**Commit:**

```bash
git add src/lib/stores/trend-store.ts
git commit -m "feat(m6): trend builder store (pending/applied series split)"
```

---

### Task 5.2: Trend Series Queries

**Files:**
- Create: `src/lib/analytics/queries/trend-series.ts`

Query function: `getTrendSeriesData(metric, filters, dateFrom, dateTo, userCtx)` → `TrendDataPoint[]`

Aggregates `salesRecords` by date based on metric:
- `revenue` → `SUM(gross_amount)`
- `transactions` → `COUNT(*)`
- `avg_basket_value` → `SUM(gross_amount) / COUNT(*)`
- `booking_fee` → `SUM(booking_fee)`

Groups by `transaction_date`, applies scope + exclusions + series-specific dimension filters.

Reference: `data-dashboard/src/app/api/analytics/trend-series/route.ts`

**Commit:**

```bash
git add src/lib/analytics/queries/trend-series.ts
git commit -m "feat(m6): trend series query function"
```

---

### Task 5.3: Weather Integration

**Files:**
- Create: `src/lib/weather/open-meteo.ts`
- Create: `src/lib/weather/region-coordinates.ts`

Port from `data-dashboard/src/lib/weather/`:
- **open-meteo.ts**: Fetches daily weather from OpenMeteo API. Uses archive endpoint for >92 days ago, forecast for recent. Caches to `weatherCache` table. Returns `DailyWeather[]`.
- **region-coordinates.ts**: Maps region names to lat/lon coordinates. `resolveWeatherLocation(appliedSeries)` returns coordinates only if exactly one location group is represented across series.

**Commit:**

```bash
git add src/lib/weather/
git commit -m "feat(m6): OpenMeteo weather integration with cache"
```

---

### Task 5.4: Trend Builder Page + Components

**Files:**
- Create: `src/app/(app)/analytics/trend-builder/page.tsx`
- Create: `src/app/(app)/analytics/trend-builder/actions.ts`
- Create: `src/app/(app)/analytics/trend-builder/series-builder-panel.tsx`
- Create: `src/app/(app)/analytics/trend-builder/series-row.tsx`
- Create: `src/app/(app)/analytics/trend-builder/trend-chart.tsx`
- Create: `src/app/(app)/analytics/trend-builder/weather-mini-chart.tsx`
- Create: `src/app/(app)/analytics/trend-builder/event-annotations.tsx`
- Create: `src/app/(app)/analytics/trend-builder/granularity-selector.tsx`

Port from `data-dashboard/src/components/trend-builder/`. Key behaviors:
- Series builder panel with color picker, metric select, dimension filter pills
- LineChart with dual Y-axes (left = currency, right = count)
- Weather mini chart (108px, synced crosshair) with temp lines + precipitation bars
- Event annotations: ReferenceLine for point events, ReferenceArea for ranges, with overlap stacking
- Auto-granularity from date span

**Commit:**

```bash
git add src/app/(app)/analytics/trend-builder/
git commit -m "feat(m6): trend builder page with weather + event overlays"
```

---

## Plan 6: Pivot Table — Engine, Queries, DnD Page

### Task 6.1: Pivot Engine

**Files:**
- Create: `src/lib/analytics/pivot-engine.ts`
- Create: `src/lib/analytics/pivot-engine.test.ts`

Port from `data-dashboard/src/lib/analytics/pivot-engine.ts` (562 lines). Key exports:
- `ALLOWED_COLUMNS` — strict allowlist for SQL injection prevention
- `DERIVED_GROUP_COLUMNS` — computed expressions (sale_month, sale_year)
- `VALID_AGGREGATIONS` — sum, avg, count, min, max
- `validatePivotConfig(config)` — validates dimensions and metrics against allowlist
- `buildPivotSQL(config, filters, scopeCondition, exclusionCondition)` — builds parameterized SQL
- `formatPivotResults(rawRows, config)` — transforms flat rows into crosstab structure
- `buildPivotData(rawRows, rowFields, columnFields, valueConfigs)` — pivots flat data into row/column/cell structure with grand totals

**Adapt for Drizzle**: Replace Supabase RPC calls with Drizzle `sql` templates. Use kiosk-tool table/column names:
- `sales_data` → `salesRecords`
- `hotel_metadata_cache` → `locations` (joined via `locationId`)
- `amount` → `grossAmount`
- `outlet_code` → via `locations.outletCode` join

**Tests** — validate allowlist prevents injection, test crosstab pivoting, test grand total calculation.

**Commit:**

```bash
git add src/lib/analytics/pivot-engine.ts src/lib/analytics/pivot-engine.test.ts
git commit -m "feat(m6): pivot engine with column allowlist + crosstab builder"
```

---

### Task 6.2: Pivot Queries + Server Action

**Files:**
- Create: `src/lib/analytics/queries/pivot.ts`
- Create: `src/app/(app)/analytics/pivot-table/actions.ts`

Query function: `executePivot(config, filters, userCtx)` → `PivotResponse`

1. Validate config via `validatePivotConfig()`
2. Build SQL via `buildPivotSQL()` with scope + exclusion conditions
3. Execute query per value field (parallel)
4. Merge results using composite dimension keys
5. Handle period comparison (MoM/YoY): calculate prev dates, run parallel queries, merge with `prev_*` and `change_*` columns

Server action wraps this with auth check.

Reference: `data-dashboard/src/app/api/analytics/pivot/route.ts` (301 lines)

**Commit:**

```bash
git add src/lib/analytics/queries/pivot.ts src/app/(app)/analytics/pivot-table/actions.ts
git commit -m "feat(m6): pivot query executor with period comparison"
```

---

### Task 6.3: Pivot Table Page + DnD Components

**Files:**
- Create: `src/app/(app)/analytics/pivot-table/page.tsx`
- Create: `src/app/(app)/analytics/pivot-table/field-list.tsx`
- Create: `src/app/(app)/analytics/pivot-table/drop-zones.tsx`
- Create: `src/app/(app)/analytics/pivot-table/pivot-toolbar.tsx`
- Create: `src/app/(app)/analytics/pivot-table/pivot-result-table.tsx`
- Create: `src/lib/stores/pivot-store.ts`

Port from `data-dashboard/src/components/pivot/`. Key behaviors:
- Two-panel layout: field list (25%) + workspace (75%)
- Draggable field chips (curated + advanced toggle)
- 3 drop zones: Rows, Columns, Values (with aggregation selector)
- Max 2 fields per axis
- MoM / YoY period comparison toggles
- Result table with grand totals row, horizontal scroll, up to 10K rows

Uses `@dnd-kit/core` + `@dnd-kit/sortable` (already in deps).

**Pivot store** (`src/lib/stores/pivot-store.ts`): Independent filter state + pivot config state.

**Commit:**

```bash
git add src/lib/stores/pivot-store.ts src/app/(app)/analytics/pivot-table/
git commit -m "feat(m6): pivot table page with drag-and-drop + period comparison"
```

---

## Plan 7: Admin Pages — Presets, Exclusions, Events

### Task 7.1: Analytics Presets CRUD

**Files:**
- Create: `src/app/(app)/settings/analytics-presets/page.tsx`
- Create: `src/app/(app)/settings/analytics-presets/actions.ts`
- Create: `src/app/(app)/settings/analytics-presets/presets-table.tsx`
- Create: `src/app/(app)/settings/analytics-presets/preset-form.tsx`

Server actions: `listPresets()`, `createPreset()`, `updatePreset()`, `deletePreset()` — standard Drizzle CRUD on `analyticsPresets` table with audit logging.

Page: DataTable with Name, filter summary columns, Edit/Delete actions. Create form: name + description + filter config (dimension selections as JSONB).

Reference: `data-dashboard/src/app/(dashboard)/admin/presets/`

**Commit:**

```bash
git add src/app/(app)/settings/analytics-presets/
git commit -m "feat(m6): analytics presets admin page (CRUD)"
```

---

### Task 7.2: Outlet Exclusions Management

**Files:**
- Create: `src/app/(app)/settings/outlet-exclusions/page.tsx`
- Create: `src/app/(app)/settings/outlet-exclusions/actions.ts`
- Create: `src/app/(app)/settings/outlet-exclusions/exclusions-list.tsx`
- Create: `src/app/(app)/settings/outlet-exclusions/exclusion-form.tsx`

Server actions: `listExclusions()`, `createExclusion()`, `deleteExclusion()`, `testPattern(pattern, patternType)` — tests a pattern against all outlet codes and returns matches.

UI: Pattern type selector (exact/regex), code/regex input, label, "Test Pattern" button showing matched outlets, add/delete with confirmation.

Reference: `data-dashboard/src/components/admin/outlet-exclusions.tsx`

**Commit:**

```bash
git add src/app/(app)/settings/outlet-exclusions/
git commit -m "feat(m6): outlet exclusions admin page with pattern testing"
```

---

### Task 7.3: Business Events + Categories Management

**Files:**
- Create: `src/app/(app)/settings/business-events/page.tsx`
- Create: `src/app/(app)/settings/business-events/actions.ts`
- Create: `src/app/(app)/settings/business-events/events-list.tsx`
- Create: `src/app/(app)/settings/business-events/event-form.tsx`
- Create: `src/app/(app)/settings/business-events/category-manager.tsx`

Server actions:
- Events: `listEvents()`, `createEvent()`, `updateEvent()`, `deleteEvent()`
- Categories: `listCategories()`, `createCategory()`, `updateCategory()`, `deleteCategory()`

Event form: Title, category (select with color swatch), start date (calendar), end date (optional), description, scope type (global/hotel/region/hotel_group), scope value (dimension selector).

Category manager: Name + color picker + isCore flag. Embedded in events page.

Reference: `data-dashboard/src/app/(dashboard)/admin/events/`

**Commit:**

```bash
git add src/app/(app)/settings/business-events/
git commit -m "feat(m6): business events + categories admin page"
```

---

## Plan 8: Impersonation

### Task 8.1: Impersonation Server Actions + Banner

**Files:**
- Create: `src/app/(app)/settings/users/impersonation-actions.ts`
- Create: `src/components/analytics/impersonation-banner.tsx`
- Modify: `src/app/(app)/analytics/layout.tsx`
- Modify: `src/lib/scoping/scoped-query.ts` (if needed — may already support impersonation)

Adapt from `data-dashboard/src/app/api/auth/impersonate/route.ts`. Use server actions (not API routes) to match kiosk-tool convention:
- `startImpersonation(targetUserId)`: Admin-only, sets httpOnly cookies, logs to audit
- `stopImpersonation()`: Removes cookies, logs to audit

Guards:
- Cannot impersonate yourself
- Cannot impersonate other admins
- Cannot impersonate inactive/banned users
- 1-hour cookie expiry

Banner component: Amber background, "Viewing as: {name}", Exit button. Shown in analytics layout when cookies are present.

Add "View As" button to existing user detail page (`src/app/(app)/settings/users/[id]/`).

Verify `scopedSalesCondition()` already reads impersonation cookies (check `honorImpersonation` flag in existing code).

**Commit:**

```bash
git add src/app/(app)/settings/users/impersonation-actions.ts src/components/analytics/impersonation-banner.tsx
git commit -m "feat(m6): admin impersonation (view-as) with audit trail"
```

---

## Plan 9: Export — CSV + Branded Excel

### Task 9.1: CSV Builder + API Route

**Files:**
- Create: `src/lib/analytics/export/csv-builder.ts`
- Create: `src/app/api/export/csv/route.ts`

Port `data-dashboard/src/lib/export/csv-builder.ts`. RFC 4180 compliant escaping.

API route handler: `GET /api/export/csv?tab=portfolio&from=...&to=...&...`
- Auth check via session
- Parse tab + filter params
- Call the same query functions used by pages
- Build CSV sections (headers + data + summary)
- Stream response with `Content-Type: text/csv` and `Content-Disposition: attachment`

**Commit:**

```bash
git add src/lib/analytics/export/csv-builder.ts src/app/api/export/csv/route.ts
git commit -m "feat(m6): CSV export API route"
```

---

### Task 9.2: Excel Builder + API Route

**Files:**
- Create: `src/lib/analytics/export/excel-builder.ts`
- Create: `src/app/api/export/excel/route.ts`

Port `data-dashboard/src/lib/export/excel-builder.ts`. Branded workbook:
- Azure (#00A6D3) header rows with white bold text
- Alternating row fills (white / light grey)
- Per-section worksheets
- Font: Calibri (closest available to Circular Pro)
- Raw Data sheet as final sheet

API route: Same pattern as CSV but returns `.xlsx` binary with appropriate content type.

**Commit:**

```bash
git add src/lib/analytics/export/ src/app/api/export/
git commit -m "feat(m6): branded Excel export API route"
```

---

## Plan 10: Database Migration (if needed)

### Task 10.1: New Index + Schema Additions

**Files:**
- Create: `migrations/NNNN_analytics_indexes.sql` (via drizzle-kit)

Add performance index:
- `CREATE INDEX idx_sales_records_transaction_date ON sales_records (transaction_date)` — standalone date-range scan

Check if any schema changes are needed (likely not — all analytics tables were created in M1). If weatherCache needs additional columns for forecast staleness tracking, add them here.

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

**Commit:**

```bash
git add migrations/ src/db/schema.ts
git commit -m "feat(m6): analytics performance index on transaction_date"
```

---

## Plan 11: Testing — Unit, Integration, Playwright E2E

### Task 11.1: Unit Tests for Formatters + Metrics

Already created in Tasks 1.3 and 1.4. Verify all pass:

```bash
npx vitest run src/lib/analytics/formatters.test.ts src/lib/analytics/metrics.test.ts
```

---

### Task 11.2: Unit Tests for Pivot Engine

Already created in Task 6.1. Verify:

```bash
npx vitest run src/lib/analytics/pivot-engine.test.ts
```

---

### Task 11.3: Integration Tests for All Query Modules

**Files:**
- Create: `tests/db/analytics-heat-map.integration.test.ts`
- Create: `tests/db/analytics-hotel-groups.integration.test.ts`
- Create: `tests/db/analytics-regions.integration.test.ts`
- Create: `tests/db/analytics-location-groups.integration.test.ts`
- Create: `tests/db/analytics-trend-series.integration.test.ts`
- Create: `tests/db/analytics-pivot.integration.test.ts`

Each test:
1. Seeds test data (locations, products, hotel groups, regions, location groups, sales records)
2. Creates test users with different scopes
3. Runs queries with different filter combinations
4. Asserts correct aggregations
5. Asserts scoping enforcement (user sees only permitted data)
6. Asserts outlet exclusions applied

**Commit after each file passes.**

---

### Task 11.4: Playwright E2E — Analytics Pages

**Files:**
- Create: `tests/analytics/portfolio.spec.ts`
- Create: `tests/analytics/heat-map.spec.ts`
- Create: `tests/analytics/trend-builder.spec.ts`
- Create: `tests/analytics/hotel-groups.spec.ts`
- Create: `tests/analytics/regions.spec.ts`
- Create: `tests/analytics/location-groups.spec.ts`

Each spec:
1. Navigate to page
2. Assert page loads with default date range
3. Change date range → verify data updates
4. Apply dimension filter → verify filtered results
5. Test export button (CSV download, verify non-empty)

**Commit:**

```bash
git add tests/analytics/
git commit -m "test(m6): Playwright E2E for analytics pages"
```

---

### Task 11.5: Playwright E2E — Pivot Table (Thorough)

**Files:**
- Create: `tests/analytics/pivot-table.spec.ts`

Comprehensive pivot coverage:
1. Drag dimension to Rows → Run → table renders
2. Drag dimension to Columns → column headers match values
3. Multiple row + column dimensions → nested grouping
4. Add/remove value metrics → columns update
5. YoY comparison → previous period columns appear with correct values
6. MoM comparison → monthly buckets, correct values
7. Column sorting → click header → ascending → click again → descending
8. Empty result set → appropriate empty state
9. Large result set → pagination/scroll works
10. Clear all → resets to empty state
11. Run with no fields → validation message
12. Export pivot → CSV/Excel matches table

**Commit:**

```bash
git add tests/analytics/pivot-table.spec.ts
git commit -m "test(m6): thorough Playwright E2E for pivot table"
```

---

### Task 11.6: Playwright E2E — Admin Pages + Impersonation

**Files:**
- Create: `tests/admin/analytics-presets.spec.ts`
- Create: `tests/admin/outlet-exclusions.spec.ts`
- Create: `tests/admin/business-events.spec.ts`
- Create: `tests/admin/impersonation.spec.ts`

Admin page specs: CRUD lifecycle for each entity.

Impersonation spec:
1. Admin starts "View as" non-admin user
2. Verify banner appears
3. Navigate analytics pages → data is scoped
4. Stop impersonation → back to admin view
5. Verify audit log entries

**Commit:**

```bash
git add tests/admin/
git commit -m "test(m6): Playwright E2E for admin pages + impersonation"
```

---

### Task 11.7: Playwright E2E — Scoping Enforcement

**Files:**
- Create: `tests/analytics/scoping-enforcement.spec.ts`

Test with a scoped user (has userScopes rows limiting to specific hotel group):
1. Login as scoped user
2. Visit each analytics page
3. Assert data only contains permitted locations/products
4. Assert no data leakage from other hotel groups

**Commit:**

```bash
git add tests/analytics/scoping-enforcement.spec.ts
git commit -m "test(m6): Playwright scoping enforcement across all analytics pages"
```

---

## Plan 12: Final Verification + Merge Commit

### Task 12.1: Full Test Suite Run

```bash
npx vitest run                          # Unit tests
npx vitest run --project integration    # Integration tests
npx playwright test                     # E2E tests
npx tsc --noEmit                        # Typecheck
npx eslint .                            # Lint
```

All existing tests must still pass. New test counts should increase significantly.

---

### Task 12.2: Dev Server Smoke Test

```bash
npm run dev
```

Visit each page in browser, verify:
- `/analytics/portfolio` — loads with data, all 6 sections render
- `/analytics/heat-map` — composite scores display correctly
- `/analytics/trend-builder` — add series, toggle weather/events
- `/analytics/pivot-table` — drag fields, run pivot, test YoY
- `/analytics/hotel-groups` — select group, see breakdown
- `/analytics/regions` — select region, see breakdown
- `/analytics/location-groups` — capacity metrics display
- `/settings/analytics-presets` — CRUD works
- `/settings/outlet-exclusions` — pattern test works
- `/settings/business-events` — CRUD with calendar

---

### Task 12.3: Update HANDOFF.md

Update `docs/HANDOFF.md` (untracked by convention) with M6 status:
- M6 summary: what was ported, test counts, key decisions
- Update "What's next" to M7

---

### Task 12.4: Merge Commit

```bash
git checkout main
git merge --no-ff m6-analytics-port -m "Merge M6: Port Analytics Pages"
```

---

## Execution Order Summary

| Plan | Tasks | Focus |
|---|---|---|
| Plan 1 | 1.1–1.4 | Foundation: deps, types, formatters, metrics |
| Plan 2 | 2.1–2.8 | Filter infra: store, components, layout, sidebar |
| Plan 3 | 3.1–3.6 | Query layer + Portfolio + Heat Map |
| Plan 4 | 4.1–4.3 | Dimension pages: hotel groups, regions, location groups |
| Plan 5 | 5.1–5.4 | Trend builder: store, queries, weather, events |
| Plan 6 | 6.1–6.3 | Pivot table: engine, queries, DnD UI |
| Plan 7 | 7.1–7.3 | Admin: presets, exclusions, events |
| Plan 8 | 8.1 | Impersonation |
| Plan 9 | 9.1–9.2 | Export: CSV + branded Excel |
| Plan 10 | 10.1 | DB migration (index) |
| Plan 11 | 11.1–11.7 | Testing: unit, integration, Playwright E2E |
| Plan 12 | 12.1–12.4 | Verification + merge |
