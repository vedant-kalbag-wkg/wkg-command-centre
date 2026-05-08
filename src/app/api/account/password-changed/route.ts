import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { inngest } from "@/inngest/client";
import { auth } from "@/lib/auth";

// Phase 8 Plan 08-02 — Confirmation-email trigger for /account/security
// (EMAIL-02 + EMAIL-04 substrate exercise per RESEARCH § Pattern 4 lines
// 489-492; D-09 + D-11).
//
// Wire shape:
//   1. Re-fetch the session via Better Auth's signed cookie. The form has
//      already called authClient.changePassword (which mutates the password
//      via Better Auth's signed handler) — this route handler ONLY enqueues
//      the confirmation email. A stolen short-lived session calling this
//      endpoint without a real password change can fire a confirmation email
//      but cannot rotate the password (T-08.02-01 — informational only).
//   2. inngest.send → plan 08-01's sendEmailFn picks up the event, renders
//      the password-changed template, calls Resend, writes one email_log row.
//
// D-11 + Pitfall 7 + T-08.02-04: templateProps MUST contain ONLY
// `changedAt` and `contactAdminUrl`. NO IP, NO User-Agent, NO browser
// fingerprint, NO request-header echoing. Adding such fields would create
// a privacy-review surface and break the unit test.
//
// Spelling: "unauthorised" (British) matches the project's existing
// convention; UI copy and error messages elsewhere in the codebase use
// British spelling.
export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  await inngest.send({
    name: "email/send.requested",
    data: {
      kind: "password_changed",
      to: session.user.email,
      subject: "Your WeKnow password was changed",
      template: "password-changed",
      templateProps: {
        changedAt: new Date().toLocaleString("en-GB", {
          timeZone: "Europe/London",
        }),
        contactAdminUrl: "mailto:vedant.kalbag@weknowgroup.com",
      },
    },
  });

  return NextResponse.json({ ok: true });
}
