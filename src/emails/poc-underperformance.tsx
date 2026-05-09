import { Heading, Hr, Link, Section, Text } from "@react-email/components";

import { BRAND } from "./brand";
import { CTA } from "./_cta";
import { EmailLayout } from "./_layout";

// Phase 9 (hotel-level rewrite, post PR #38) — Weekly digest email for POCs
// with underperforming hotels.
//
// Prop shape mirrors the templateProps emitted by the weekly-poc-alerts cron
// in src/inngest/functions/weekly-poc-alerts.ts.
//
// Layout decisions:
//   - One "card" per hotel as a stacked Section block (cleaner than a
//     5-7-column flat table at 560px width). Each card surfaces hotel name +
//     composite score on top, region/scale meta on a second line, sales meta
//     on a third, and the 5 sub-metric percentiles inline on a fourth.
//   - moreCount: when > 0, append a "… and N more hotels" line below the
//     final card.
//   - Sticky weights footnote: renders the composite formula and a one-liner
//     explaining percentile ranking. Sourced from the cron (live values), so
//     a future migration of weights → app_settings flows through automatically.
//   - CTA points at /analytics/portfolio for cross-portfolio review;
//     per-hotel detail link goes to /locations/<id>.
//
// Currency formatting: the caller (cron) pre-formats `totalRevenue` and
// `salesPerRoom` using the hotel's modal currency. The template renders the
// strings verbatim. Snapshot tests intentionally pass raw numerics to assert
// the rendered card layout regardless of locale.

export interface HotelRow {
  locationId: string;
  hotelName: string;
  region: string;
  currency: string;
  totalRevenue: number | string;
  totalTransactions: number;
  kioskCount: number;
  numRooms: number | null;
  /** Pre-formatted by cron; null when numRooms is unknown. */
  salesPerRoom: string | null;
  /** Composite score 0-100, rounded to whole. */
  compositeScore: number;
  subMetricPercentiles: {
    revenue: number;
    transactions: number;
    /** null when numRooms is unknown (revenuePerRoom not computable). */
    revenuePerRoom: number | null;
    txnPerKiosk: number;
    basketValue: number;
  };
  detailUrl: string;
}

export interface PocUnderperformanceEmailProps {
  pocName: string;
  hotels: HotelRow[];
  moreCount: number;
  windowDays: number;
  runIsoWeek: string;
  /**
   * Optional override for the "View portfolio" CTA. Falls back to
   * `${BRAND.prodUrl}/analytics/portfolio` when omitted.
   */
  portfolioUrl?: string;
  /**
   * Bottom-tier composite-score cutoff (0-100). Defaults to 20 — the
   * OutletTierConfig default — only when the prop is omitted; production
   * callers always pass `tierConfig.bottom` so the body copy stays aligned
   * with the live admin-configured threshold.
   */
  bottomPercentile?: number;
  /**
   * Composite-score weights, sourced from the classifier. Defaults match
   * `DEFAULT_COMPOSITE_WEIGHTS` in classify-locations.ts.
   */
  weights?: {
    revenue: number;
    transactions: number;
    revenuePerRoom: number;
    txnPerKiosk: number;
    basketValue: number;
  };
}

const DEFAULT_WEIGHTS = {
  revenue: 0.3,
  transactions: 0.2,
  revenuePerRoom: 0.25,
  txnPerKiosk: 0.15,
  basketValue: 0.1,
} as const;

function pct(n: number | null): string {
  return n === null ? "—" : `p${n}`;
}

export function PocUnderperformanceEmail({
  pocName,
  hotels,
  moreCount,
  windowDays,
  runIsoWeek,
  portfolioUrl,
  bottomPercentile = 20,
  weights = DEFAULT_WEIGHTS,
}: PocUnderperformanceEmailProps) {
  const resolvedPortfolioUrl = portfolioUrl ?? `${BRAND.prodUrl}/analytics/portfolio`;
  const total = hotels.length + moreCount;
  const noun = total === 1 ? "hotel" : "hotels";

  return (
    <EmailLayout
      preheader={`${total} ${noun} flagged as underperforming in the last ${windowDays} days — ${runIsoWeek}`}
    >
      <Heading
        as="h1"
        style={{
          fontSize: "24px",
          fontWeight: 700,
          letterSpacing: "-0.01em",
          color: BRAND.graphite,
          margin: "0 0 14px",
          lineHeight: 1.2,
        }}
      >
        Underperforming hotels — {runIsoWeek}
      </Heading>

      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: BRAND.textSecondary,
          margin: "0 0 18px",
        }}
      >
        Hi {pocName}, the following hotels in your portfolio scored at or below{" "}
        {bottomPercentile}/100 on the composite performance score over the last{" "}
        {windowDays} days.
      </Text>

      {/* Per-hotel cards */}
      {hotels.map((h, i) => (
        <Section
          key={h.locationId}
          style={{
            padding: "14px 0",
            borderTop: i === 0 ? `1px solid ${BRAND.divider}` : undefined,
            borderBottom: `1px solid ${BRAND.divider}`,
          }}
        >
          <table
            role="presentation"
            cellPadding={0}
            cellSpacing={0}
            border={0}
            width="100%"
            style={{ width: "100%", borderCollapse: "collapse" }}
          >
            <tbody>
              {/* Row 1: hotel name (link) ←→ composite score */}
              <tr>
                <td
                  style={{
                    fontFamily: BRAND.fontStack,
                    fontSize: "15px",
                    color: BRAND.graphite,
                    lineHeight: 1.3,
                    padding: "0 8px 4px 0",
                  }}
                >
                  <Link
                    href={h.detailUrl}
                    style={{
                      color: BRAND.azure,
                      textDecoration: "none",
                      fontWeight: 600,
                    }}
                  >
                    {h.hotelName}
                  </Link>
                </td>
                <td
                  align="right"
                  style={{
                    fontFamily: BRAND.fontStack,
                    fontSize: "20px",
                    fontWeight: 700,
                    color: BRAND.graphite,
                    fontVariantNumeric: "tabular-nums",
                    padding: "0 0 4px 8px",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: BRAND.textMuted,
                      marginRight: "6px",
                    }}
                  >
                    Composite
                  </span>
                  {h.compositeScore}
                </td>
              </tr>

              {/* Row 2: region · kiosks · rooms */}
              <tr>
                <td
                  colSpan={2}
                  style={{
                    fontFamily: BRAND.fontStack,
                    fontSize: "13px",
                    color: BRAND.textSecondary,
                    lineHeight: 1.5,
                    padding: "0 0 6px",
                  }}
                >
                  {h.region} · {h.kioskCount} kiosk{h.kioskCount === 1 ? "" : "s"} ·{" "}
                  {h.numRooms === null ? "rooms unknown" : `${h.numRooms} rooms`}
                </td>
              </tr>

              {/* Row 3: sales · sales/room · transactions */}
              <tr>
                <td
                  colSpan={2}
                  style={{
                    fontFamily: BRAND.fontStack,
                    fontSize: "13px",
                    color: BRAND.graphite,
                    lineHeight: 1.5,
                    fontVariantNumeric: "tabular-nums",
                    padding: "0 0 6px",
                  }}
                >
                  {h.totalRevenue} sales ·{" "}
                  {h.salesPerRoom === null ? "—" : `${h.salesPerRoom}/room`} ·{" "}
                  {h.totalTransactions} txn{h.totalTransactions === 1 ? "" : "s"}
                </td>
              </tr>

              {/* Row 4: sub-metric percentiles */}
              <tr>
                <td
                  colSpan={2}
                  style={{
                    fontFamily: BRAND.fontStack,
                    fontSize: "12px",
                    color: BRAND.textMuted,
                    lineHeight: 1.5,
                    fontVariantNumeric: "tabular-nums",
                    padding: 0,
                  }}
                >
                  rev {pct(h.subMetricPercentiles.revenue)} · txn{" "}
                  {pct(h.subMetricPercentiles.transactions)} · /room{" "}
                  {pct(h.subMetricPercentiles.revenuePerRoom)} · /kiosk{" "}
                  {pct(h.subMetricPercentiles.txnPerKiosk)} · basket{" "}
                  {pct(h.subMetricPercentiles.basketValue)}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      ))}

      {moreCount > 0 ? (
        <Text
          style={{
            fontSize: "13px",
            lineHeight: 1.5,
            color: BRAND.textMuted,
            margin: "12px 0 16px",
            fontStyle: "italic",
          }}
        >
          … and {moreCount} more hotel{moreCount === 1 ? "" : "s"} flagged below the
          {" "}{bottomPercentile}/100 cutoff — see full list in your portfolio.
        </Text>
      ) : null}

      {/* Sticky composite-weights footnote */}
      <Text
        style={{
          fontSize: "12px",
          lineHeight: 1.5,
          color: BRAND.textMuted,
          margin: "16px 0 4px",
        }}
      >
        Composite score = revenue {Math.round(weights.revenue * 100)}% · transactions{" "}
        {Math.round(weights.transactions * 100)}% · revenue/room{" "}
        {Math.round(weights.revenuePerRoom * 100)}% · txn/kiosk{" "}
        {Math.round(weights.txnPerKiosk * 100)}% · basket value{" "}
        {Math.round(weights.basketValue * 100)}%.
      </Text>
      <Text
        style={{
          fontSize: "12px",
          lineHeight: 1.5,
          color: BRAND.textMuted,
          margin: "0 0 18px",
          fontStyle: "italic",
        }}
      >
        Each metric is ranked by percentile across all WeKnow hotels in this window.
      </Text>

      <Hr
        style={{
          borderTop: `1px solid ${BRAND.divider}`,
          margin: "0 0 20px",
        }}
      />

      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: BRAND.textSecondary,
          margin: "0 0 4px",
        }}
      >
        Review your portfolio to investigate and take action.
      </Text>

      <CTA href={resolvedPortfolioUrl} label="View portfolio" />
    </EmailLayout>
  );
}
