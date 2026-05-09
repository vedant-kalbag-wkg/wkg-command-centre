import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { Resend } from "resend";

import { db } from "@/db";
import { emailLog } from "@/db/schema";
import { ExternalInviteEmail } from "@/emails/external-invite";
import { InviteEmail } from "@/emails/invite";
import { PasswordResetEmail } from "@/emails/password-reset";
import {
  externalInviteText,
  inviteText,
  passwordResetText,
} from "@/emails/text-versions";

// Phase 8 Plan 08-01 — Resend HTTP transport replaces the now-deleted SMTP
// transport (silently failing in prod against localhost:1025). Auth-flow
// emails (D-03) call Resend SYNCHRONOUSLY inside the request handler — zero
// queue latency on invite/reset/external-invite. The Inngest substrate is
// reserved for digests / notifications / reports (D-05).
//
// Every send writes one row to email_log (D-06) regardless of outcome.
// payloadHash is null for auth-flow sends (no idempotency dedupe — every
// reset is intentional). On Resend non-2xx the function throws so Better
// Auth surfaces the failure to the UI (D-04).
//
// 2026-05-09 round 3: hand-crafted plain-text bodies (text-versions.ts)
// replace the auto-generated `render(el, { plainText: true })` form. The
// auto-generated text inlined the long Better Auth reset URL twice and
// duplicated the footer link — clients that surface the text/plain part
// (some Outlook desktop configurations) saw a noisy [URL]Label dump.

// Lazy-init: the Resend constructor throws if RESEND_API_KEY is unset,
// which broke unrelated unit tests (rbac, etc.) that transitively import
// auth.ts → email.ts. Defer construction to first send so module-load is
// side-effect-free and only code paths that actually send mail need the key.
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
const FROM = process.env.EMAIL_FROM ?? "noreply@command.weknowgroup.com";
const REPLY_TO = process.env.EMAIL_REPLY_TO || undefined;

type Kind = "password_reset" | "invite" | "external_invite";

async function send({
  to,
  subject,
  react,
  text,
  kind,
}: {
  to: string;
  subject: string;
  react: ReactElement;
  text: string;
  kind: Kind;
}): Promise<void> {
  const html = await render(react);

  const result = await getResend().emails.send({
    from: FROM,
    to,
    subject,
    html,
    text,
    ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
  });
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
    text: passwordResetText(resetUrl),
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
    text: inviteText(resetUrl),
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
    text: externalInviteText(setPasswordUrl),
    kind: "external_invite",
  });
}
