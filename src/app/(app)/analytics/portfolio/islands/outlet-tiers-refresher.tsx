"use client";

import { useRouter } from "next/navigation";
import { OutletTiers } from "../outlet-tiers";
import type { ThresholdConfig } from "@/lib/analytics/thresholds";
import type { OutletTierRow, LocationFlag } from "@/lib/analytics/types";

interface Props {
  data: OutletTierRow[];
  thresholdConfig: ThresholdConfig;
  flags: LocationFlag[];
}

/**
 * Client wrapper around <OutletTiers /> that captures `router.refresh()` as
 * the `onFlagCreated` callback. Without this the server-rendered island would
 * have no way to reload after a flag mutation.
 */
export function OutletTiersRefresher({ data, thresholdConfig, flags }: Props) {
  const router = useRouter();
  return (
    <OutletTiers
      data={data}
      thresholdConfig={thresholdConfig}
      flags={flags}
      onFlagCreated={() => router.refresh()}
    />
  );
}
