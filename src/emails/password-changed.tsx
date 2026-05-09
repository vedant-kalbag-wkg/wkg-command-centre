import { Heading, Section, Text } from "@react-email/components";

import { BRAND } from "./brand";
import { CTA } from "./_cta";
import { EmailLayout } from "./_layout";

// Phase 8 Plan 08-01 — Confirmation email for EMAIL-02 (D-11).
//
// Locked content per D-11 + Pitfall 7:
//   - Timestamp + "if this wasn't you, contact admin"
//   - NO request-metadata fields (no IP, no UA, no client fingerprint) —
//     privacy review trigger; future authors must NOT add them here.
//
// `changedAt` is rendered as a pre-formatted string by the caller
// (Europe/London default per D-11). `contactAdminUrl` is a mailto: of
// the prod admin OR an /admin deep-link.
//
// Refreshed 2026-05-09 to use bulletproof <CTA> + a tinted "info" panel
// to make the timestamp visually scannable.
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
          fontWeight: 700,
          letterSpacing: "-0.01em",
          color: BRAND.graphite,
          margin: "0 0 14px",
          lineHeight: 1.2,
        }}
      >
        Your password was changed
      </Heading>
      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: BRAND.textSecondary,
          margin: "0 0 18px",
        }}
      >
        The password on your {BRAND.productName} account was just updated.
      </Text>

      <Section
        style={{
          backgroundColor: BRAND.azure20,
          borderLeft: `3px solid ${BRAND.azure}`,
          borderRadius: "6px",
          padding: "14px 16px",
          margin: "0 0 24px",
        }}
      >
        <Text
          style={{
            fontSize: "13px",
            lineHeight: 1.5,
            color: BRAND.textMuted,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            fontWeight: 600,
          }}
        >
          Changed at
        </Text>
        <Text
          style={{
            fontSize: "15px",
            lineHeight: 1.4,
            color: BRAND.graphite,
            margin: "2px 0 0",
            fontWeight: 600,
          }}
        >
          {changedAt}
        </Text>
      </Section>

      <Text
        style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: BRAND.textSecondary,
          margin: "0 0 14px",
        }}
      >
        If this wasn&apos;t you, please contact your administrator
        immediately so they can review and lock the account.
      </Text>

      <CTA
        href={contactAdminUrl}
        label="Contact admin"
        fallbackPrefix="Or contact your admin via:"
      />
    </EmailLayout>
  );
}
