import { Link, Section, Text } from "@react-email/components";
import type * as React from "react";

import { BRAND } from "./brand";

// Phase 8 Plan 08-01 — Single bulletproof CTA component shared by every
// transactional template.
//
// Structure (Outlook-safe pattern from Litmus / Email on Acid):
//   <table>
//     <tr>
//       <td bgcolor="..." style="padding:13px 28px;border-radius:8px;">
//         <a href="...">LABEL</a>
//       </td>
//     </tr>
//   </table>
//
// The `<td>` carries `bgcolor=` (legacy HTML attribute Outlook honours)
// AND `style="background-color:...;padding:..."`. The `<a>` is plain
// white bold text — Outlook ignores `padding` on `<a>` but honours it
// on `<td>`, so the button shape comes from the cell.
//
// 2026-05-09 round-3 fixes after operator UAT in Outlook desktop:
//   - VML `<v:roundrect>` removed — only ever needed when the styled
//     `<a>` couldn't render the button shape, but the `<td>`-based
//     pattern below renders consistently in Outlook 2007+ without it.
//
// 2026-05-09 round-4: fallback shows the full URL again (operator UX).
// The "click here instead" label was redundant — both anchors went to
// the same href, and copying out of the email was impossible. The
// earlier URL-rendering bug was traced to a literal `\n` suffix on the
// `BETTER_AUTH_URL` Vercel env var (not URL length); env was cleaned
// 2026-05-09. With a clean URL the displayed link renders fine in
// Outlook desktop, and `overflowWrap:anywhere` lets long URLs soft-wrap
// without inserting visible whitespace at the break point.
//   - mailto: hrefs use a different fallback prompt: "If the button
//     doesn't work, email <displayed address> directly." — so the
//     password-changed template still surfaces the contact address
//     in text form for any client that strips the styled button.
export function CTA({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  const isMailto = href.startsWith("mailto:");
  const fallback = isMailto ? (
    <>
      If the button doesn&apos;t work, email{" "}
      <Link
        href={href}
        style={{ color: BRAND.azure, textDecoration: "underline" }}
      >
        {href.replace(/^mailto:/, "")}
      </Link>{" "}
      directly.
    </>
  ) : (
    <>
      If the button doesn&apos;t work, copy and paste this link into your
      browser:
      <br />
      <Link
        href={href}
        style={{
          color: BRAND.azure,
          textDecoration: "underline",
          overflowWrap: "anywhere",
        }}
      >
        {href}
      </Link>
    </>
  );

  return (
    <Section>
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={
          {
            margin: "8px 0 18px",
            borderCollapse: "separate",
            msoTableLspace: "0pt",
            msoTableRspace: "0pt",
          } as React.CSSProperties
        }
      >
        <tbody>
          <tr>
            <td
              {...({ bgcolor: BRAND.azure } as Record<string, string>)}
              align="center"
              style={{
                backgroundColor: BRAND.azure,
                borderRadius: "8px",
                padding: "13px 28px",
              }}
            >
              <Link
                href={href}
                style={{
                  color: BRAND.white,
                  fontFamily: BRAND.fontStack,
                  fontSize: "15px",
                  fontWeight: 700,
                  textDecoration: "none",
                  lineHeight: 1,
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
        {fallback}
      </Text>
    </Section>
  );
}
