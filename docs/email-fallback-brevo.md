# Email transport fallback: Brevo

**Status:** documented-only fallback per **D-13** in `.planning/phases/08-email-infrastructure/08-CONTEXT.md`. **No Brevo code ships in v1.1.** This runbook is the "if/when we ever flip" guide so a future engineer does not need to re-derive the migration plan under deliverability pressure.

The active provider in v1.1 is **Resend** (D-13, locked at v1.0 close 2026-04-29; memory `email_provider_decision.md`). The substrate built in Phase 8 (`src/lib/email.ts`, `src/inngest/functions/send-email.ts`, `src/db/schema.ts:emailLog`) is Resend-shaped. Brevo is named here because it was the explicit fallback at v1.0-close — Brevo's free tier (300/day ≈ 9,000/month at that date) is strictly larger than Resend's free tier (3,000/month, 100/day) and Brevo runs EU infra so the GDPR posture is preserved on flip.

## When to flip

Trigger conditions (any one is sufficient — flip is a deliberate operator decision, not an automated failover):

1. **Resend deliverability degradation.** Sustained > 5% bounce rate over 7 days; sustained > 1% spam-complaint rate; or Resend's domain dashboard shows `command.weknowgroup.com` in `suspended` / `under-review` state. Inspect Resend dashboard at <https://resend.com/domains>.
2. **Resend pricing change.** Free-tier ceiling falls below ~3k/mo, or paid-tier minimum rises beyond what the v1.1 internal volume justifies (~30 users → ~900 sends/mo worst case in v1.1 invite + reset + change-confirm; Phase 9 digests + reports will push higher).
3. **Resend EU-region outage > 4 hours.** Brevo also operates EU infra; switching restores delivery without GDPR re-review.
4. **Account-level lockout.** Resend disables the WeKnow account for any reason; Brevo is the immediately-available alternative the v1.0-close decision (2026-04-29) explicitly named.

## What flipping requires

The Phase 8 substrate is Resend-shaped:

- `src/lib/email.ts` imports `Resend` from `"resend"` and calls `resend.emails.send({ from, to, subject, react })` for the three locked auth-flow functions (`sendPasswordResetEmail`, `sendInviteEmail`, `sendExternalInviteEmail`).
- `src/inngest/functions/send-email.ts` imports `Resend` and calls `resend.emails.send({ from, to, subject, html })` from the `resend-send` step boundary inside `_handleSendEmail`.
- `src/db/schema.ts` has a `resend_message_id` column on `email_log`. The semantic name is provider-named; the column type is `text` so any provider's id format fits.

To flip to Brevo:

1. **Install** `@getbrevo/brevo` (or whatever the current SDK is at flip-time; verify via `npm view @getbrevo/brevo version`). Use the `linux/amd64` Docker recipe from `CLAUDE.md` § "npm ci lockfile must stay in sync" to regenerate `package-lock.json` — the same wasm32-wasi platform-skew rule that bit Phase 8's resend/inngest/react-email install will bite this one.
2. **Add an env-driven switch:** introduce `EMAIL_PROVIDER=resend|brevo` (default `resend`; setting `EMAIL_PROVIDER=brevo` activates the Brevo branch). Set this on Vercel preview + prod. Do NOT hardcode the provider in source.
3. **Refactor** `src/lib/email.ts` and `src/inngest/functions/send-email.ts` to dispatch on `process.env.EMAIL_PROVIDER`. Each exported function keeps its **signature byte-identical** (the same constraint Phase 8 maintained when swapping nodemailer → Resend); the body branches:
   ```text
   if (process.env.EMAIL_PROVIDER === "brevo") {
     // Brevo SDK call (see SDK shape below)
   } else {
     // Resend SDK call (current behaviour)
   }
   ```
   The Better Auth wiring at `src/lib/auth.ts:13-24` is untouched — that contract is locked across providers.
4. **Rename** the column or add a sibling. Either rename `email_log.resend_message_id` → `email_log.provider_message_id` via a Drizzle migration (recommended; `email_log` is audit-only and a one-off rename is cheaper than carrying two columns), OR add `email_log.brevo_message_id` and write whichever one matches the active provider. Update the `emailLog` table definition in `src/db/schema.ts` to match.
5. **DNS records.** Brevo issues different SPF / DKIM CNAMEs than Resend. The flip plan must:
   - **(a) Add Brevo's records to `command.weknowgroup.com` ALONGSIDE Resend's during the cutover** so both providers' domains verify in their respective dashboards.
   - **(b) Flip `EMAIL_PROVIDER=brevo` in Vercel.** Trigger a redeploy.
   - **(c) Wait for in-flight Resend sends to drain** (Inngest queue + any sync auth-flow sends already initiated). Watch the Resend dashboard for the last successful send timestamp.
   - **(d) Remove Resend's DKIM CNAME after a 7-day quiet period.** Keep Resend's SPF include for at least the same window in case rollback is needed.
6. **Rollback path.** If Brevo introduces a regression, flip `EMAIL_PROVIDER=resend` in Vercel. The Resend records still in DNS during the cutover window (step 5(d)) take effect immediately. If Resend records were already removed, expect a 24-48h DNS-cache lag before deliverability is restored — this is exactly why step 5(d) waits 7 days before pruning. Document the rollback decision in `.planning/STATE.md` Decisions section.

## What flipping does NOT require

- **No change to Better Auth wiring.** `src/lib/auth.ts:13-24` calls into the three locked email functions; their bodies branch internally on `EMAIL_PROVIDER` so the auth handler is untouched.
- **No change to react-email templates.** `@react-email/render` produces HTML strings that any HTTP email API accepts — Brevo's `sendSmtpEmail.htmlContent` field consumes the rendered HTML directly.
- **No change to Inngest substrate.** The `email/send.requested` event shape (`src/inngest/events.ts`) is provider-agnostic; only `_handleSendEmail`'s `resend-send` step body branches.
- **No change to `email_log` schema beyond the message-id column** (per step 4 above). The unique partial index on `(kind, payload_hash) WHERE payload_hash IS NOT NULL` is provider-independent.
- **No change to `EMAIL_FROM` env var.** `noreply@command.weknowgroup.com` works against both providers once their respective DKIM CNAMEs verify on the same subdomain.

## Brevo SDK shape (research notes — verify at flip-time)

Verified at v1.0 close (2026-04-29). Re-verify the SDK shape at flip-time; npm packages drift.

`@getbrevo/brevo` exposes a class-instance API rather than the namespaced-static API of `resend`. Approximate shape (do NOT paste real keys here — reference the env var only):

```text
const apiInstance = new TransactionalEmailsApi();
apiInstance.setApiKey(TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
const sendSmtpEmail = new SendSmtpEmail();
sendSmtpEmail.subject = "...";
sendSmtpEmail.htmlContent = "...";  // pass the @react-email/render output here
sendSmtpEmail.sender = { email: "noreply@command.weknowgroup.com", name: "WeKnow" };
sendSmtpEmail.to = [{ email: "user@example.com" }];
const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
// response.body.messageId is the Brevo equivalent of resendMessageId; persist into provider_message_id column.
```

Sender-domain verification in Brevo's dashboard is a separate step (Senders & IP → Domains). The DKIM CNAME Brevo issues is at `mail._domainkey.command.weknowgroup.com` (verify at flip-time — the host name has changed before).

## Rate limits / quota notes (snapshot at v1.0 close, 2026-04-29 — re-verify at flip-time)

- **Resend free tier:** 3,000 sends / month; 100 / day. v1.1 internal volume (~30 users × invite + reset + change-confirm) tops out around ~900 sends/month worst case.
- **Brevo free tier:** 300 sends / day (~9,000 / month) — strictly more than Resend free. Comfortably covers a fallback period without paid-tier scramble.
- **Both providers** rate-limit per second; expect ~10/sec for transactional sends. Phase 9 digests batch send so per-second is not the limiting factor; daily quota is.

## Aftercare

- After the flip stabilises, update `.planning/phases/08-email-infrastructure/08-CONTEXT.md` D-13 status from "documented-only fallback" → "active provider; Resend documented-only fallback". Mirror the change in `.planning/STATE.md` § Decisions.
- Update `.env.example` to swap which provider's env vars are the documented defaults. Keep both blocks; comment out the inactive one.
- Update memory entry `email_provider_decision.md` (`~/.claude/projects/.../memory/`) so future sessions reflect the active provider.
- Update the prod admin onboarding doc (if/when written) to reference the active provider's dashboard for diagnosing send failures.

## Reference

- v1.0-close decision (2026-04-29): "Resend primary, Brevo fallback documented" (`MILESTONES.md`, memory `email_provider_decision.md`).
- Source spec: `tasks/v2-carryover-from-v1-phase-6.md` § V2-EMAIL-01 fix-path step 6.
- D-13 in `.planning/phases/08-email-infrastructure/08-CONTEXT.md` — Brevo locked as documented-only.
- DNS / DKIM operator runbook for Resend (the equivalent flow Brevo will need): `.planning/phases/08-email-infrastructure/08-03-SUMMARY.md` § "DNS records added".
