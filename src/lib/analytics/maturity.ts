export type MaturityBucket = "0-1mo" | "1-3mo" | "3-6mo" | "6+mo";

export const MATURITY_BUCKETS: { value: MaturityBucket; label: string }[] = [
  { value: "0-1mo", label: "0-1 Month" },
  { value: "1-3mo", label: "1-3 Months" },
  { value: "3-6mo", label: "3-6 Months" },
  { value: "6+mo", label: "6+ Months" },
];

export function calculateMaturityBucket(
  liveDate: Date | null,
  referenceDate: Date = new Date(),
): MaturityBucket | null {
  if (!liveDate) return null;
  const diffMs = referenceDate.getTime() - liveDate.getTime();
  const months = diffMs / (30.44 * 24 * 60 * 60 * 1000);
  if (months < 1) return "0-1mo";
  if (months < 3) return "1-3mo";
  if (months < 6) return "3-6mo";
  return "6+mo";
}

const MATURITY_LABEL_MAP: Record<MaturityBucket, string> = {
  "0-1mo": "0-1 Month",
  "1-3mo": "1-3 Months",
  "3-6mo": "3-6 Months",
  "6+mo": "6+ Months",
};

export function maturityBucketLabel(bucket: MaturityBucket): string {
  return MATURITY_LABEL_MAP[bucket];
}
