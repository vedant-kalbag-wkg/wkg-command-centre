-- Phase 9.1 Plan 09.1-02 — Multi-currency forex normalisation: exchange_rates table (FX-01).
--
-- Adds:
--   1. exchange_rates table — daily Bank of England spot rates per currency.
--      PK on (currency, rate_date) so the daily Inngest cron can ON CONFLICT
--      DO NOTHING on idempotent re-run. rate_to_gbp uses numeric(18,10) for
--      JPY-class precision (BoE publishes XUDLJYS at ~6 decimal places; 10 is
--      future-headroom for KRW/IDR-style very-low-value currencies).
--   1.1 source column defaults 'boe' so a future NetSuite-as-source phase can
--       coexist without a schema change (CONTEXT.md deferred ideas).
--
-- Hand-authored rather than generated: each statement is IF NOT EXISTS guarded
-- so re-running on the UAT branch is safe (project house style, see 0043).
--
-- Deltas:
--   1. exchange_rates table with composite PK (currency, rate_date)

CREATE TABLE IF NOT EXISTS "exchange_rates" (
  "currency" text NOT NULL,
  "rate_date" date NOT NULL,
  "rate_to_gbp" numeric(18, 10) NOT NULL,
  "source" text NOT NULL DEFAULT 'boe',
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("currency", "rate_date")
);
--> statement-breakpoint
