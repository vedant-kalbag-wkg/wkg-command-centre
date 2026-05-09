import { Link, Section, Text } from "@react-email/components";

import { BRAND } from "./brand";

// Phase 8 Plan 08-01 — Bulletproof CTA component used by every template.
//
// react-email's <Button> renders to a complex VML/table-based hack for
// Outlook compatibility. In some clients (or when Resend's internal
// renderer is bypassed) the CTA can collapse into a long URL line that
// reads "click here" but renders the raw href instead — the failure
// shape that turned up in 08-UAT 2026-05-09.
//
// This helper renders TWO clickable elements:
//   1. a styled <a> button (block-level, large hit-target, brand-azure
//      background, white text)
//   2. a plain "Or copy and paste this link:" fallback below it where
//      the URL itself is a clickable <a> — guarantees a working link
//      even if the button styling is stripped.
//
// Outlook (Windows desktop) doesn't render rounded corners on `<a>`.
// We accept that visual fallback rather than introducing VML — the
// button still works, just appears rectangular.
export function CTA({
  href,
  label,
  fallbackPrefix = "Or paste this link in your browser:",
}: {
  href: string;
  label: string;
  fallbackPrefix?: string;
}) {
  return (
    <Section>
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={{
          margin: "8px 0 18px",
          borderCollapse: "separate",
        }}
      >
        <tbody>
          <tr>
            <td
              style={{
                backgroundColor: BRAND.azure,
                borderRadius: "8px",
                padding: "0",
              }}
            >
              <Link
                href={href}
                style={{
                  display: "inline-block",
                  padding: "13px 28px",
                  color: BRAND.white,
                  fontSize: "15px",
                  fontWeight: 600,
                  letterSpacing: "0.01em",
                  textDecoration: "none",
                  borderRadius: "8px",
                }}
              >
                {label}
              </Link>
            </td>
          </tr>
        </tbody>
      </table>

      <Text
        style={{
          fontSize: "12px",
          lineHeight: 1.6,
          color: BRAND.textMuted,
          margin: "16px 0 0",
        }}
      >
        {fallbackPrefix}
        <br />
        <Link
          href={href}
          style={{
            color: BRAND.azure,
            textDecoration: "underline",
            wordBreak: "break-all",
          }}
        >
          {href}
        </Link>
      </Text>
    </Section>
  );
}
