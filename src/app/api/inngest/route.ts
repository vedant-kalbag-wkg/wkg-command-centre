import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { sendEmailFn } from "@/inngest/functions/send-email";
import { weeklyPocAlertsFn } from "@/inngest/functions/weekly-poc-alerts";
// Phase 9.1 plan 09.1-04 — daily BoE FX-rate fetch (cron, D-02). Without this
// registration the cron does NOT run on Inngest, regardless of `createFunction`
// being defined in the module above.
import { fxRatesFetchDailyFn } from "@/inngest/functions/fx-rates-fetch-daily";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [sendEmailFn, weeklyPocAlertsFn, fxRatesFetchDailyFn],
});
