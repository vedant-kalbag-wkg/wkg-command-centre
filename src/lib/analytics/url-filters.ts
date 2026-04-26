// OQ5 — Zod-validated URL filter parsing. Bookmarks and hand-crafted URLs
// can carry stale UUIDs, unknown enum values, or malformed dates. Validate
// at the boundary, drop bad values silently, and report what was dropped so
// the caller can surface a toast.

import { z } from "zod";
import { LOCATION_TYPES, type LocationType, type MetricMode } from "@/lib/analytics/types";
import { MATURITY_BUCKET_VALUES, type MaturityBucket } from "@/lib/analytics/maturity";

// One entry per filter that had at least one invalid value dropped. `field`
// is the URL param key (matches filtersToSearchParams), so the toast can
// surface human-readable per-filter messages.
export type DroppedParam = {
  field: string;
  values: string[];
};

export type ParsedUrlFilters = {
  dateRange?: { from: Date; to: Date };
  hotelFilter?: string[];
  regionFilter?: string[];
  productFilter?: string[];
  hotelGroupFilter?: string[];
  locationGroupFilter?: string[];
  maturityFilter?: MaturityBucket[];
  locationTypeFilter?: LocationType[];
  metricMode?: MetricMode;
};

export type UrlFilterResult = {
  filters: ParsedUrlFilters;
  dropped: DroppedParam[];
  hasFilterParams: boolean;
};

// Schemas. Strict at the value level; .safeParse on each entry collects the
// invalid values without aborting the whole parse.
const uuidSchema = z.string().uuid();
const isoDateSchema = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), { message: "invalid date" });
const metricModeSchema = z.enum(["sales", "revenue"]);
const locationTypeSchema = z.enum(LOCATION_TYPES as readonly [LocationType, ...LocationType[]]);
const maturityBucketSchema = z.enum(
  MATURITY_BUCKET_VALUES as readonly [MaturityBucket, ...MaturityBucket[]],
);

function splitCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(",").filter(Boolean);
}

// Partition a CSV list into (valid, invalid) using the provided schema.
function partitionBySchema<T>(
  values: string[],
  schema: z.ZodType<T>,
): { valid: T[]; invalid: string[] } {
  const valid: T[] = [];
  const invalid: string[] = [];
  for (const v of values) {
    const r = schema.safeParse(v);
    if (r.success) valid.push(r.data);
    else invalid.push(v);
  }
  return { valid, invalid };
}

function pushDropped(dropped: DroppedParam[], field: string, values: string[]): void {
  if (values.length > 0) dropped.push({ field, values });
}

// Some entry points pass URLSearchParams, others pass a Next.js searchParams
// object (string | string[] | undefined values). Normalise to scalars/CSV.
type SearchParamsLike =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function getRaw(sp: SearchParamsLike, key: string): string | null {
  if (sp instanceof URLSearchParams) return sp.get(key);
  const v = sp[key];
  if (v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function hasKey(sp: SearchParamsLike, key: string): boolean {
  if (sp instanceof URLSearchParams) return sp.has(key);
  return sp[key] !== undefined;
}

const FILTER_KEYS = [
  "from",
  "to",
  "hotels",
  "regions",
  "products",
  "hgroups",
  "lgroups",
  "maturity",
  "types",
  "mode",
] as const;

// Single source of truth for parsing the analytics filter URL params.
// Returns the partial filter state plus a list of dropped values per field
// so the caller can surface a toast/banner. Never throws on invalid input;
// the contract is "drop and continue".
export function parseUrlFilters(sp: SearchParamsLike): UrlFilterResult {
  const dropped: DroppedParam[] = [];
  const filters: ParsedUrlFilters = {};

  const hasFilterParams = FILTER_KEYS.some((k) => hasKey(sp, k));

  // Date range — both endpoints required, both validated. If either is bad
  // we drop the pair and report which side failed.
  const fromRaw = getRaw(sp, "from");
  const toRaw = getRaw(sp, "to");
  if (fromRaw || toRaw) {
    const fromOk = fromRaw ? isoDateSchema.safeParse(fromRaw) : null;
    const toOk = toRaw ? isoDateSchema.safeParse(toRaw) : null;
    if (fromOk?.success && toOk?.success) {
      filters.dateRange = { from: new Date(fromOk.data), to: new Date(toOk.data) };
    } else {
      const bad: string[] = [];
      if (fromRaw && fromOk && !fromOk.success) bad.push(fromRaw);
      if (toRaw && toOk && !toOk.success) bad.push(toRaw);
      // If only one side is present without the other, treat the present one
      // as dropped — date range is meaningful only as a pair.
      if (fromRaw && !toRaw) bad.push(fromRaw);
      if (toRaw && !fromRaw) bad.push(toRaw);
      pushDropped(dropped, "dateRange", bad);
    }
  }

  // UUID-list filters.
  const uuidFilters: { key: string; field: keyof ParsedUrlFilters }[] = [
    { key: "hotels", field: "hotelFilter" },
    { key: "regions", field: "regionFilter" },
    { key: "products", field: "productFilter" },
    { key: "hgroups", field: "hotelGroupFilter" },
    { key: "lgroups", field: "locationGroupFilter" },
  ];
  for (const { key, field } of uuidFilters) {
    const raw = getRaw(sp, key);
    if (!raw) continue;
    const { valid, invalid } = partitionBySchema(splitCsv(raw), uuidSchema);
    if (valid.length > 0) (filters as Record<string, unknown>)[field] = valid;
    pushDropped(dropped, key, invalid);
  }

  // Maturity buckets (whitelist against the canonical 5-bucket set, D3).
  const maturityRaw = getRaw(sp, "maturity");
  if (maturityRaw) {
    const { valid, invalid } = partitionBySchema(splitCsv(maturityRaw), maturityBucketSchema);
    if (valid.length > 0) filters.maturityFilter = valid;
    pushDropped(dropped, "maturity", invalid);
  }

  // Location types (enum).
  const typesRaw = getRaw(sp, "types");
  if (typesRaw) {
    const { valid, invalid } = partitionBySchema(splitCsv(typesRaw), locationTypeSchema);
    if (valid.length > 0) filters.locationTypeFilter = valid;
    pushDropped(dropped, "types", invalid);
  }

  // Metric mode — single value, drop silently if not in {sales,revenue}.
  const modeRaw = getRaw(sp, "mode");
  if (modeRaw) {
    const r = metricModeSchema.safeParse(modeRaw);
    if (r.success) filters.metricMode = r.data;
    else pushDropped(dropped, "mode", [modeRaw]);
  }

  return { filters, dropped, hasFilterParams };
}

// Toast-friendly summary of dropped values. Returns null when nothing was
// dropped so the caller can skip surfacing.
export function formatDroppedMessage(dropped: DroppedParam[]): string | null {
  if (dropped.length === 0) return null;
  const parts = dropped.map(({ field, values }) => {
    const sample = values.slice(0, 3).join(", ");
    const more = values.length > 3 ? ` +${values.length - 3} more` : "";
    return `${field}: ${sample}${more}`;
  });
  return `Some filter values were ignored — ${parts.join("; ")}`;
}
