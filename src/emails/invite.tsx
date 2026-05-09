import { Heading, Text } from "@react-email/components";

import { BRAND } from "./brand";
import { CTA } from "./_cta";
import { EmailLayout } from "./_layout";

// Phase 8 Plan 08-01 — Internal-invite template (replaces sendInviteEmail
// body in src/lib/email.ts). Separate file from external-invite because
// src/lib/auth.ts already branches on `isInvite && userType === "external"`.
// Refreshed 2026-05-09 to use the bulletproof <CTA> helper after 08-UAT
// surfaced raw-URL rendering on the prior <Button> path.
export function InviteEmail({ resetUrl }: { resetUrl: string }) {
  return (
    <EmailLayout preheader="You're invited to WeKnow Command Centre">
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
        You&apos;re invited to WeKnow
      </Heading>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: BRAND.textSecondary,
          margin: "0 0 12px",
        }}
      >
        You&apos;ve been added to {BRAND.productName} — the operations and
        IT team&apos;s single tool for tracking, planning, and reporting on
        every kiosk deployment.
      </Text>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: BRAND.textSecondary,
          margin: "0 0 22px",
        }}
      >
        Set your password and sign in to get started.
      </Text>

      <CTA href={resetUrl} label="Set your password" />

      <Text
        style={{
          fontSize: "13px",
          lineHeight: 1.6,
          color: BRAND.textMuted,
          margin: "24px 0 0",
        }}
      >
        This invitation link expires in 1 hour. If it has already expired,
        ask your admin to send a fresh invite.
      </Text>
    </EmailLayout>
  );
}
