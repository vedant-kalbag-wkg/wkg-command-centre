// D3 — single 5-bucket maturity convention used everywhere (dashboard, global
// filter chip, ramp-curve labels, calculateMaturityBucket). Months, never days.
// Reference date is always caller-supplied (filters.dateTo); never NOW().
//
// Boundaries are LEFT-INCLUSIVE / RIGHT-EXCLUSIVE in months-since-liveDate:
//   0-1mo  → [0, 1)
//   1-3mo  → [1, 3)
//   3-6mo  → [3, 6)
//   6-9mo  → [6, 9)
//   9+mo   → [9, ∞)
// e.g. exactly 1.0 month old lands in 1-3mo, not 0-1mo. SQL CASE arms in
// shared.ts and maturity-analysis.ts mirror this.

export type MaturityBucket = "0-1mo" | "1-3mo" | "3-6mo" | "6-9mo" | "9+mo";

export const MATURITY_BUCKETS: { value: MaturityBucket; label: string }[] = [
  { value: "0-1mo", label: "0-1 mo" },
  { value: "1-3mo", label: "1-3 mo" },
  { value: "3-6mo", label: "3-6 mo" },
  { value: "6-9mo", label: "6-9 mo" },
  { value: "9+mo", label: "9+ mo" },
];

export const MATURITY_BUCKET_VALUES: readonly MaturityBucket[] = MATURITY_BUCKETS.map(
  (b) => b.value,
);

export function calculateMaturityBucket(
  liveDate: Date | null,
  referenceDate: Date,
): MaturityBucket | null {
  if (!liveDate) return null;
  const diffMs = referenceDate.getTime() - liveDate.getTime();
  const months = diffMs / (30.44 * 24 * 60 * 60 * 1000);
  if (months < 1) return "0-1mo";
  if (months < 3) return "1-3mo";
  if (months < 6) return "3-6mo";
  if (months < 9) return "6-9mo";
  return "9+mo";
}

const MATURITY_LABEL_MAP: Record<MaturityBucket, string> = {
  "0-1mo": "0-1 mo",
  "1-3mo": "1-3 mo",
  "3-6mo": "3-6 mo",
  "6-9mo": "6-9 mo",
  "9+mo": "9+ mo",
};

export function maturityBucketLabel(bucket: MaturityBucket): string {
  return MATURITY_LABEL_MAP[bucket];
}
