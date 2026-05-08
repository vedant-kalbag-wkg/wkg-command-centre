// Phase 8 Plan 08-01 — Inngest event-shape contracts.
//
// EmailSendRequested is the wire-shape Phase 9 (NOTIF-01/02 + REPORT-05/06)
// will type-import from. Locked here so downstream consumers (digest,
// kiosk_offline, scheduled reports) depend on a stable contract.
export type EmailSendRequested = {
  name: "email/send.requested";
  data: {
    kind: "password_changed" | "digest_daily" | "kiosk_offline" | string;
    to: string;
    subject: string;
    template: "password-changed" | string;
    templateProps: Record<string, unknown>;
    payloadHash?: string;
  };
};
