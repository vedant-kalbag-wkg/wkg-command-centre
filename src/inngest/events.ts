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
export type EmailKind =
  | "password_changed"
  | "digest_daily"
  | "kiosk_offline"
  | "underperforming_poc";
export type EmailTemplate = "password-changed" | "poc-underperformance";

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
