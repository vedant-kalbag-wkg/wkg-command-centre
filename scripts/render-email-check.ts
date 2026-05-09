import { render } from "@react-email/render";
import { PasswordResetEmail } from "../src/emails/password-reset";
import { InviteEmail } from "../src/emails/invite";
import { ExternalInviteEmail } from "../src/emails/external-invite";
import { PasswordChangedEmail } from "../src/emails/password-changed";

const URL = "https://example.test/reset?token=ABCDEF12345-very-long";
async function main() {
  const html = await render(PasswordResetEmail({ resetUrl: URL }));
  console.log("password-reset href count:", (html.match(/href="https:\/\/example\.test\/reset\?token=/g) || []).length);
  console.log("password-reset has 'Reset password' label:", html.includes(">Reset password</a>"));
  console.log("---");
  const inviteHtml = await render(InviteEmail({ resetUrl: URL }));
  console.log("invite href count:", (inviteHtml.match(/href="https:\/\/example\.test/g) || []).length);
  const extHtml = await render(ExternalInviteEmail({ setPasswordUrl: URL }));
  console.log("external-invite href count:", (extHtml.match(/href="https:\/\/example\.test/g) || []).length);
  const pcHtml = await render(PasswordChangedEmail({ changedAt: "9 May 2026 06:30 BST", contactAdminUrl: "mailto:admin@x.com" }));
  console.log("password-changed has 'WeKnow' wordmark:", pcHtml.includes(">WeKnow</td>"));
  console.log("password-changed has changedAt visible:", pcHtml.includes("9 May 2026 06:30 BST"));
}
main().catch(e => { console.error(e); process.exit(1); });
