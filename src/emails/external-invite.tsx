import { Button, Heading, Text } from "@react-email/components";

import { BRAND } from "./brand";
import { EmailLayout } from "./_layout";

// Phase 8 Plan 08-01 — External-portal invite template (replaces
// sendExternalInviteEmail body in src/lib/email.ts:79-98). Prop name is
// `setPasswordUrl` (NOT `resetUrl`) — locked by email.ts:81-85.
// Copy verbatim from email.ts:86-95.
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
          fontWeight: 600,
          color: BRAND.graphite,
          margin: "0 0 16px",
        }}
      >
        Welcome to WeKnow Analytics
      </Heading>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: "#333",
          margin: "0 0 12px",
        }}
      >
        {"You've been invited to the WeKnow Analytics Portal, where you can view performance analytics for your locations."}
      </Text>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: "#333",
          margin: "0 0 24px",
        }}
      >
        Click below to set your password and access your dashboard:
      </Text>
      <div style={{ margin: "24px 0" }}>
        <Button
          href={setPasswordUrl}
          style={{
            display: "inline-block",
            padding: "12px 24px",
            backgroundColor: BRAND.azure,
            color: BRAND.white,
            textDecoration: "none",
            borderRadius: "6px",
            fontWeight: 500,
            fontSize: "15px",
          }}
        >
          Set your password
        </Button>
      </div>
      <Text
        style={{
          fontSize: "13px",
          color: "#666",
          marginTop: "32px",
        }}
      >
        {"Once you've set your password, you can sign in at any time to view your analytics."}
      </Text>
    </EmailLayout>
  );
}
