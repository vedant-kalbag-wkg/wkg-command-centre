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
export type EmailKind = "password_changed" | "digest_daily" | "kiosk_offline";
export type EmailTemplate = "password-changed";

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
