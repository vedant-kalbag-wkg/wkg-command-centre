import { Button, Heading, Text } from "@react-email/components";

import { BRAND } from "./brand";
import { EmailLayout } from "./_layout";

// Phase 8 Plan 08-01 — Confirmation email for EMAIL-02 (D-11).
//
// Locked content per D-11 + Pitfall 7:
//   - Timestamp + "if this wasn't you, contact admin"
//   - NO request-metadata fields (no IP, no UA, no client fingerprint) —
//     privacy review trigger; the page-author must NOT add them here.
//
// `changedAt` is rendered as a pre-formatted string by the caller (Europe/London
// default per D-11; per-user TZ deferred to a future user-preference surface).
// `contactAdminUrl` is a mailto: of the prod admin OR an /admin deep-link.
export function PasswordChangedEmail({
  changedAt,
  contactAdminUrl,
}: {
  changedAt: string;
  contactAdminUrl: string;
}) {
  return (
    <EmailLayout preheader="Your WeKnow password was changed">
      <Heading
        as="h1"
        style={{
          fontSize: "24px",
          fontWeight: 600,
          color: BRAND.graphite,
          margin: "0 0 16px",
        }}
      >
        Your password was changed
      </Heading>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: "#333",
          margin: "0 0 16px",
        }}
      >
        Your WeKnow Command Centre password was changed on{" "}
        <strong>{changedAt}</strong>.
      </Text>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: "#333",
          margin: "0 0 24px",
        }}
      >
        {"If this wasn't you, please contact your administrator immediately."}
      </Text>
      <div style={{ margin: "24px 0" }}>
        <Button
          href={contactAdminUrl}
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
          Contact admin
        </Button>
      </div>
    </EmailLayout>
  );
}
