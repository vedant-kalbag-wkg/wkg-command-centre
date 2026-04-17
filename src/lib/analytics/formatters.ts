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

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return dateFormatter.format(d);
}

// ─── Granularity & Bucketing ─────────────────────────────────────────────────

export type Granularity = "daily" | "weekly" | "monthly";

export function autoGranularity(from: Date, to: Date): Granularity {
  const diffDays = Math.ceil(
    (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays <= 31) return "daily";
  if (diffDays <= 90) return "weekly";
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
