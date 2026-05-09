# Phase 8: Email Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 08-email-infrastructure
**Areas discussed:** Sending domain & EMAIL_FROM, Auth-flow email transport, Branded template substrate, Change-password confirmation content

---

## Gray-area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Sending domain & EMAIL_FROM | weknowgroup.com vs weknow.co vs subdomain. Drives DNS work + brand alignment + deliverability isolation. | ✓ |
| Auth-flow email transport | Forgot-password / invite / external-invite — sync Resend vs Inngest queue vs hybrid. | ✓ |
| Branded template substrate | Inline HTML vs @react-email/components vs plain HTML files. | ✓ |
| Change-password confirmation content | Timestamp + contact-admin vs +IP+UA vs +IP-only vs no email. | ✓ |

---

## Sending domain & EMAIL_FROM

| Option | Description | Selected |
|--------|-------------|----------|
| Subdomain of weknowgroup.com | e.g. mail.weknowgroup.com — best-practice transactional isolation; SPF/DKIM/DMARC scoped to subdomain only. | ✓ |
| Root weknowgroup.com | noreply@weknowgroup.com — simple brand alignment, but transactional reputation shared with corporate root. | |
| Root weknow.co | noreply@weknow.co — matches existing code default but contradicts WeKnow Group brand domain. | |
| Subdomain of weknow.co | e.g. mail.weknow.co — isolation argument applied to secondary brand domain. | |

**User's choice:** Subdomain of weknowgroup.com.

### Subdomain label

| Option | Description | Selected |
|--------|-------------|----------|
| mail.weknowgroup.com / noreply@ | Generic, conventional, room for transactional + future marketing. | |
| notify.weknowgroup.com / noreply@ | Reads as 'notification', clearly transactional-only forever. | |
| command.weknowgroup.com / noreply@ | Matches product name 'WeKnow Command Centre'. | ✓ |
| Planner picks | Defer to planner. | |

**User's choice:** `noreply@command.weknowgroup.com`. Aligns with the prod product name "WeKnow Command Centre" + prod URL `wkg-command-centre.vercel.app`.

---

## Auth-flow email transport

| Option | Description | Selected |
|--------|-------------|----------|
| Always via Inngest | Auth handler fires inngest.send; worker calls Resend with retry. Single substrate, retry semantics, queue latency added to invite/reset. | |
| Sync Resend in handler | Auth handler awaits resend.emails.send directly; Inngest reserved for digests/notifications. Zero queue latency, simplest path; transient 5xx is silent drop with status='failed' in email_log. | ✓ |
| Hybrid — sync first, Inngest fallback | Try sync, queue on failure. Best UX + safety, two code paths. | |

**User's choice:** Sync Resend in handler. Establishes the rule: **sync for auth-related emails, async/Inngest for everything else** (digests, notifications, scheduled reports, alerts).

---

## Branded template substrate

| Option | Description | Selected |
|--------|-------------|----------|
| @react-email/components | React components, typed props, previewable via react-email dev server, diff-friendly. Adds 2 deps. | ✓ |
| Inline HTML strings | Status quo (buildBrandedEmail). Zero new deps, hardest to preview, brittle for richer Phase 9 bodies. | |
| Plain HTML files in src/emails/ | Mustache-style placeholders. Simple, no JSX, no preview pipeline, no type-safety. | |

**User's choice:** @react-email/components. Specifically chosen because Phase 9 NOTIF/REPORT will compose richer bodies (region-grouped digests, lists of changed kiosks); inline strings are a dead-end for that work.

---

## Change-password confirmation content

| Option | Description | Selected |
|--------|-------------|----------|
| Timestamp + 'contact admin' | Subject 'Your WeKnow password was changed', time + 'if you didn't do this, contact admin'. No IP, no UA. Smallest PII. | ✓ |
| Timestamp + IP + browser | + IP + UA from request headers. Stronger signal, more PII in email_log + UX-disclosure burden. | |
| Timestamp + IP only | Middle ground — IP useful, UA spoofable. | |
| No confirmation email | Skip entirely; rely on UI toast + audit_log. | |

**User's choice:** Timestamp + 'contact admin'. Internal audience (~30 users) where admin verification is the failover; PII surface kept minimal. Trade-off explicitly captured in CONTEXT.md D-11 for future privacy/security review.

---

## Wrap-up question

| Option | Description | Selected |
|--------|-------------|----------|
| Write CONTEXT.md now | All four areas decided; remaining open questions flow to planner discretion. | ✓ |
| One more area — local dev email path | MailHog shim vs always Resend test key. | |
| One more area — EMAIL-03 UAT scope | Spec bar exactly vs broader (EMAIL-02 confirmation + external-invite). | |

**User's choice:** Write now.

---

## Claude's Discretion

- Local-dev email transport (MailHog shim gated on RESEND_API_KEY presence vs require Resend test key per dev). Default to MailHog shim if undecided.
- Exact `email_log` migration column shape (types, JSON vs text for last_error).
- Whether EMAIL-02 password-change confirmation rides Inngest (substrate exercise) or sync Resend (consistent rule).
- Subject lines, copy, CTA wording across templates (subject to WeKnow brand voice).
- React-email preview port + Playwright preview-screenshot pipeline integration.
- DMARC policy starting value (p=none ramp-up vs p=quarantine immediate).
- /account/security page layout, password-strength meter, form-validation copy.
- Whether email_log gets an admin UI in Phase 8 (probably defer to Phase 11).
- Inngest function file layout (research-doc sketch is the strawman).

## Deferred Ideas

- **Brevo as live fallback** — documented-only per locked decision; `docs/email-fallback-brevo.md` ships in Phase 8 but no implementation switch.
- **Phase 7 DATA-03 same-name email digest** — gated on EMAIL-04 substrate; ships under Phase 9 (or Phase 7 owner wires it directly once EMAIL-04 lands).
- **In-app notification bell** — out of scope for v1.1 per REQUIREMENTS; defer to v1.2.
- **Email-log admin UI** — defer to Phase 11 polish if operators ask.
- **Per-user TZ rendering** — confirmation timestamps hardcoded to Europe/London until user-preference surface exists.
- **Password-strength meter + breach-check** — defer to v1.2 if user-base broadens.
- **Marketing / non-transactional sending domain** — `command.weknowgroup.com` is transactional-only; marketing gets its own subdomain if ever scoped.
- **Roadmap housekeeping** — `.planning/ROADMAP.md` (commit `1a0d6a7`) lives only on `docs/architecture-and-azure-hosting`; port to phase-branch line before v1.1 close-out merge.
