# Phase 8: Email Infrastructure - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace nodemailer's silent-fail SMTP transport with a working Resend-backed
email substrate, ship a self-serve change-password UI at `/account/security`
with a confirmation email, prove forgot-password works end-to-end against
prod via UAT, and stand up the Inngest send/retry substrate + branded
WeKnow templates + thin `email_log` audit table that downstream phases
(Phase 9 NOTIF/REPORT) will consume. Requirements: EMAIL-01..04.

Out of scope (other phases):
- Per-user notifications & admin offline alerts → Phase 9 (NOTIF-01/02)
- Scheduled / custom report templates → Phase 9 (REPORT-05/06)
- RBAC tier rules / custom granular roles → Phase 10
- Same-name guardrail email digest (gated on this substrate) — its UI surface ships in Phase 7; the email digest itself becomes a Phase 9 consumer of EMAIL-04 once notifications land
- In-app notification bell — explicitly deferred to v1.2 per REQUIREMENTS § Out of Scope

</domain>

<decisions>
## Implementation Decisions

### Sending domain & EMAIL_FROM (EMAIL-01)
- **D-01:** Use a **subdomain of `weknowgroup.com`** for transactional sending, not the root domain or the secondary `weknow.co` brand. Subdomain isolation: a Resend deliverability incident on transactional mail does not burn the corporate root-domain reputation. SPF/DKIM/DMARC scoped to the subdomain only.
- **D-02:** Specific subdomain + mailbox: **`noreply@command.weknowgroup.com`**. Aligns with the prod product name "WeKnow Command Centre" (`https://wkg-command-centre.vercel.app`). DNS records (SPF, DKIM CNAME from Resend, DMARC `p=quarantine`) added to the `command.weknowgroup.com` zone. `EMAIL_FROM` env var becomes `noreply@command.weknowgroup.com` in Vercel prod + preview. The legacy `noreply@weknow.co` default in `src/lib/email.ts` is replaced.

### Auth-flow email transport (EMAIL-01)
- **D-03:** Auth-flow emails (`sendPasswordResetEmail`, `sendInviteEmail`, `sendExternalInviteEmail`) call **Resend synchronously inside the request handler**, NOT through Inngest. Rationale: zero queue latency on invite/reset/external-invite (user-visible UX), no Inngest dependency on the auth-critical path, simplest code shape. Trade-off accepted: a transient Resend 5xx during these flows is recorded as `status='failed'` in `email_log` and the user must retry the action.
- **D-04:** UI surfaces send failure to the user — do NOT silently log + pretend success. The "email sent" toast / inline state on `/login` (forgot-password) and `/admin/users` (invite) reflects the actual Resend response. If Resend returned non-2xx, the UI shows a "couldn't send email — try again" state. Planner picks the exact copy + retry affordance.
- **D-05:** Inngest is reserved for **digests, notifications, and reports** (Phase 9 consumers + same-name digest). Auth-flow emails do NOT ride the Inngest queue. EMAIL-04's substrate ships in this phase but its first paying consumer is Phase 9 — Phase 8 ships at least one Inngest function (the send/retry primitive itself, exercised by EMAIL-02's change-password confirmation if we route it through Inngest, or as a stub validated by tests if we don't).
- **D-06:** **`email_log` is written for every send**, regardless of transport (sync Resend or Inngest). Schema per `.planning/research/v1.1-email-queue.md`: `id`, `kind`, `recipient`, `resend_message_id`, `inngest_run_id` (NULL for sync sends), `status`, `last_error`, `payload_hash`, `created_at`. Unique idx on `(kind, payload_hash)` for digest idempotency; auth-flow sends populate `payload_hash = NULL` (no idempotency dedupe — every reset is intentional).

### Branded template substrate (EMAIL-04)
- **D-07:** Email templates as **React components built on `@react-email/components`**. Each template (`PasswordReset`, `Invite`, `ExternalInvite`, `PasswordChangedConfirmation`, plus stubs for the future Phase 9 `OfflineAlert`, `StatusChangeDigest`, `ScheduledReport`) lives in `src/emails/` as a `.tsx` file. Rendered to HTML via `@react-email/render` at send time. Brand tokens (Azure `#00A6D3`, Graphite `#121212`, font-stack fallback) extracted to a shared `src/emails/brand.ts`.
- **D-08:** Add `react-email` (CLI/dev server) and `@react-email/components` as deps. Include a `npm run email:dev` script wired to `react-email dev` so designers / engineers can preview templates locally on `http://localhost:3001` (or whatever port the CLI defaults to). Lockfile regen via the `linux/amd64` Docker recipe in `CLAUDE.md` is mandatory for this dep addition.
- **D-09:** The existing inline-HTML `buildBrandedEmail` helper in `src/lib/email.ts` is **deleted** when the migration lands — not kept as a fallback. The three exported functions (`sendPasswordResetEmail` / `sendInviteEmail` / `sendExternalInviteEmail`) keep their signatures (locked at scoping) but their bodies switch to render the corresponding React-email component.

### Change-password UI + confirmation (EMAIL-02)
- **D-10:** New route at `src/app/(app)/account/security/page.tsx`. Form with current-password + new-password + confirm fields. Submit calls Better Auth's `authClient.changePassword({ currentPassword, newPassword })`. Success → toast + send confirmation email. Failure → inline error from Better Auth (wrong current password / weak new password / etc.).
- **D-11:** Confirmation email content = **timestamp + "if this wasn't you, contact admin"**. Subject: `"Your WeKnow password was changed"`. Body: change time (rendered in Europe/London by default; planner picks whether to localise per-user later), single CTA "Contact admin" linking to `mailto:` of the prod admin OR a `/admin` deep-link if applicable. **No IP, no UA, no browser fingerprint** — internal audience (~30 users) has admin verification fallback; smaller PII surface in `email_log`. Decision is a deliberate trade-off documented here so a future privacy review can find the rationale.
- **D-12:** The `/account` route group does NOT exist yet. Phase 8 scaffolds it minimally — a `layout.tsx` that hosts `/account/security` (and only that route for v1.1; future tabs like `/account/notifications` for Phase 9 land later). Keep the scaffold thin: do NOT add tabs or sidebar nav for routes that don't yet exist.

### EMAIL-03 UAT scope
- **D-13:** EMAIL-03 UAT bar is exactly the spec wording: **invite throwaway user → click link → set password → sign in**, executed against the Vercel preview URL with `BETTER_AUTH_URL` pinned to the git-branch alias per `CLAUDE.md`. The change-password confirmation (EMAIL-02) and external-invite paths are validated separately via Playwright + a manual smoke test in this phase but are NOT part of EMAIL-03's prod-deliverability gate.
- **D-14:** UAT is operator-driven, not Claude-driven (this is the inverse of Phase 7 D-12). Reason: EMAIL-03 specifically tests deliverability — emails landing in a real inbox the operator owns. Claude can verify the request side (email API call returned 2xx, `email_log` row inserted, Resend dashboard shows the send) but only the operator can confirm the email actually arrived.

### Claude's Discretion
- Local-dev email transport: keep a `localhost:1025` MailHog shim gated on `RESEND_API_KEY` presence vs. require every dev to use a Resend test key. Planner picks based on what minimises onboarding friction; default to MailHog shim if undecided.
- Exact `email_log` migration shape (column types, default values, JSON vs. text for `last_error`).
- Whether to route EMAIL-02's password-change confirmation through Inngest (substrate exercise) or sync Resend (consistent with auth-flow rule). Argument for Inngest: confirmation isn't on the critical path, exercising the substrate in this phase reduces Phase 9 risk. Argument for sync: keeps "sync for auth-related, async for everything else" as a single rule.
- Exact subject lines, copy, and CTA wording across templates (subject to WeKnow brand voice in `~/.claude/weknow-brand-guidelines.md` per CLAUDE.md).
- React-email preview port + whether to wire it into the Playwright preview screenshot pipeline.
- DMARC policy starting value (`p=none` for ramp-up → `p=quarantine` once deliverability stable, vs. starting at `p=quarantine`).
- The `/account/security` page layout, password-strength meter, and exact form-validation copy — frame within the existing form-component patterns (planner reads `src/components/ui/`).
- Whether the `email_log` table gets an admin UI in this phase (probably not — surface in Phase 11 if needed; for v1.1 the Resend dashboard + DB is sufficient).
- Inngest function file layout (`src/inngest/client.ts` + `src/inngest/functions/send-email.ts` per the research-doc sketch is the strawman; planner may reorganise).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked architectural decisions (read first)
- `.planning/REQUIREMENTS.md` § B. Email infrastructure (EMAIL-01..04) + Architectural Decisions table — Active requirements + locked provider/queue/RBAC choices
- `.planning/research/v1.1-email-queue.md` — Inngest 4.2.6 rationale, `email_log` schema sketch, Inngest wire-up file layout, env-var bootstrap. **Most load-bearing doc for this phase.**
- `tasks/v2-carryover-from-v1-phase-6.md` § V2-EMAIL-01..04 — Original v2 carryover items Phase 8 subsumes; rationale on Resend vs Brevo vs SES
- `.planning/STATE.md` § Decisions (carried into v1.1) — v1.0-close locks: Resend primary, Inngest 4.2.6, no bespoke `email_jobs` table, thin `email_log` with `payloadHash` unique idx

### Operational context (CLAUDE.md)
- `CLAUDE.md` § "Vercel preview env vars — `BETTER_AUTH_URL` must use the git-branch alias" — same rule applies to `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` / `RESEND_API_KEY` / `EMAIL_FROM` for Phase 8 preview UAT
- `CLAUDE.md` § "Playwright specs against preview deploys" — EMAIL-03 prod-shape UAT (Playwright forgot-password + invite specs run against the preview alias before claiming "done")
- `CLAUDE.md` § "Prod admin password rotation (Phase 8.6)" — Reference implementation for direct credential mutation; informs the Better Auth `authClient.changePassword` call shape in EMAIL-02
- `CLAUDE.md` § "npm ci lockfile must stay in sync" — Mandatory linux/amd64 Docker regen when adding `resend@6.12.2` + `inngest@4.2.6` + `react-email` + `@react-email/components`
- `~/.claude/weknow-brand-guidelines.md` — Azure `#00A6D3`, Graphite `#121212`, Circular Pro typography rules for React-email templates

### Existing code the plans must reuse / replace
- `src/lib/email.ts` — Current nodemailer transport + `buildBrandedEmail` helper + 3 exported functions (`sendPasswordResetEmail`, `sendInviteEmail`, `sendExternalInviteEmail`). **Function signatures locked** — bodies replaced with Resend + react-email render. Inline `buildBrandedEmail` deleted.
- `src/lib/auth.ts` § lines 13-24 (`emailAndPassword.sendResetPassword` hook) — Better Auth wiring that calls into `email.ts`. Phase 8 does NOT change this hook's shape; it changes what the underlying email functions do.
- `src/app/(auth)/reset-password/` + `src/app/(auth)/set-password/` — Existing forgot-password and invite-acceptance landing pages; EMAIL-03 UAT exercises these end-to-end against prod.
- `src/app/(app)/admin/` — Existing admin route group; the prod-admin-only invite-user UI lives here and is one of the two surfaces EMAIL-01 must keep working post-Resend swap.

### v1.0 precedents
- `milestones/v1.0-phases/06-01-multi-pos-merge/` — D-03 ALL-OR-NOTHING transaction precedent (informs how `email_log` writes wrap Resend calls)
- `milestones/v1.0-ROADMAP.md` § Phase 1 — Better Auth invite-only flow rationale (still load-bearing; Phase 8 doesn't change auth, only transport)

### Forward-looking (Phase 8 ships substrate; Phase 9 consumes)
- `.planning/research/v1.1-notifications-model.md` — Phase 9 design that depends on EMAIL-04. Phase 8's substrate must satisfy the wire shape Phase 9 expects (`inngest.send({ name: 'email/send.requested', ... })` + `email_log` rows queryable by `kind`).
- `.planning/notes/v2-data-reset-decision.md` § Email digest of same-name alerts — Phase 7 DATA-03 ships the surface; the email digest is gated on Phase 8 EMAIL-04 substrate (referenced in Phase 7 CONTEXT.md as D-10 deferred).

### Missing artifact (housekeeping)
- `.planning/ROADMAP.md` does NOT exist on the current phase branch (`gsd/phase-07-data-foundation-rebuild`); commit `1a0d6a7` lives only on `docs/architecture-and-azure-hosting`. Port before the v1.1 close-out merge so phase-finder tooling works without manual STATE.md fallback.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/lib/email.ts` API surface** — Three exported functions (`sendPasswordResetEmail`, `sendInviteEmail`, `sendExternalInviteEmail`) called from `src/lib/auth.ts:18-22`. Signatures locked. Bodies migrate from nodemailer + inline HTML → Resend + react-email render. Migration is in-place; no call-site changes.
- **Better Auth `authClient.changePassword`** — Used in EMAIL-02; first-class Better Auth client API. Server-side `auth.api.changePassword` available for non-client paths if needed. Verified via the v1.0 prod-admin password-rotation script as the canonical credential-mutation entry point.
- **Vercel preview alias pinning pattern** — `BETTER_AUTH_URL` precedent in `CLAUDE.md` is the model for `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `RESEND_API_KEY`, `EMAIL_FROM` env-var bootstrap on preview branches.
- **Application-layer audit log substrate** — `email_log` follows the same pattern: denormalised actor/recipient, no DB triggers, written from application code in the send path.
- **Phase 7 D-12 Claude-driven invariant-suite UAT pattern** — Used inverted in Phase 8 (D-14): Claude verifies the request side, operator confirms the inbox side, because deliverability-testing requires a real inbox.

### Established Patterns
- **No bespoke queue tables** (locked v1.1 scoping) — EMAIL-04 substrate is Inngest, not a `email_jobs` table. `email_log` is audit-only, not queue state.
- **Phase branching** (`gsd/phase-08-email-infrastructure` per `git.branching_strategy: "phase"`) — every plan commits to this branch with summary commits per plan + a phase-completion commit before merge.
- **Lockfile drift** — adding `resend@6.12.2` + `inngest@4.2.6` + `react-email` + `@react-email/components` triggers macOS-vs-Linux skew. Use the `linux/amd64` Docker regen recipe from `CLAUDE.md`; do NOT regen on macOS.
- **Playwright as first UAT layer** — EMAIL-03 forgot-password spec runs against `PLAYWRIGHT_BASE_URL=<preview-alias>` per `CLAUDE.md`. `--list` passing is not sufficient — the spec must actually execute against the preview deploy.
- **API-surface preservation under transport swap** — same-shape pattern as the in-memory geocoding staging refactor in v1.0 (verb signatures stable, persistence layer swap trivially correct).

### Integration Points
- **DB schema** — New: `email_log` table with unique idx on `(kind, payload_hash)`. Drizzle migration adds the table. No changes to `user`, `account`, `session`, or other auth tables — Better Auth `changePassword` already handles credential rotation in `account`.
- **Vercel env vars** — New on preview + prod: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` (optional), `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`. Removed: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (if any are set). Removed dep: `nodemailer@^8.0.3`.
- **Inngest mount point** — `src/app/api/inngest/route.ts` exports `serve({ client, functions })`. Single route, no `vercel.json` cron entries.
- **`/account/security` route** — New leaf under a new `(app)/account/` group; `layout.tsx` is minimal (no tabs yet — Phase 9 may add `/account/notifications` later).
- **Phase 9 consumers** — EMAIL-04's `sendTransactional` / `inngest.send({ name: 'email/send.requested' })` shape is the contract Phase 9 NOTIF-01/02 + REPORT-05/06 ride. Defining this shape correctly in Phase 8 is the lowest-cost moment to align it; rework in Phase 9 is more expensive.

</code_context>

<specifics>
## Specific Ideas

- **`noreply@command.weknowgroup.com`** — exact mailbox + subdomain locked, ties directly to the prod product name "WeKnow Command Centre" and the prod URL `https://wkg-command-centre.vercel.app`.
- **"Sync for auth, async for everything else"** — the implementation rule that resolves the auth-flow transport question. Forgot-password / invite / external-invite go straight through Resend; digests / notifications / reports / scheduled emails go through Inngest.
- **react-email** — chosen specifically because Phase 9 NOTIF/REPORT will need to compose richer email bodies (lists of changed kiosks, region-grouped digests). Inline HTML strings are a dead-end for that work.
- **Confirmation email content = "minimum viable"** — timestamp + "contact admin", no IP/UA. Trade-off explicitly captured (D-11) so a future privacy or security review can find the reasoning.

</specifics>

<deferred>
## Deferred Ideas

- **Brevo as live fallback** — locked at scoping as "documented only, not implemented". The fallback write-up (env-driven `EMAIL_PROVIDER=resend|brevo` switch + trigger conditions) lands as `docs/email-fallback-brevo.md` in this phase per `tasks/v2-carryover-from-v1-phase-6.md` § V2-EMAIL-01 fix-path step 6. Implementation deferred until / unless Resend deliverability disappoints.
- **Email digest of Phase 7 DATA-03 same-name guardrail alerts** — Phase 7 ships banner + admin/health surface; the email digest itself rides EMAIL-04's substrate but ships under Phase 9's notifications umbrella (or is wired directly by Phase 7's owner once EMAIL-04 lands, depending on Phase 9 sequencing).
- **In-app notification bell** — explicitly out of scope for v1.1 per REQUIREMENTS § Out of Scope; defer to v1.2.
- **Email-log admin UI** — viewable surface for the `email_log` table inside the app. Phase 8 ships the table; the UI lands in Phase 11 polish if operators ask for it. For v1.1, the Resend dashboard + direct DB query is the operator's tool.
- **Per-user TZ rendering of confirmation timestamps** — D-11 hardcodes Europe/London; per-user TZ tied to a future user-preference surface that doesn't exist yet.
- **Password-strength meter + breach-check on `/account/security`** — EMAIL-02 ships a basic form; rich password UX lands in v1.2 if user-broaden lands first (the trigger that justifies SSO too, per PROJECT.md Out of Scope).
- **Marketing / non-transactional sending domain** — Phase 8 reserves `command.weknowgroup.com` for transactional only. Marketing (if it ever ships) gets a separate subdomain (e.g. `marketing.weknowgroup.com`) with its own deliverability story.

</deferred>

---

*Phase: 08-email-infrastructure*
*Context gathered: 2026-05-08*
