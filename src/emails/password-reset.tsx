import { Heading, Text } from "@react-email/components";

import { BRAND } from "./brand";
import { CTA } from "./_cta";
import { EmailLayout } from "./_layout";

// Phase 8 Plan 08-01 — react-email template replacing the inline body in
// sendPasswordResetEmail. Subject ("Reset your password — WeKnow") is
// preserved from the locked contract; body copy refreshed 2026-05-09
// alongside the bulletproof <CTA> swap (08-UAT feedback: original
// <Button> rendered the raw URL in some clients).
export function PasswordResetEmail({ resetUrl }: { resetUrl: string }) {
  return (
    <EmailLayout preheader="Reset your WeKnow password">
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
        Reset your password
      </Heading>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: BRAND.textSecondary,
          margin: "0 0 22px",
        }}
      >
        We received a request to reset the password on your{" "}
        {BRAND.productName} account. Click the button below to choose a new
        one.
      </Text>

      <CTA href={resetUrl} label="Reset password" />

      <Text
        style={{
          fontSize: "13px",
          lineHeight: 1.6,
          color: BRAND.textMuted,
          margin: "24px 0 0",
        }}
      >
        This link expires in 1 hour. If you didn&apos;t request a password
        reset, you can safely ignore this email — your current password
        won&apos;t change.
      </Text>
    </EmailLayout>
  );
}
