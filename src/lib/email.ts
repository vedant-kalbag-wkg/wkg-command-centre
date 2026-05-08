import type { ReactElement } from "react";
import { Resend } from "resend";

import { db } from "@/db";
import { emailLog } from "@/db/schema";
import { ExternalInviteEmail } from "@/emails/external-invite";
import { InviteEmail } from "@/emails/invite";
import { PasswordResetEmail } from "@/emails/password-reset";

// Phase 8 Plan 08-01 — Resend HTTP transport replaces the now-deleted SMTP
// transport (silently failing in prod against localhost:1025). Auth-flow
// emails (D-03) call Resend SYNCHRONOUSLY inside the request handler — zero
// queue latency on invite/reset/external-invite. The Inngest substrate is
// reserved for digests / notifications / reports (D-05).
//
// Every send writes one row to email_log (D-06) regardless of outcome;
// payloadHash is null for auth-flow sends (no idempotency dedupe — every
// reset is intentional). On Resend non-2xx the function throws so Better
// Auth surfaces the failure to the UI (D-04).

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM ?? "noreply@command.weknowgroup.com";

type Kind = "password_reset" | "invite" | "external_invite";

async function send({
  to,
  subject,
  react,
  kind,
}: {
  to: string;
  subject: string;
  react: ReactElement;
  kind: Kind;
}): Promise<void> {
  const result = await resend.emails.send({ from: FROM, to, subject, react });
  const messageId = result.data?.id ?? null;
  // Pitfall 6: store error.message plain text — a text column with full
  // stringified-error blobs is unindexable + breaks queries.
  const errorMsg = result.error
    ? String(result.error.message ?? result.error)
    : null;

  await db.insert(emailLog).values({
    kind,
    recipient: to,
    resendMessageId: messageId,
    inngestRunId: null,
    status: errorMsg ? "failed" : "sent",
    lastError: errorMsg,
    payloadHash: null,
  });

  if (errorMsg) {
    // D-04: surface failure to UI via Better Auth's error pipeline.
    throw new Error(`Email send failed: ${errorMsg}`);
  }
}

export async function sendPasswordResetEmail({
  to,
  resetUrl,
}: {
  to: string;
  resetUrl: string;
}): Promise<void> {
  await send({
    to,
    subject: "Reset your password — WeKnow",
    react: PasswordResetEmail({ resetUrl }),
    kind: "password_reset",
  });
}

export async function sendInviteEmail({
  to,
  resetUrl,
}: {
  to: string;
  resetUrl: string;
}): Promise<void> {
  await send({
    to,
    subject: "You're invited to WeKnow — Set your password",
    react: InviteEmail({ resetUrl }),
    kind: "invite",
  });
}

export async function sendExternalInviteEmail({
  to,
  setPasswordUrl,
}: {
  to: string;
  setPasswordUrl: string;
}): Promise<void> {
  await send({
    to,
    subject: "Welcome to WeKnow Analytics — Set your password",
    react: ExternalInviteEmail({ setPasswordUrl }),
    kind: "external_invite",
  });
}
