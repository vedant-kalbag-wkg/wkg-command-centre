import { Link, Section, Text } from "@react-email/components";
import type * as React from "react";

import { BRAND } from "./brand";

// Phase 8 Plan 08-01 — Bulletproof CTA component used by every template.
//
// Two clickable elements per CTA:
//   1. A styled pill button — `<a>` for modern clients, paired with a
//      <!--[if mso]> VML rectangle <![endif]--> block so Outlook desktop
//      (Word's HTML engine) gets a properly-shaped, full-width-padded
//      brand-azure button instead of stripped padding + bare blue text.
//   2. A "Or paste this link" fallback line. The displayed text is
//      friendly: mailto: URLs show as the bare email address, http(s)
//      URLs show as-is. No `word-break: break-all` — that produced
//      visible whitespace at wrap points in Outlook desktop. Email
//      clients now wrap naturally; the URL is still a single clickable
//      anchor with no leading/trailing whitespace.
//
// Outlook test note: VML must include `arcsize` for rounded corners,
// and `<v:textbox>` with `mso-fit-shape-to-text:true` so the box hugs
// the label without manual width arithmetic.
export function CTA({
  href,
  label,
  fallbackPrefix,
}: {
  href: string;
  label: string;
  fallbackPrefix?: string;
}) {
  const isMailto = href.startsWith("mailto:");
  const displayUrl = isMailto ? href.replace(/^mailto:/, "") : href;
  const prefix = fallbackPrefix ?? (isMailto ? "Or email:" : "Or paste this link in your browser:");

  // VML markup is raw — react-email passes <!-- comments --> through
  // unchanged. Width 240/height 46 picks up most CTA labels without
  // truncation; longer labels can override via wider VML.
  const vmlOpen =
    `<!--[if mso]>` +
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"` +
    ` href="${href}" style="height:46px;v-text-anchor:middle;width:240px;" arcsize="17%"` +
    ` stroke="f" fillcolor="${BRAND.azure}">` +
    `<w:anchorlock/>` +
    `<center style="color:${BRAND.white};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;">` +
    `${label}` +
    `</center>` +
    `</v:roundrect>` +
    `<![endif]-->`;
  const vmlClose = `<!--[if !mso]><!-->`;
  const vmlEnd = `<!--<![endif]-->`;

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
            <td>
              {/* Outlook (mso) gets the VML rectangle; everything else
                  falls through to the styled <a>. */}
              <span
                dangerouslySetInnerHTML={{
                  __html: `${vmlOpen}${vmlClose}`,
                }}
              />
              <Link
                href={href}
                // `mso-hide:all` keeps the styled <a> hidden in Outlook
                // desktop (Word) — the VML rectangle above is what Outlook
                // shows. CSSProperties type doesn't include MSO-prefixed
                // keys so we cast the partial object.
                style={
                  {
                    backgroundColor: BRAND.azure,
                    display: "inline-block",
                    padding: "13px 28px",
                    color: BRAND.white,
                    fontSize: "15px",
                    fontWeight: 600,
                    letterSpacing: "0.01em",
                    textDecoration: "none",
                    borderRadius: "8px",
                    msoHide: "all",
                  } as React.CSSProperties
                }
              >
                {label}
              </Link>
              <span dangerouslySetInnerHTML={{ __html: vmlEnd }} />
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
        {prefix}
        <br />
        <Link
          href={href}
          style={{
            color: BRAND.azure,
            textDecoration: "underline",
            overflowWrap: "anywhere",
          }}
        >
          {displayUrl}
        </Link>
      </Text>
    </Section>
  );
}
