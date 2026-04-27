/**
 * D6 / Task 2.12 — common IANA timezones offered in the location detail
 * form's timezone Select.
 *
 * Hardcoded (vs `Intl.supportedValuesOf('timeZone')` at runtime) for two
 * reasons:
 *   1. Curated list — the runtime value has 400+ zones including aliases
 *      (`Etc/GMT+5`, deprecated `US/Pacific`, etc.) which is a noisy UX. We
 *      only need the cities that match WKG estate footprints today plus a
 *      sensible global tail for future expansion.
 *   2. Server/client parity — `Intl.supportedValuesOf` exists in modern
 *      browsers and Node ≥ 18 but the values can drift between the two.
 *      Hardcoding guarantees the same options render in SSR and on the
 *      client.
 *
 * Order: WKG-active regions first (alphabetical inside each), then the rest
 * of the world by continent. The form falls back to a free-text input if
 * the location's stored value isn't in the list, so this is just an UX
 * shortlist — not an enforcement boundary.
 */
export const COMMON_IANA_TIMEZONES = [
  // WKG-active regions
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Prague",
  "Australia/Sydney",
  // North America (US/Canada — Miami covered by NY)
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "America/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  // Latin America
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
  // Europe (non-WKG)
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Brussels",
  "Europe/Copenhagen",
  "Europe/Helsinki",
  "Europe/Lisbon",
  "Europe/Oslo",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Vienna",
  "Europe/Warsaw",
  "Europe/Zurich",
  "Europe/Istanbul",
  "Europe/Moscow",
  // Africa / Middle East
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Jerusalem",
  // Asia
  "Asia/Kolkata",
  "Asia/Karachi",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  // Pacific
  "Pacific/Auckland",
  "Pacific/Honolulu",
  // Fallback
  "UTC",
] as const;

export type CommonIanaTimezone = (typeof COMMON_IANA_TIMEZONES)[number];
