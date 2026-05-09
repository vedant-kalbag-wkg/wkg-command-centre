import { Heading, Text } from "@react-email/components";

import { BRAND } from "./brand";
import { CTA } from "./_cta";
import { EmailLayout } from "./_layout";

// Phase 8 Plan 08-01 — External-portal invite template. Prop name is
// `setPasswordUrl` (NOT `resetUrl`) — locked by sendExternalInviteEmail's
// signature. Refreshed 2026-05-09 to use the bulletproof <CTA> helper.
export function ExternalInviteEmail({
  setPasswordUrl,
}: {
  setPasswordUrl: string;
}) {
  return (
    <EmailLayout preheader="Welcome to WeKnow Analytics">
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
        Welcome to WeKnow Analytics
      </Heading>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: BRAND.textSecondary,
          margin: "0 0 12px",
        }}
      >
        You&apos;ve been invited to the WeKnow Analytics Portal, where you
        can view performance analytics for your locations.
      </Text>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: BRAND.textSecondary,
          margin: "0 0 22px",
        }}
      >
        Set your password and you&apos;ll be taken to your dashboard.
      </Text>

      <CTA href={setPasswordUrl} label="Set your password" />

      <Text
        style={{
          fontSize: "13px",
          lineHeight: 1.6,
          color: BRAND.textMuted,
          margin: "24px 0 0",
        }}
      >
        Once your password is set, you can sign in any time at{" "}
        {BRAND.prodUrl.replace(/^https:\/\//, "")} to view your analytics.
      </Text>
    </EmailLayout>
  );
}
