// Hand-crafted plain-text versions of every transactional template.
//
// Outlook desktop in plain-text-preferred mode (and several Outlook 365
// reading-pane configurations) display only the multipart text/plain
// body. The auto-generated `await render(el, { plainText: true })` form
// is functional but reads as a literal HTML-to-text dump — long URLs
// pasted next to button labels, footer-link duplication, etc.
//
// These hand-crafted versions are what the operator sees in any client
// that surfaces text/plain. Keep them short, single-CTA, and never
// include the URL twice.

import { BRAND } from "./brand";

const FOOTER = "—\nWeKnow Group · Confidential, internal use only";

export function passwordResetText(resetUrl: string): string {
  return [
    "Reset your password",
    "",
    "We received a request to reset the password on your WeKnow Command Centre account.",
    "",
    "Open the link below to choose a new password:",
    resetUrl,
    "",
    "This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email — your current password won't change.",
    "",
    FOOTER,
  ].join("\n");
}

export function inviteText(resetUrl: string): string {
  return [
    "You're invited to WeKnow",
    "",
    "You've been added to the WeKnow Command Centre — the operations and IT team's tool for tracking, planning, and reporting on every kiosk deployment.",
    "",
    "Set your password and sign in to get started:",
    resetUrl,
    "",
    "This invitation link expires in 1 hour. If it has already expired, ask your admin to send a fresh invite.",
    "",
    FOOTER,
  ].join("\n");
}

export function externalInviteText(setPasswordUrl: string): string {
  return [
    "Welcome to WeKnow Analytics",
    "",
    "You've been invited to the WeKnow Analytics Portal, where you can view performance analytics for your locations.",
    "",
    "Set your password to access your dashboard:",
    setPasswordUrl,
    "",
    `Once your password is set, you can sign in any time at ${BRAND.prodUrl}`,
    "",
    FOOTER,
  ].join("\n");
}

export function passwordChangedText({
  changedAt,
  contactAdminEmail,
}: {
  changedAt: string;
  contactAdminEmail: string;
}): string {
  return [
    "Your WeKnow password was changed",
    "",
    `The password on your WeKnow Command Centre account was just updated.`,
    "",
    `Changed at: ${changedAt}`,
    "",
    `If this wasn't you, please contact your administrator immediately so they can review and lock the account: ${contactAdminEmail}`,
    "",
    FOOTER,
  ].join("\n");
}

// Phase 9 (hotel-level rewrite) — Plain-text companion for
// PocUnderperformanceEmail.
//
// Avoids auto-generated render(el, { plainText: true }) which produces
// [URL]Label-style output unreadable in plain-text Outlook configurations.
// The `portfolioUrl` is rendered once at the bottom as the sole CTA link.
//
// Mirrors the hotel-level HTML template: per-hotel block with composite
// score, regional/scale meta, sales summary, and 5 sub-metric percentiles,
// followed by a sticky weights footnote.
export function pocUnderperformanceText({
  pocName,
  hotels,
  moreCount,
  windowDays,
  runIsoWeek,
  portfolioUrl,
  bottomPercentile = 20,
  weights = { revenue: 0.3, transactions: 0.2, revenuePerRoom: 0.25, txnPerKiosk: 0.15, basketValue: 0.1 },
}: {
  pocName: string;
  hotels: Array<{
    locationId: string;
    hotelName: string;
    region: string;
    currency: string;
    totalRevenue: number | string;
    totalTransactions: number;
    kioskCount: number;
    numRooms: number | null;
    salesPerRoom: string | null;
    compositeScore: number;
    subMetricPercentiles: {
      revenue: number;
      transactions: number;
      revenuePerRoom: number | null;
      txnPerKiosk: number;
      basketValue: number;
    };
    detailUrl: string;
  }>;
  moreCount: number;
  windowDays: number;
  runIsoWeek: string;
  portfolioUrl: string;
  /** Bottom-tier composite-score cutoff (0-100); mirrors the HTML template. */
  bottomPercentile?: number;
  /** Composite-score weights for the sticky footnote. */
  weights?: {
    revenue: number;
    transactions: number;
    revenuePerRoom: number;
    txnPerKiosk: number;
    basketValue: number;
  };
}): string {
  const pct = (n: number | null): string => (n === null ? "—" : `p${n}`);

  const hotelLines = hotels.flatMap((h) => {
    const meta = `${h.region} · ${h.kioskCount} kiosk${h.kioskCount === 1 ? "" : "s"} · ${h.numRooms === null ? "rooms unknown" : `${h.numRooms} rooms`}`;
    const sales = `${h.totalRevenue} sales · ${h.salesPerRoom === null ? "—" : `${h.salesPerRoom}/room`} · ${h.totalTransactions} txn${h.totalTransactions === 1 ? "" : "s"}`;
    const subPct = `rev ${pct(h.subMetricPercentiles.revenue)} · txn ${pct(h.subMetricPercentiles.transactions)} · /room ${pct(h.subMetricPercentiles.revenuePerRoom)} · /kiosk ${pct(h.subMetricPercentiles.txnPerKiosk)} · basket ${pct(h.subMetricPercentiles.basketValue)}`;
    return [
      `  - ${h.hotelName} | Composite: ${h.compositeScore}/100`,
      `    ${meta}`,
      `    ${sales}`,
      `    ${subPct}`,
      `    ${h.detailUrl}`,
      "",
    ];
  });

  const moreNote =
    moreCount > 0
      ? [`… and ${moreCount} more hotel${moreCount === 1 ? "" : "s"} flagged below the ${bottomPercentile}/100 cutoff — see your portfolio for the full list.`, ""]
      : [];

  const weightsLine = `Composite score = revenue ${Math.round(weights.revenue * 100)}% · transactions ${Math.round(weights.transactions * 100)}% · revenue/room ${Math.round(weights.revenuePerRoom * 100)}% · txn/kiosk ${Math.round(weights.txnPerKiosk * 100)}% · basket value ${Math.round(weights.basketValue * 100)}%.`;

  return [
    `Underperforming hotels — ${runIsoWeek}`,
    "",
    `Hi ${pocName}, the following hotels in your portfolio scored at or below ${bottomPercentile}/100 on the composite performance score over the last ${windowDays} days:`,
    "",
    ...hotelLines,
    ...moreNote,
    weightsLine,
    "Each metric is ranked by percentile across all WeKnow hotels in this window.",
    "",
    "Review your portfolio to investigate and take action:",
    portfolioUrl,
    "",
    FOOTER,
  ].join("\n");
}
