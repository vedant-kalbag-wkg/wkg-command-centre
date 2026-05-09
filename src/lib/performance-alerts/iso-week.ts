/**
 * Computes ISO-8601 week keys in Europe/London wall-clock time.
 *
 * ISO rule: week 1 of a year is the week that contains the year's first Thursday.
 * We project the input date to its London calendar date, then apply the standard
 * ISO week algorithm purely in UTC arithmetic (no timezone offset math).
 */

const LONDON_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Returns an ISO-8601 week identifier like "2026-W19" for the given Date,
 * computed using Europe/London wall-clock time.
 */
export function isoWeekKey(date: Date): string {
  const parts = LONDON_FORMATTER.formatToParts(date);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)!.value);

  const year = get("year");
  const month = get("month");
  const day = get("day");

  // Treat the London calendar date as a UTC date for pure arithmetic.
  const localDay = new Date(Date.UTC(year, month - 1, day));

  // Day of week: 0=Mon … 6=Sun (ISO convention)
  const dayOfWeek = (localDay.getUTCDay() + 6) % 7;

  // Find the Thursday of this week — Thursday determines the ISO year.
  const thursday = new Date(localDay);
  thursday.setUTCDate(localDay.getUTCDate() - dayOfWeek + 3);

  const isoYear = thursday.getUTCFullYear();

  // Week 1 starts on the Monday on or before Jan 4 of isoYear.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayOfWeek = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayOfWeek);

  const weekNumber =
    Math.floor(
      (thursday.getTime() - week1Monday.getTime()) / (7 * 24 * 3600 * 1000),
    ) + 1;

  return `${isoYear}-W${weekNumber.toString().padStart(2, "0")}`;
}
