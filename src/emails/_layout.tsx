import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

import { BRAND } from "./brand";

// Phase 8 Plan 08-01 — Shared react-email layout used by every transactional
// template. Mirrors the visual structure of the now-deleted buildBrandedEmail
// helper from src/lib/email.ts (max-width 560px, 40px padding, WK text-mark).
// Inline styles ONLY — Gmail strips <style> blocks (RESEARCH § Pitfall 4).
export function EmailLayout({
  children,
  preheader,
}: {
  children: ReactNode;
  preheader?: string;
}) {
  return (
    <Html>
      <Head />
      {preheader ? <Preview>{preheader}</Preview> : null}
      <Body
        style={{
          backgroundColor: BRAND.white,
          fontFamily: BRAND.fontStack,
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            padding: "40px 20px",
          }}
        >
          <div style={{ marginBottom: "32px" }}>
            <span
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: BRAND.graphite,
                letterSpacing: "-0.01em",
              }}
            >
              WK
            </span>
          </div>
          {children}
          <Hr
            style={{
              borderTop: "1px solid #E5E7EB",
              margin: "32px 0 16px",
            }}
          />
          <Text
            style={{
              fontSize: "12px",
              color: "#666",
              margin: 0,
            }}
          >
            {BRAND.productName} ·{" "}
            <Link
              href={BRAND.prodUrl}
              style={{ color: BRAND.azure, textDecoration: "none" }}
            >
              {BRAND.prodUrl.replace(/^https:\/\//, "")}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
