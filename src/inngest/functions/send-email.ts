import { render } from "@react-email/render";
import { sql } from "drizzle-orm";
import { Resend } from "resend";

import { db } from "@/db";
import { emailLog } from "@/db/schema";
import { PasswordChangedEmail } from "@/emails/password-changed";

import { inngest } from "../client";

// Phase 8 Plan 08-01 — Inngest function on `email/send.requested`.
//
// Three step boundaries (Pitfall 5 — step memoisation across retries):
//   1. render-html: pre-render the React template via @react-email/render
//      so JSX serialisation errors surface at OUR boundary (Pitfall 4)
//   2. resend-send: HTTP call to Resend; memoised on retry, so subsequent
//      step.run('log') failures will NOT resend
//   3. log: insert one email_log row with onConflictDoNothing on the
//      partial unique idx (kind, payload_hash) — D-06 + Pitfall 1
//
// retries: 5 — Inngest's exponential backoff handles transient Resend 5xx.

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM ?? "noreply@command.weknowgroup.com";

// Template dispatch — Phase 9 will extend with digest_*, kiosk_offline, etc.
const TEMPLATES = {
  "password-changed": PasswordChangedEmail,
} as const;

type TemplateKey = keyof typeof TEMPLATES;

// Minimal step interface — both Inngest's real step tools and the test
// shim satisfy this. Production calls receive Inngest's full StepTools.
type StepShim = {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
};

// Extracted handler so integration tests can call it directly with a
// step-shim (Inngest doesn't expose its internal handler on the
// InngestFunction instance). Underscore prefix signals "internal /
// test-only" access; production goes through `sendEmailFn` below.
export async function _handleSendEmail({
  event,
  step,
  runId,
}: {
  event: {
    data: {
      kind: string;
      to: string;
      subject: string;
      template: string;
      templateProps: Record<string, unknown>;
      payloadHash?: string;
    };
  };
  step: StepShim;
  runId: string;
}): Promise<void> {
  const { kind, to, subject, template, templateProps, payloadHash } =
    event.data;

  const { html, text } = await step.run("render-html", async () => {
    const Component = TEMPLATES[template as TemplateKey];
    if (!Component) {
      throw new Error(`Unknown email template: ${template}`);
    }
    const element = Component(templateProps as Parameters<typeof Component>[0]);
    // render() is async in @react-email/render v2+. `await` is harmless
    // even if the resolved value is a string in older versions.
    const html = await render(element);
    const text = await render(element, { plainText: true });
    return { html, text };
  });

  const sendResult = await step.run("resend-send", async () => {
    return await resend.emails.send({ from: FROM, to, subject, html, text });
  });

  await step.run("log", async () => {
    await db
      .insert(emailLog)
      .values({
        kind,
        recipient: to,
        resendMessageId: sendResult.data?.id ?? null,
        inngestRunId: runId,
        status: sendResult.error ? "failed" : "sent",
        lastError: sendResult.error
          ? String(sendResult.error.message ?? sendResult.error)
          : null,
        payloadHash: payloadHash ?? null,
      })
      .onConflictDoNothing({
        target: [emailLog.kind, emailLog.payloadHash],
        // Partial-index predicate must be re-stated in ON CONFLICT for
        // Postgres to match the partial unique idx (migration 0041
        // Delta 2). Auth-flow sends with payloadHash=null don't match
        // this predicate, so they bypass the upsert path entirely.
        where: sql`payload_hash IS NOT NULL`,
      });
  });

  if (sendResult.error) {
    // Throwing → Inngest retries with exponential backoff up to retries: 5.
    throw new Error(String(sendResult.error.message ?? sendResult.error));
  }
}

export const sendEmailFn = inngest.createFunction(
  {
    id: "send-email",
    name: "Send Email",
    retries: 5,
    triggers: [{ event: "email/send.requested" }],
  },
  async ({ event, step, runId }) => {
    // Inngest's production step has a richer Jsonify-wrapped return type,
    // but at runtime is StepShim-compatible — the cast to unknown is a
    // deliberate narrowing for the shared-handler split.
    await _handleSendEmail({
      event: event as unknown as Parameters<typeof _handleSendEmail>[0]["event"],
      step: step as unknown as StepShim,
      runId,
    });
  },
);
