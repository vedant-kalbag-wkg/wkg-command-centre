import { Inngest } from "inngest";

// Phase 8 Plan 08-01 — Singleton Inngest client. Reads INNGEST_EVENT_KEY
// from env automatically (SDK behaviour). No defensive try/catch — let env
// absence throw at startup, same as src/lib/auth.ts does for
// BETTER_AUTH_SECRET.
export const inngest = new Inngest({ id: "wkg-kiosk-tool" });
