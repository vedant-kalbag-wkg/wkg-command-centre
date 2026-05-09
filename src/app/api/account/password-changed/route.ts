import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { emailLog } from "@/db/schema";
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

// Hardcoded operator deployment — fallback only. Admin contact email is
// overridable via ADMIN_SUPPORT_EMAIL so a change of address doesn't
// require a code deploy.
const ADMIN_SUPPORT_EMAIL =
  process.env.ADMIN_SUPPORT_EMAIL ?? "vedant.kalbag@weknowgroup.com";

// T-08.02-01 mitigation: per-recipient cooldown to stop an authenticated
// session from spamming the inbox by repeatedly POSTing this route. Querying
// `email_log` is cheaper than a separate rate-limit store and uses state
// already written by the Inngest send-email step. 30s is long enough to
// catch double-clicks and replay loops, short enough that a legitimate
// rotate-then-rotate-again sequence isn't blocked.
const PASSWORD_CHANGED_COOLDOWN_MS = 30_000;

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const recent = await db
    .select({ createdAt: emailLog.createdAt })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.kind, "password_changed"),
        eq(emailLog.recipient, session.user.email),
      ),
    )
    .orderBy(desc(emailLog.createdAt))
    .limit(1);

  if (
    recent[0] &&
    Date.now() - recent[0].createdAt.getTime() < PASSWORD_CHANGED_COOLDOWN_MS
  ) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  await inngest.send({
    name: "email/send.requested",
    data: {
      kind: "password_changed",
      to: session.user.email,
      subject: "Your WeKnow password was changed",
      template: "password-changed",
      templateProps: {
        // Server-rendered timestamp in Europe/London (ops/admin tz, not the
        // user's locale) so the same string appears in the audit log and the
        // email body. If multi-tz support lands later, switch to ISO-8601 and
        // format client-side.
        changedAt: new Date().toLocaleString("en-GB", {
          timeZone: "Europe/London",
        }),
        contactAdminUrl: `mailto:${ADMIN_SUPPORT_EMAIL}`,
      },
    },
  });

  return NextResponse.json({ ok: true });
}
