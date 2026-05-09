import { Heading, Hr, Link, Section, Text } from "@react-email/components";

import { BRAND } from "./brand";
import { CTA } from "./_cta";
import { EmailLayout } from "./_layout";

// Phase 9 Plan 09-04 — Weekly digest email for POCs with underperforming
// kiosks.
//
// Prop shape mirrors the event payload in events.ts `email/send.requested`
// for kind="underperforming_poc" (BLOCKER-3).
//
// Design decisions (09-PATTERNS.md § D-16):
//   - Kiosk rows rendered as table rows — more scannable than flat text
//     blocks, Outlook-safe via role="presentation" pattern from _cta.tsx
//   - moreCount conditional: when > 0, append a "… and N more kiosks"
//     line below the table (soft-truncation; cron keeps top-10 in payload)
//   - windowDays in subject preheader AND body intro sentence — POC needs
//     context about the review window without opening the portal
//   - CTA points at /analytics/portfolio (the portfolio view gives a
//     per-POC cross-location view); detail URLs per row link directly to
//     the individual kiosk
//
// Revenue formatting: the caller (cron / `weekly-poc-alerts.ts`) pre-formats
// revenue using the kiosk's OWN currency code (`Intl.NumberFormat('en-GB',
// { style: 'currency', currency: <ISO 4217> })`). The template renders
// whatever string arrives verbatim. Snapshot tests intentionally pass raw
// numerics to assert the rendered table layout regardless of locale.

export interface KioskRow {
  kioskId: string;
  locationName: string;
  region: string;
  revenue: number | string;
  percentile: number | string;
  detailUrl: string;
}

export interface PocUnderperformanceEmailProps {
  pocName: string;
  kiosks: KioskRow[];
  moreCount: number;
  windowDays: number;
  runIsoWeek: string;
  /**
   * Optional override for the "View portfolio" CTA. Falls back to
   * `${BRAND.prodUrl}/analytics/portfolio` when omitted. Mirrored on the
   * plain-text companion (`pocUnderperformanceText`) so HTML and text
   * variants always agree on the CTA target.
   */
  portfolioUrl?: string;
  /**
   * Emerging-tier cutoff in percentile points (e.g. 20 means kiosks
   * below the 20th percentile). Defaults to 10 only if the prop is
   * omitted — production callers always pass `tierConfig.bottom` so the
   * body copy stays aligned with the live admin-configured threshold.
   */
  bottomPercentile?: number;
}

export function PocUnderperformanceEmail({
  pocName,
  kiosks,
  moreCount,
  windowDays,
  runIsoWeek,
  portfolioUrl,
  bottomPercentile = 10,
}: PocUnderperformanceEmailProps) {
  const resolvedPortfolioUrl = portfolioUrl ?? `${BRAND.prodUrl}/analytics/portfolio`;

  return (
    <EmailLayout
      preheader={`${kiosks.length + moreCount} kiosk${kiosks.length + moreCount !== 1 ? "s" : ""} underperforming in the last ${windowDays} days — ${runIsoWeek}`}
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
        Underperforming kiosks — {runIsoWeek}
      </Heading>

      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: BRAND.textSecondary,
          margin: "0 0 18px",
        }}
      >
        Hi {pocName}, the following kiosks in your portfolio fell below the
        {" "}{bottomPercentile}th percentile over the last {windowDays} days.
      </Text>

      {/* Kiosk table */}
      <Section style={{ margin: "0 0 20px" }}>
        <table
          role="presentation"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          width="100%"
          style={{ width: "100%", borderCollapse: "collapse" }}
        >
          <thead>
            <tr>
              <th
                align="left"
                style={{
                  fontFamily: BRAND.fontStack,
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: BRAND.textMuted,
                  padding: "0 8px 8px 0",
                  borderBottom: `2px solid ${BRAND.divider}`,
                }}
              >
                Location
              </th>
              <th
                align="left"
                style={{
                  fontFamily: BRAND.fontStack,
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: BRAND.textMuted,
                  padding: "0 8px 8px",
                  borderBottom: `2px solid ${BRAND.divider}`,
                }}
              >
                Region
              </th>
              <th
                align="right"
                style={{
                  fontFamily: BRAND.fontStack,
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: BRAND.textMuted,
                  padding: "0 8px 8px",
                  borderBottom: `2px solid ${BRAND.divider}`,
                }}
              >
                Revenue
              </th>
              <th
                align="right"
                style={{
                  fontFamily: BRAND.fontStack,
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: BRAND.textMuted,
                  padding: "0 0 8px 8px",
                  borderBottom: `2px solid ${BRAND.divider}`,
                }}
              >
                Percentile
              </th>
            </tr>
          </thead>
          <tbody>
            {kiosks.map((k, i) => (
              <tr key={k.kioskId}>
                <td
                  style={{
                    fontFamily: BRAND.fontStack,
                    fontSize: "14px",
                    color: BRAND.graphite,
                    padding: `${i === 0 ? "12px" : "10px"} 8px 10px 0`,
                    borderBottom: `1px solid ${BRAND.divider}`,
                    lineHeight: 1.4,
                  }}
                >
                  <Link
                    href={k.detailUrl}
                    style={{
                      color: BRAND.azure,
                      textDecoration: "none",
                      fontWeight: 500,
                    }}
                  >
                    {k.locationName}
                  </Link>
                </td>
                <td
                  style={{
                    fontFamily: BRAND.fontStack,
                    fontSize: "14px",
                    color: BRAND.textSecondary,
                    padding: `${i === 0 ? "12px" : "10px"} 8px`,
                    borderBottom: `1px solid ${BRAND.divider}`,
                    lineHeight: 1.4,
                  }}
                >
                  {k.region}
                </td>
                <td
                  align="right"
                  style={{
                    fontFamily: BRAND.fontStack,
                    fontSize: "14px",
                    color: BRAND.graphite,
                    padding: `${i === 0 ? "12px" : "10px"} 8px`,
                    borderBottom: `1px solid ${BRAND.divider}`,
                    lineHeight: 1.4,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {k.revenue}
                </td>
                <td
                  align="right"
                  style={{
                    fontFamily: BRAND.fontStack,
                    fontSize: "14px",
                    color: BRAND.textSecondary,
                    padding: `${i === 0 ? "12px" : "10px"} 0 10px 8px`,
                    borderBottom: `1px solid ${BRAND.divider}`,
                    lineHeight: 1.4,
                  }}
                >
                  p{k.percentile}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {moreCount > 0 ? (
        <Text
          style={{
            fontSize: "13px",
            lineHeight: 1.5,
            color: BRAND.textMuted,
            margin: "-12px 0 20px",
            fontStyle: "italic",
          }}
        >
          … and {moreCount} more kiosks below the {bottomPercentile}th percentile —
          see full list in your portfolio.
        </Text>
      ) : null}

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
