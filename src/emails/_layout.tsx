import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

import { BRAND } from "./brand";

// Phase 8 Plan 08-01 — Shared react-email layout used by every transactional
// template. Inline styles ONLY (Gmail strips <style> blocks — RESEARCH § Pitfall 4).
//
// Header lockup approximation of the WeKnow brand wordmark when no hosted
// PNG/SVG is available: "WeKnow" in Bold with -0.04em letter-spacing
// (the brand's -10 Bold-kerning rule), paired with an Azure period accent
// rendered as a square swatch beside the wordmark — the same
// "wordmark + brand-colour dot" lockup the brand uses in mono-positive
// print collateral.
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
          backgroundColor: BRAND.surfaceMuted,
          fontFamily: BRAND.fontStack,
          color: BRAND.textPrimary,
          margin: 0,
          padding: 0,
          WebkitTextSizeAdjust: "100%",
        }}
      >
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            padding: "32px 16px",
          }}
        >
          <Section
            style={{
              backgroundColor: BRAND.white,
              borderRadius: "12px",
              border: `1px solid ${BRAND.divider}`,
              padding: "40px 40px 32px",
            }}
          >
            <Section style={{ marginBottom: "32px" }}>
              <table cellPadding={0} cellSpacing={0} role="presentation">
                <tbody>
                  <tr>
                    <td
                      style={{
                        fontSize: "22px",
                        fontWeight: 700,
                        letterSpacing: "-0.04em",
                        color: BRAND.graphite,
                        lineHeight: 1,
                        paddingRight: "6px",
                      }}
                    >
                      WeKnow
                    </td>
                    <td
                      style={{
                        verticalAlign: "bottom",
                        paddingBottom: "3px",
                        lineHeight: 0,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: "8px",
                          height: "8px",
                          backgroundColor: BRAND.azure,
                          borderRadius: "1px",
                        }}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            {children}
          </Section>

          <Section style={{ padding: "20px 8px 0" }}>
            <Text
              style={{
                fontSize: "12px",
                color: BRAND.textMuted,
                margin: "0 0 6px",
                lineHeight: 1.5,
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
            <Hr
              style={{
                borderTop: `1px solid ${BRAND.divider}`,
                margin: "10px 0",
              }}
            />
            <Text
              style={{
                fontSize: "11px",
                color: BRAND.textMuted,
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              {BRAND.legalLine}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
