import { Button, Heading, Text } from "@react-email/components";

import { BRAND } from "./brand";
import { EmailLayout } from "./_layout";

// Phase 8 Plan 08-01 — Internal-invite template (replaces sendInviteEmail
// body in src/lib/email.ts:58-77). Separate file from external-invite
// because src/lib/auth.ts:13-24 already branches on
// `isInvite && userType === "external"`. Copy verbatim from email.ts:65-76.
export function InviteEmail({ resetUrl }: { resetUrl: string }) {
  return (
    <EmailLayout preheader="You're invited to WeKnow Command Centre">
      <Heading
        as="h1"
        style={{
          fontSize: "24px",
          fontWeight: 600,
          color: BRAND.graphite,
          margin: "0 0 16px",
        }}
      >
        {"You're invited to WeKnow"}
      </Heading>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: "#333",
          margin: "0 0 12px",
        }}
      >
        {"You've been invited to the WeKnow Command Centre."}
      </Text>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: "#333",
          margin: "0 0 24px",
        }}
      >
        Click below to set your password and get started:
      </Text>
      <div style={{ margin: "24px 0" }}>
        <Button
          href={resetUrl}
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
        This link expires in 1 hour.
      </Text>
    </EmailLayout>
  );
}
