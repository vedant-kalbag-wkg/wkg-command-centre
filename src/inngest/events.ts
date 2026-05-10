// Phase 8 Plan 08-01 — Inngest event-shape contracts.
//
// EmailSendRequested is the wire-shape Phase 9 (NOTIF-01/02 + REPORT-05/06)
// will type-import from. Locked here so downstream consumers (digest,
// kiosk_offline, scheduled reports) depend on a stable contract.
//
// `kind` and `template` are closed unions (NO `| string` fallthrough) —
// this catches typos at the call-site. Phase 9 extends each union as it
// adds digest / kiosk_offline / report templates; the matching entry must
// also appear in send-email.ts's TEMPLATES dispatch table.
//
// Phase 9 Plan 09-04 (BLOCKER-3): added "underperforming_poc" / "poc-underperformance"
// for the weekly POC digest email. The TEMPLATES dispatch and plain-text
// branch in send-email.ts are extended in the same plan commit.
//
// Phase 9.1 plan 09.1-02 (FX-01/02 substrate): added "fx_rate_fetch_failed"
// (D-08 cron alert when BoE fetch errors) and "fx_rate_stale" (D-08 ETL alert
// when carry-forward exceeds the 7-day staleness ceiling). Per RESEARCH
// pitfall 8 the email_log.kind column is plain text with NO DB CHECK — the
// project's house style is TypeScript-enum-only enforcement.
//
// Phase 9.1 Plan 11 (NEW CR-02): added "plain-text" to EmailTemplate.
// Both FX alert call-sites (fx-rates-fetch-daily.ts + azure-etl.ts) emit
// template: "plain-text". The send-email handler dispatches it through the
// plain-text branch that was wired in plan 09.1-02. Omitting it from the
// closed union here forced both call-sites to cast via `as unknown` — that
// cast is now removed so the compiler enforces the valid-template constraint.
export type EmailKind =
  | "password_changed"
  | "digest_daily"
  | "kiosk_offline"
  | "underperforming_poc"
  | "fx_rate_fetch_failed"
  | "fx_rate_stale";
export type EmailTemplate = "password-changed" | "poc-underperformance" | "plain-text";

export type EmailSendRequested = {
  name: "email/send.requested";
  data: {
    kind: EmailKind;
    to: string;
    subject: string;
    template: EmailTemplate;
    templateProps: Record<string, unknown>;
    payloadHash?: string;
  };
};
