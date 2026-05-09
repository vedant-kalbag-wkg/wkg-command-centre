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
