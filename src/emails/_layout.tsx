import {
  Body,
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
// template. Inline styles ONLY (Gmail strips <style> blocks — RESEARCH § Pitfall 4).
//
// Layout is pure-table for Outlook desktop (Word HTML engine):
//   - Outer 100%-width <table> = page background
//   - Inner fixed 560-px <table> = content card
//   - Header lockup uses a nested <table> for the "WeKnow + Azure dot"
//     side-by-side composition
//
// Outlook-only CSS goes inside <Head> as a `<style>` block scoped with
// `<!--[if mso]>` so non-Outlook clients ignore it.
//
// 2026-05-09 fixes after first round of inbox UAT:
//   - Outlook desktop now renders (was a wall of unstyled HTML)
//   - removed `border-radius` on the outer card (Outlook ignores;
//     squared corners read correctly across all clients)
//   - all spacing uses table cellpadding + line-height (no margin
//     collapse surprises in Word's renderer)
export function EmailLayout({
  children,
  preheader,
}: {
  children: ReactNode;
  preheader?: string;
}) {
  // Outlook-only CSS: forces font fallback + correct line-height
  // calculation in Word's renderer.
  const msoCss = `
    <!--[if mso]>
    <style type="text/css">
      table { border-collapse: collapse; }
      td, th { mso-line-height-rule: exactly; }
      .mso-fallback-font { font-family: Arial, Helvetica, sans-serif !important; }
    </style>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
    <![endif]-->
  `;

  return (
    <Html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="x-apple-disable-message-reformatting" content="" />
        <span dangerouslySetInnerHTML={{ __html: msoCss }} />
      </Head>
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
        <table
          role="presentation"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          width="100%"
          style={{
            backgroundColor: BRAND.surfaceMuted,
            margin: 0,
            padding: 0,
          }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: "32px 16px" }}>
                <table
                  role="presentation"
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  width="560"
                  style={{ width: "560px", maxWidth: "100%" }}
                >
                  <tbody>
                    <tr>
                      <td
                        style={{
                          backgroundColor: BRAND.white,
                          border: `1px solid ${BRAND.divider}`,
                          padding: "40px 40px 32px",
                        }}
                      >
                        <table
                          role="presentation"
                          cellPadding={0}
                          cellSpacing={0}
                          border={0}
                          style={{ marginBottom: "28px" }}
                        >
                          <tbody>
                            <tr>
                              <td
                                style={{
                                  fontFamily: BRAND.fontStack,
                                  fontSize: "22px",
                                  fontWeight: 700,
                                  letterSpacing: "-0.04em",
                                  color: BRAND.graphite,
                                  lineHeight: "22px",
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
                                  fontSize: 0,
                                }}
                              >
                                <span
                                  style={{
                                    display: "inline-block",
                                    width: "8px",
                                    height: "8px",
                                    backgroundColor: BRAND.azure,
                                  }}
                                />
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        {children}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "20px 8px 0" }}>
                        <Text
                          style={{
                            fontFamily: BRAND.fontStack,
                            fontSize: "12px",
                            color: BRAND.textMuted,
                            margin: "0 0 6px",
                            lineHeight: 1.5,
                          }}
                        >
                          {BRAND.productName} ·{" "}
                          <Link
                            href={BRAND.prodUrl}
                            style={{
                              color: BRAND.azure,
                              textDecoration: "none",
                            }}
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
                            fontFamily: BRAND.fontStack,
                            fontSize: "11px",
                            color: BRAND.textMuted,
                            margin: 0,
                            lineHeight: 1.5,
                          }}
                        >
                          {BRAND.legalLine}
                        </Text>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}
