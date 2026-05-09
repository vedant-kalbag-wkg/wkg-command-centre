import { writeFileSync, mkdirSync } from "fs";
import { render } from "@react-email/render";
import { PasswordResetEmail } from "../src/emails/password-reset";
import { InviteEmail } from "../src/emails/invite";
import { ExternalInviteEmail } from "../src/emails/external-invite";
import { PasswordChangedEmail } from "../src/emails/password-changed";

mkdirSync(".email-preview", { recursive: true });
const URL = "https://wkg-command-centre-git-gsd-p-35ae54-vedant-kalbag-wkgs-projects.vercel.app/set-password?token=abc123def456";

async function main() {
  writeFileSync(".email-preview/password-reset.html", await render(PasswordResetEmail({ resetUrl: URL })));
  writeFileSync(".email-preview/invite.html", await render(InviteEmail({ resetUrl: URL })));
  writeFileSync(".email-preview/external-invite.html", await render(ExternalInviteEmail({ setPasswordUrl: URL })));
  writeFileSync(".email-preview/password-changed.html", await render(PasswordChangedEmail({ changedAt: "9 May 2026, 06:30 BST", contactAdminUrl: "mailto:vedant.kalbag@weknowgroup.com" })));
  console.log("Wrote 4 preview files to .email-preview/");
}
main().catch(e => { console.error(e); process.exit(1); });
