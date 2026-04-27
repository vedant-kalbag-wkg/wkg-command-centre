import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";

/**
 * D6 / Task 2.12 — admin-controlled display mode for hour-of-day analytics.
 *
 *   - "local" (default) → group by each location's `iana_timezone`. The
 *     widget shows the peak hour as actual wall-clock time at the property.
 *   - "utc"             → group by 'UTC' for all rows. Equivalent to the
 *     pre-D6 behaviour; useful for raw-data debugging or comparing CMS
 *     timestamps.
 *
 * Stored in the existing `app_settings` key/value table under the key
 * `analytics_display_timezone` (seeded by migration 0033). Cached for one
 * day with a tag so the settings UI can `revalidateTag` on save.
 */

export type AnalyticsDisplayTimezone = "local" | "utc";

const KEY = "analytics_display_timezone";
const DEFAULT: AnalyticsDisplayTimezone = "local";

export const DISPLAY_TIMEZONE_TAG = "analytics:display-timezone";

const getDisplayTimezoneCached = unstable_cache(
  async (): Promise<AnalyticsDisplayTimezone> => {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, KEY))
      .limit(1);

    return row?.value === "utc" || row?.value === "local"
      ? row.value
      : DEFAULT;
  },
  ["analytics", "display-timezone", "v1"],
  { revalidate: 86400, tags: ["analytics", DISPLAY_TIMEZONE_TAG] },
);

export async function getAnalyticsDisplayTimezone(): Promise<AnalyticsDisplayTimezone> {
  return getDisplayTimezoneCached();
}
