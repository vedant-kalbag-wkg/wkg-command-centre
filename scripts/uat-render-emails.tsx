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
      kiosks: [
        {
          kioskId: "demo-kiosk-1",
          locationName: "The Strand Hotel — Lobby",
          region: "London",
          revenue: 1420.5,
          percentile: 4,
          detailUrl: "https://wkg-command-centre.vercel.app/kiosks/demo-kiosk-1",
        },
        {
          kioskId: "demo-kiosk-2",
          locationName: "Manchester Central",
          region: "Manchester",
          revenue: 980.0,
          percentile: 6,
          detailUrl: "https://wkg-command-centre.vercel.app/kiosks/demo-kiosk-2",
        },
      ],
      moreCount: 1,
      windowDays: 30,
      runIsoWeek: "2026-W19",
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
