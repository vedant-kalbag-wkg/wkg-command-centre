import type { DimensionType } from "@/lib/scoping/scoped-query";

export const DIMENSION_OPTIONS: { value: DimensionType; label: string }[] = [
  { value: "hotel_group", label: "Hotel group" },
  { value: "location", label: "Location" },
  { value: "region", label: "Region" },
  { value: "product", label: "Product" },
  { value: "provider", label: "Provider" },
  { value: "location_group", label: "Location group" },
];
