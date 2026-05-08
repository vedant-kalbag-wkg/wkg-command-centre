import { Button, Heading, Text } from "@react-email/components";

import { BRAND } from "./brand";
import { EmailLayout } from "./_layout";

// Phase 8 Plan 08-01 — react-email template replacing the inline body in
// sendPasswordResetEmail. Subject ("Reset your password — WeKnow") and copy
// preserved verbatim from src/lib/email.ts:44-55 (D-09 deletes the helper
// but does not change wording).
export function PasswordResetEmail({ resetUrl }: { resetUrl: string }) {
  return (
    <EmailLayout preheader="Reset your WeKnow password">
      <Heading
        as="h1"
        style={{
          fontSize: "24px",
          fontWeight: 600,
          color: BRAND.graphite,
          margin: "0 0 16px",
        }}
      >
        Reset your password
      </Heading>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: "#333",
          margin: "0 0 24px",
        }}
      >
        Click below to reset your password:
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
          Reset password
        </Button>
      </div>
      <Text
        style={{
          fontSize: "13px",
          color: "#666",
          marginTop: "32px",
        }}
      >
        {"This link expires in 1 hour. If you didn't request this, ignore this email."}
      </Text>
    </EmailLayout>
  );
}
