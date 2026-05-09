import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { sendEmailFn } from "@/inngest/functions/send-email";
import { weeklyPocAlertsFn } from "@/inngest/functions/weekly-poc-alerts";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [sendEmailFn, weeklyPocAlertsFn],
});
