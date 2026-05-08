-- Phase 8 Plan 08-01 — email_log audit table (EMAIL-01 + EMAIL-04).
--
-- One row per email send, regardless of transport. Partial unique index on
-- (kind, payload_hash) WHERE payload_hash IS NOT NULL enforces digest
-- idempotency at the DB; auth-flow sends pass payload_hash=NULL so they
-- never collide.
--
-- Each statement is `IF NOT EXISTS` / idempotent so re-running on the UAT
-- branch (where the table may already exist from an earlier apply) is a
-- no-op.
--
-- Hand-authored rather than generated: drizzle-kit's snapshot history is
-- incomplete pre-0023 (see 0039's header for full rationale).
--
-- Deltas:
--   1. email_log table.
--   2. partial unique idx on (kind, payload_hash) WHERE payload_hash IS NOT NULL.
--   3. recipient + created_at desc helper idx for "recent sends to recipient" lookups.

-- ── Delta 1 — email_log table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "recipient" text NOT NULL,
  "resend_message_id" text,
  "inngest_run_id" text,
  "status" text NOT NULL,
  "last_error" text,
  "payload_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ── Delta 2 — (kind, payload_hash) partial unique idx ─────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "email_log_kind_payload_hash_uq"
  ON "email_log" ("kind", "payload_hash")
  WHERE payload_hash IS NOT NULL;

-- ── Delta 3 — recipient + created_at desc helper idx ──────────────────
CREATE INDEX IF NOT EXISTS "email_log_recipient_created_at_idx"
  ON "email_log" ("recipient", "created_at" DESC);
