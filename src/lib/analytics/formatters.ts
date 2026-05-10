import type { ChangeIndicator } from "./types";

// ─── Currency & Number Formatting ────────────────────────────────────────────

const gbpFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number): string {
  return gbpFormatter.format(value);
}

/**
 * Phase 9.1 / D-10 / FX-03 — native-currency formatter for analytics cells in
 * single-currency cohorts. Sister to the GBP-pinned `formatCurrency` above,
 * which stays for multi-currency cohorts and always-GBP surfaces (D-15/D-16).
 *
 * Defensive try/catch fallback mirrors `src/lib/performance-alerts/format-currency.ts`
 * — an invalid ISO 4217 code on a malformed sales_records row would otherwise
 * throw RangeError and abort the render. Prefer emitting a readable string
 * with the literal code over a hard failure.
 */
export function formatNativeCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatNumber(value: number, decimals?: number): string {
  const formatter = new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? (Number.isInteger(value) ? 0 : 2),
  });
  return formatter.format(value);
}

export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    const v = abs / 1_000_000_000;
    return `${sign}${parseFloat(v.toFixed(1))}B`;
  }
  if (abs >= 1_000_000) {
    const v = abs / 1_000_000;
    return `${sign}${parseFloat(v.toFixed(1))}M`;
  }
  if (abs >= 1_000) {
    const v = abs / 1_000;
    return `${sign}${parseFloat(v.toFixed(1))}k`;
  }
  return `${sign}${abs}`;
}

// ─── Change & Percent Formatting ─────────────────────────────────────────────

export function formatPercentChange(
  current: number,
  previous: number,
): string {
  if (previous === 0) {
    return current === 0 ? "+0.0%" : "+100.0%";
  }
  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

const NEUTRAL_THRESHOLD = 0.1;

export function formatChangeIndicator(
  change: number | null,
): ChangeIndicator {
  if (change === null) {
    return { text: "\u2013", color: "#6B7280", direction: "neutral" };
  }
  if (change >= NEUTRAL_THRESHOLD) {
    return {
      text: `+${change.toFixed(1)}%`,
      color: "#166534",
      direction: "up",
    };
  }
  if (change <= -NEUTRAL_THRESHOLD) {
    return {
      text: `${change.toFixed(1)}%`,
      color: "#991B1B",
      direction: "down",
    };
  }
  return { text: "+0.0%", color: "#6B7280", direction: "neutral" };
}

// ─── Date Formatting ─────────────────────────────────────────────────────────

export function toLocalISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Phase 6.4 — single canonical date format across the app: `27 Apr 2026`.
// Day-month-year ordering avoids the en-GB / en-US ambiguity of `04/27`,
// and matches the style already used in detail surfaces (inline-edit
// fields, kiosk detail sheet, calendar event popovers).
//
// Intent: every date in lists, tables, and audit timelines should call
// `formatDate(d)` rather than `d.toLocaleDateString(...)` directly. Audit
// the codebase periodically — a raw `toLocaleDateString` reintroduced
// after this change is a regression.
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return dateFormatter.format(d);
}

// Phase 6.1 — `outletCode` is unique per region, not globally. Two outlets
// in different regions can share `Q5`, and the bare code in a global table
// (Outlet Tiers, Heat Map) leaves operators guessing. `formatOutletCode`
// returns `UK / Q5` when both halves are present and degrades gracefully.
//
// Callers should use it everywhere a region is implicit but not visible
// (cross-region tables); single-region drill-downs can keep the bare code.
export function formatOutletCode(
  outletCode: string | null | undefined,
  regionCode?: string | null,
): string {
  const code = outletCode?.trim();
  if (!code) return "—";
  const region = regionCode?.trim();
  return region ? `${region} / ${code}` : code;
}

// ─── Granularity & Bucketing ─────────────────────────────────────────────────

export type Granularity = "daily" | "weekly" | "monthly";

export function autoGranularity(from: Date, to: Date): Granularity {
  const diffDays = Math.ceil(
    (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24),
  );
  // Task 4.16 — smoother thresholds. The previous cliffs (31 → 90) caused a
  // visible discontinuity at the boundary (30 daily buckets → 5 weekly
  // buckets). 60 daily / 200 weekly keeps each granularity readable on a
  // typical chart width while avoiding jarring transitions.
  if (diffDays <= 60) return "daily";
  if (diffDays <= 200) return "weekly";
  return "monthly";
}

export function getISOWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  return monday.toISOString().split("T")[0];
}

export function getMonthBucket(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01";
}

export function dateToBucket(
  dateStr: string,
  granularity: Granularity,
): string {
  if (granularity === "daily") return dateStr;
  if (granularity === "weekly") return getISOWeekMonday(dateStr);
  return getMonthBucket(dateStr);
}

// ─── Null Handling ───────────────────────────────────────────────────────────

export function formatNullValue(
  value: number | null | undefined,
  formatter?: (v: number) => string,
): string {
  if (value == null || Number.isNaN(value)) return "\u2014";
  return formatter ? formatter(value) : String(value);
}

// ─── Hotel name display ──────────────────────────────────────────────────────

// Multi-POS hotels register each physical kiosk as its own `locations` row,
// distinguished by a trailing " b"/" B" suffix on the name (e.g. "Heathrow
// Terminal 4 b"). Cosmetic only — strip the suffix so analyst-facing tables
// show the natural name. The underlying row is preserved for the Phase 5.6
// multi-POS bulk merge to consume.
// TODO(5.6): remove once the multi-POS bulk merge eliminates the suffix.
export function formatHotelDisplayName(name: string): string {
  return name.replace(/\s[bB]$/, "");
}
