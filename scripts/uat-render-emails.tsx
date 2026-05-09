// One-off UAT helper: render all transactional templates to /tmp/uat-emails/*.html
// for visual review (08-HUMAN-UAT § 9). Not committed anywhere production reads.
import { writeFileSync } from "node:fs";
import { render } from "@react-email/render";

import { ExternalInviteEmail } from "../src/emails/external-invite";
import { InviteEmail } from "../src/emails/invite";
import { PasswordChangedEmail } from "../src/emails/password-changed";
import { PasswordResetEmail } from "../src/emails/password-reset";
import { PocUnderperformanceEmail } from "../src/emails/poc-underperformance";

const out = "/tmp/uat-emails";
const fixtures = [
  {
    name: "password-reset",
    el: PasswordResetEmail({
      resetUrl:
        "https://wkg-command-centre-git-gsd-p-01eb46-vedant-kalbag-wkgs-projects.vercel.app/reset-password?token=demo",
    }),
  },
  {
    name: "invite",
    el: InviteEmail({
      resetUrl:
        "https://wkg-command-centre-git-gsd-p-01eb46-vedant-kalbag-wkgs-projects.vercel.app/set-password?token=demo",
    }),
  },
  {
    name: "external-invite",
    el: ExternalInviteEmail({
      setPasswordUrl:
        "https://wkg-command-centre-git-gsd-p-01eb46-vedant-kalbag-wkgs-projects.vercel.app/set-password?token=demo",
    }),
  },
  {
    name: "password-changed",
    el: PasswordChangedEmail({
      changedAt: "9 May 2026, 14:00 UTC",
      contactAdminUrl: "https://wkg-command-centre.vercel.app/account/security",
    }),
  },
  {
    name: "poc-underperformance",
    el: PocUnderperformanceEmail({
      pocName: "Vedant Kalbag",
      hotels: [
        {
          locationId: "demo-loc-1",
          hotelName: "The Strand Hotel",
          region: "London",
          currency: "GBP",
          totalRevenue: "£1,420.50",
          totalTransactions: 87,
          kioskCount: 2,
          numRooms: 180,
          salesPerRoom: "£7.89",
          compositeScore: 12,
          subMetricPercentiles: {
            revenue: 8,
            transactions: 14,
            revenuePerRoom: 6,
            txnPerKiosk: 18,
            basketValue: 22,
          },
          detailUrl: "https://wkg-command-centre.vercel.app/locations/demo-loc-1",
        },
        {
          locationId: "demo-loc-2",
          hotelName: "Manchester Central",
          region: "Manchester",
          currency: "GBP",
          totalRevenue: "£980.00",
          totalTransactions: 54,
          kioskCount: 1,
          numRooms: null,
          salesPerRoom: null,
          compositeScore: 18,
          subMetricPercentiles: {
            revenue: 15,
            transactions: 19,
            revenuePerRoom: null,
            txnPerKiosk: 22,
            basketValue: 16,
          },
          detailUrl: "https://wkg-command-centre.vercel.app/locations/demo-loc-2",
        },
      ],
      moreCount: 1,
      windowDays: 30,
      runIsoWeek: "2026-W19",
      bottomPercentile: 20,
      weights: {
        revenue: 0.3,
        transactions: 0.2,
        revenuePerRoom: 0.25,
        txnPerKiosk: 0.15,
        basketValue: 0.1,
      },
    }),
  },
];

async function main() {
  for (const f of fixtures) {
    const html = await render(f.el);
    writeFileSync(`${out}/${f.name}.html`, html);
    console.log(`wrote ${out}/${f.name}.html (${html.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
