/**
 * Phase 9.1 gap closure (CR-02) — FX_ALERT_TO is required, no hardcoded fallback.
 *
 * Throws at the call site so the operator gets a deploy-time failure if the env
 * var is unset, rather than silently routing to an embedded literal. Per CLAUDE.md
 * `Prod admin password rotation` precedent, recipients live in env, never literal.
 *
 * Both fx_rate_fetch_failed (Inngest cron) and fx_rate_stale (Azure ETL per-blob
 * gate) call sites read through this single helper so the env-var contract is
 * uniform.
 */
export function getFxAlertRecipient(): string {
  const to = process.env.FX_ALERT_TO;
  if (!to) {
    throw new Error(
      "FX_ALERT_TO env var is required for fx_rate alerting; set it on Vercel preview AND production env vars per CLAUDE.md",
    );
  }
  return to;
}
