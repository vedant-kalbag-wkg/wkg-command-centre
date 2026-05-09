---
phase: 09-poc-underperformance-alerts
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/db/schema.ts
  - migrations/0043_phase_09_poc_alert_state.sql
autonomous: true
requirements: [POC-ALERT-01]
must_haves:
  truths:
    - "kiosk_performance_alert_state table exists with one row per kiosk tracking tier + classified_at + last_run_at + last_alerted_at"
    - "kiosks.alert_silenced_at and kiosks.alert_silenced_reason columns exist and are NULL by default for every kiosk"
    - "app_settings has rows underperformance_window_days='30' and pipeline_stage_id_live=<UUID of seeded Live stage>"
    - "Live runtime select against the new table + columns succeeds against the dev DATABASE_URL after drizzle-kit push"
  artifacts:
    - path: "src/db/schema.ts"
      provides: "Drizzle definitions for kioskPerformanceAlertState + kiosks.alertSilencedAt + kiosks.alertSilencedReason"
      contains: "kioskPerformanceAlertState = pgTable"
    - path: "migrations/0043_phase_09_poc_alert_state.sql"
      provides: "DDL for new table + ALTER kiosks + app_settings seeds"
      contains: "CREATE TABLE IF NOT EXISTS \"kiosk_performance_alert_state\""
  key_links:
    - from: "kiosk_performance_alert_state.kiosk_id"
      to: "kiosks.id"
      via: "FK ON DELETE CASCADE"
    - from: "app_settings"
      to: "pipeline_stages.id (Live row, position=7000)"
      via: "pipeline_stage_id_live row value resolved at migration runtime"
---

<objective>
Land the entire schema delta for Phase 9 in a single migration: new
`kiosk_performance_alert_state` table (per D-11), new
`kiosks.alert_silenced_at` + `kiosks.alert_silenced_reason` columns
(per D-19), and `app_settings` seed rows for
`underperformance_window_days='30'` (per D-04) and
`pipeline_stage_id_live=<UUID>` (per D-09 + D-23). The migration is
hand-authored (per migration `0041`'s convention — drizzle-kit's
snapshot history is incomplete pre-0023), idempotent (`IF NOT EXISTS`
+ `ON CONFLICT DO NOTHING`), and resolves the Live-stage UUID at
**migration runtime** (NOT hardcoded — looks up
`pipeline_stages` for `position=7000`, per D-09 fallback strategy
documented in RESEARCH.md). The drizzle schema definitions in
`src/db/schema.ts` are added so subsequent plans can `import { ... }`
the new table + columns.

Purpose: All other plans depend on this schema landing. The cron
function (09-03) reads/writes the new table; the silencing UI (09-06)
mutates the new columns; the admin page (09-05) queries metadata
aggregated from the new table. Without this plan, every downstream
plan hits a `relation does not exist` runtime error.

Output:
- `src/db/schema.ts` extended with `kioskPerformanceAlertState` table
  + 2 new columns on `kiosks`
- `migrations/0043_phase_09_poc_alert_state.sql` created
- DB schema pushed via `npx drizzle-kit push` (BLOCKING)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md
@.planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md
@.planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md

@src/db/schema.ts
@migrations/0041_phase_08_email_log.sql
@migrations/0033_locations_iana_timezone_and_admin_settings.sql
@src/db/seed-pipeline-stages.ts

<interfaces>
<!-- Existing analogs from src/db/schema.ts the executor must clone shapes from. -->
<!-- These are extracted from the codebase — no exploration needed. -->

From src/db/schema.ts (kiosks table, lines 117-144 — analog for column-add):
```typescript
export const kiosks = pgTable("kiosks", {
  id: uuid("id").primaryKey().defaultRandom(),
  // ...
  internalPocId: text("internal_poc_id").references(() => user.id),  // user.id is text, not uuid
  // ...
  archivedAt: timestamp("archived_at", { withTimezone: true }),  // shape twin for alertSilencedAt
});
```

From src/db/schema.ts (emailLog, lines 1107-1134 — analog for new table + partial idx):
```typescript
export const emailLog = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    // ...
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    kindPayloadHashUq: uniqueIndex("email_log_kind_payload_hash_uq")
      .on(t.kind, t.payloadHash)
      .where(sql`payload_hash IS NOT NULL`),
  }),
);
```

From src/db/schema.ts (appSettings):
```typescript
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  // ...
});
```

From src/db/seed-pipeline-stages.ts: the "Live" stage is seeded at `position=7000` (used at migration time to resolve the UUID for `pipeline_stage_id_live`).

From migrations/0033 (appSettings seed pattern):
```sql
INSERT INTO "app_settings" ("key", "value")
  VALUES ('analytics_display_timezone', 'local')
  ON CONFLICT ("key") DO NOTHING;
```
</interfaces>
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| migration runner → DB | DDL applies privileged schema changes; only run by deployer with superuser-equivalent role |
| (no user-input boundary in this plan — pure schema) | n/a |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-01-01 | Tampering | `kiosk_performance_alert_state.tier` column | mitigate | `CHECK (tier IN ('Premium','Standard','Developing','Emerging'))` constraint enforces enum at DB layer (per RESEARCH § Open Questions Q1 — store the `classifyOutletTier` return value verbatim, no translation layer). |
| T-09-01-02 | Tampering | `kiosks.alert_silenced_reason` column | accept | Column is plain `text NULL`; reason content is admin-authored free-text. SQL injection mitigated at app layer by Drizzle parameterised queries (see plan 09-06). No DB-layer mitigation needed. |
| T-09-01-03 | Repudiation | migration apply | mitigate | Migration is committed in git (auditable); idempotent so re-apply is safe; ALTER produces a single visible event in PG `pg_stat_activity` / Neon migration log. |
| T-09-01-04 | Information Disclosure | new state table | accept | Performance-tier classification is operational metadata, not PII; same disclosure surface as the existing `kiosks` + `outlet_code` tables. |
| T-09-01-05 | Denial of Service | first-ever migration apply | accept | DDL on a small (<2000 row) `kiosks` table; ALTER ADD COLUMN with NULL default is metadata-only in Postgres (no table rewrite). Migration runtime sub-second on prod-shape data. |
| T-09-01-06 | Tampering | `pipeline_stage_id_live` seed value | mitigate | Migration resolves the UUID by SELECT against `pipeline_stages` WHERE `position=7000` (single, seeded row); fails loudly if 0 or >1 rows match. Hard-coding the UUID is forbidden (admin can rename the stage; the row's UUID is stable but the migration must be reproducible across environments where seeded UUIDs differ). |

ASVS controls applied:
- V8.1 (Data Protection): performance-tier data is operational, not personal — no encryption-at-rest beyond Postgres default.
- V14.1 (Configuration): seed values use `ON CONFLICT DO NOTHING` so re-applying the migration in any env is safe.
</threat_model>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Extend src/db/schema.ts with kioskPerformanceAlertState + kiosks columns</name>
  <files>src/db/schema.ts</files>
  <read_first>
    - src/db/schema.ts — read the full file once. You need: (a) the imports block at the top, (b) the `kiosks` table at lines ~117-144 (you'll add 2 columns), (c) the `emailLog` table at lines ~1107-1134 (analog for the new table — clone the `pgTable + (t) => ({ ... indexes ... })` shape), (d) the `appSettings` table to confirm the seed shape.
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "src/db/schema.ts (modify — schema, drizzle-table-def)" — the exact analog excerpts and FK type rules.
    - .planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md § Open Questions Q1 — the bottom-tier wording mapping (`"Emerging"` is the value `classifyOutletTier` returns; the column stores the verbatim helper return value).
  </read_first>
  <behavior>
    - When this file is imported elsewhere (`import { kioskPerformanceAlertState } from "@/db/schema"`), the new table type is exported and accepts inserts of shape `{ kioskId: string; tier: 'Premium'|'Standard'|'Developing'|'Emerging'; classifiedAt: Date; lastRunAt: Date; lastAlertedAt: Date | null }`.
    - When `db.select().from(kiosks).limit(1)` runs (after the migration), the result rows include `alertSilencedAt: Date | null` and `alertSilencedReason: string | null` typed fields.
    - The new table's primary key is `kiosk_id` (uuid) — there is no separate `id` column; one row per kiosk by construction.
  </behavior>
  <action>
    1. **Add the new table** after the existing `emailLog` definition (or in a logical group near `kiosks` — pick the location that minimises diff churn; the `emailLog` neighbourhood is fine):

    ```typescript
    /**
     * Per-kiosk classification state for the weekly POC underperformance alert
     * (Phase 9 / POC-ALERT-01).
     *
     * One row per kiosk. UPSERTed by the weekly cron in
     * src/inngest/functions/weekly-poc-alerts.ts. The `tier` column stores the
     * verbatim return value of `classifyOutletTier` from
     * src/lib/analytics/metrics.ts (one of "Premium"|"Standard"|"Developing"
     * |"Emerging") so no translation layer is needed at read time. The cron's
     * dispatch decision treats `tier === "Emerging"` as the bottom-tier
     * sentinel (per RESEARCH § Open Questions Q1).
     *
     * `last_run_at` is set every run (even when the kiosk did not get
     * alerted); `last_alerted_at` is only set when an alert was actually
     * dispatched — this is how the chronic-monthly cap (D-10) works.
     */
    export const kioskPerformanceAlertState = pgTable(
      "kiosk_performance_alert_state",
      {
        kioskId: uuid("kiosk_id")
          .primaryKey()
          .references(() => kiosks.id, { onDelete: "cascade" }),
        tier: text("tier", {
          enum: ["Premium", "Standard", "Developing", "Emerging"],
        }).notNull(),
        classifiedAt: timestamp("classified_at", { withTimezone: true }).notNull(),
        lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
        lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
      },
      (t) => ({
        // Index on tier for the per-run query that fetches all bottom-tier
        // kiosks (the cron uses this to pick recipients).
        tierIdx: index("kiosk_performance_alert_state_tier_idx").on(t.tier),
      }),
    );
    ```

    2. **Extend the `kiosks` table** by adding two new columns adjacent to the existing `archivedAt` column (lines ~143). Use exactly these field names + DB column names (the silencing UI in plan 09-06 reads them):

    ```typescript
    // ... existing kiosks columns ...
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    alertSilencedAt: timestamp("alert_silenced_at", { withTimezone: true }),
    alertSilencedReason: text("alert_silenced_reason"),
    // ... rest of kiosks columns ...
    ```

    3. **Verify imports**: `pgTable`, `text`, `uuid`, `timestamp`, `index` must be imported at the top of the file. They are already imported by neighbouring tables — confirm.

    4. **Do NOT** add a separate audit-log entityType — the audit unions live in `src/lib/audit.ts` and are extended in plans 09-05 and 09-06 (per PATTERNS § audit.ts modify).
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&amp;1 | head -20</automated>
  </verify>
  <done>
    - File compiles (no new TS errors introduced).
    - `grep -n "kioskPerformanceAlertState" src/db/schema.ts` returns at least 1 match (the export).
    - `grep -n "alertSilencedAt" src/db/schema.ts` returns at least 1 match.
    - `grep -n "alertSilencedReason" src/db/schema.ts` returns at least 1 match.
    - The exported `kioskPerformanceAlertState` includes a `tier` column with the 4-value enum.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Author migrations/0043_phase_09_poc_alert_state.sql</name>
  <files>migrations/0043_phase_09_poc_alert_state.sql</files>
  <read_first>
    - migrations/0041_phase_08_email_log.sql — the full file. This is your structural template: header comment block + `IF NOT EXISTS` table create + `--> statement-breakpoint` separators + Drizzle convention (the file is hand-authored per its own header comment; use the same shape).
    - migrations/0033_locations_iana_timezone_and_admin_settings.sql — `ALTER TABLE` + `INSERT INTO "app_settings" ... ON CONFLICT DO NOTHING` patterns. Lines 29-30 + 56-59 are the exact analog.
    - migrations/0042_phase_08_email_log_status_check.sql — the `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint ...) THEN ALTER TABLE ... ADD CONSTRAINT ... CHECK (...) END IF; END $$;` pattern for adding a CHECK constraint idempotently. Use this exact shape for the `tier` enum CHECK.
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "migrations/0043_phase_09_poc_underperformance_alerts.sql" — the full pattern map for this file.
    - src/db/seed-pipeline-stages.ts — confirms "Live" is seeded at `position=7000` (used by Delta 4 below to resolve the UUID).
  </read_first>
  <behavior>
    - Running this migration on a fresh DB produces: a new table `kiosk_performance_alert_state` with PK on `kiosk_id`, FK to `kiosks(id)` ON DELETE CASCADE, CHECK constraint on `tier`, an index on `tier`; two new columns on `kiosks`; two new rows in `app_settings`.
    - Running this migration twice in a row is a no-op (every statement is `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / guarded by `pg_constraint` lookup).
    - The `pipeline_stage_id_live` seed resolves the UUID at **migration runtime** by selecting from `pipeline_stages WHERE position=7000`. If 0 or 2+ rows match, the migration aborts loudly (so the operator knows to seed pipeline stages first).
    - On Vercel/Neon prod, the migration runs in <1s on prod-shape data (~1000 kiosks).
  </behavior>
  <action>
    Write the migration with this structure (per D-23 + RESEARCH § Code Examples + PATTERNS):

    ```sql
    -- Phase 9 Plan 09-01 — POC underperformance alerts schema (POC-ALERT-01).
    --
    -- Adds:
    --   1. kiosk_performance_alert_state table — per-kiosk classification state
    --      tracked across cron runs. PK on kiosk_id (one row per kiosk).
    --      tier stores the verbatim classifyOutletTier return value
    --      ("Premium"|"Standard"|"Developing"|"Emerging"); the cron treats
    --      "Emerging" as the bottom-tier sentinel.
    --   2. kiosks.alert_silenced_at + kiosks.alert_silenced_reason — admin
    --      per-kiosk silencing (D-19). Silenced kiosks are excluded from
    --      classification AND alerting (per RESEARCH § Pitfall 4 recommendation).
    --   3. app_settings rows: underperformance_window_days=30 (D-04 default)
    --      and pipeline_stage_id_live (D-09 — UUID-pin to the seeded
    --      Live stage at position=7000).
    --
    -- Hand-authored rather than generated: drizzle-kit's snapshot history is
    -- incomplete pre-0023 (see 0039's header for full rationale). Each
    -- statement is IF NOT EXISTS / ON CONFLICT DO NOTHING / guarded so
    -- re-running on the UAT branch is safe.

    -- ── Delta 1 — kiosk_performance_alert_state table ────────────────────
    CREATE TABLE IF NOT EXISTS "kiosk_performance_alert_state" (
      "kiosk_id" uuid PRIMARY KEY NOT NULL REFERENCES "kiosks"("id") ON DELETE CASCADE,
      "tier" text NOT NULL,
      "classified_at" timestamp with time zone NOT NULL,
      "last_run_at" timestamp with time zone NOT NULL,
      "last_alerted_at" timestamp with time zone
    );
    --> statement-breakpoint

    -- Delta 1.1 — CHECK constraint on tier (idempotent via pg_constraint guard)
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'kiosk_performance_alert_state_tier_check'
      ) THEN
        ALTER TABLE "kiosk_performance_alert_state"
          ADD CONSTRAINT "kiosk_performance_alert_state_tier_check"
          CHECK (tier IN ('Premium', 'Standard', 'Developing', 'Emerging'));
      END IF;
    END $$;
    --> statement-breakpoint

    -- Delta 1.2 — tier index for per-run query
    CREATE INDEX IF NOT EXISTS "kiosk_performance_alert_state_tier_idx"
      ON "kiosk_performance_alert_state" ("tier");
    --> statement-breakpoint

    -- ── Delta 2 — kiosks.alert_silenced_at + alert_silenced_reason ───────
    ALTER TABLE "kiosks"
      ADD COLUMN IF NOT EXISTS "alert_silenced_at" timestamp with time zone;
    --> statement-breakpoint

    ALTER TABLE "kiosks"
      ADD COLUMN IF NOT EXISTS "alert_silenced_reason" text;
    --> statement-breakpoint

    -- ── Delta 3 — app_settings: underperformance_window_days=30 ──────────
    INSERT INTO "app_settings" ("key", "value")
      VALUES ('underperformance_window_days', '30')
      ON CONFLICT ("key") DO NOTHING;
    --> statement-breakpoint

    -- ── Delta 4 — app_settings: pipeline_stage_id_live (resolved at runtime) ──
    -- Resolves the UUID by selecting from pipeline_stages WHERE position=7000
    -- (the seeded "Live" position per src/db/seed-pipeline-stages.ts). The
    -- DO block aborts loudly if 0 or 2+ rows match so the operator knows
    -- pipeline_stages must be seeded first.
    DO $$
    DECLARE
      live_stage_id uuid;
      live_stage_count int;
    BEGIN
      -- Skip if already seeded (re-run safety)
      IF EXISTS (
        SELECT 1 FROM "app_settings" WHERE "key" = 'pipeline_stage_id_live'
      ) THEN
        RETURN;
      END IF;

      SELECT COUNT(*) INTO live_stage_count
        FROM "pipeline_stages"
        WHERE "position" = 7000;

      IF live_stage_count = 0 THEN
        RAISE EXCEPTION 'Cannot seed pipeline_stage_id_live: no pipeline_stages row at position=7000. Seed pipeline_stages first (see src/db/seed-pipeline-stages.ts).';
      END IF;

      IF live_stage_count > 1 THEN
        RAISE EXCEPTION 'Cannot seed pipeline_stage_id_live: % pipeline_stages rows at position=7000 (expected exactly 1).', live_stage_count;
      END IF;

      SELECT "id" INTO live_stage_id
        FROM "pipeline_stages"
        WHERE "position" = 7000;

      INSERT INTO "app_settings" ("key", "value")
        VALUES ('pipeline_stage_id_live', live_stage_id::text)
        ON CONFLICT ("key") DO NOTHING;
    END $$;
    --> statement-breakpoint
    ```

    Notes:
    - Use the `--> statement-breakpoint` markers exactly — Drizzle's migration runner splits on these.
    - The `pipeline_stage_id_live` value is stored as `text` because `app_settings.value` is a text column (verified at PATTERNS); the cron casts it back to uuid at read time via Drizzle's typed select.
  </action>
  <verify>
    <automated>test -f migrations/0043_phase_09_poc_alert_state.sql &amp;&amp; grep -c "CREATE TABLE IF NOT EXISTS \"kiosk_performance_alert_state\"" migrations/0043_phase_09_poc_alert_state.sql</automated>
  </verify>
  <done>
    - File exists.
    - `grep -c 'CREATE TABLE IF NOT EXISTS "kiosk_performance_alert_state"' migrations/0043_phase_09_poc_alert_state.sql` returns `1`.
    - `grep -c 'ADD COLUMN IF NOT EXISTS "alert_silenced_at"' migrations/0043_phase_09_poc_alert_state.sql` returns `1`.
    - `grep -c 'ADD COLUMN IF NOT EXISTS "alert_silenced_reason"' migrations/0043_phase_09_poc_alert_state.sql` returns `1`.
    - `grep -c "underperformance_window_days" migrations/0043_phase_09_poc_alert_state.sql` returns at least `1`.
    - `grep -c "pipeline_stage_id_live" migrations/0043_phase_09_poc_alert_state.sql` returns at least `1`.
    - `grep -c "position = 7000" migrations/0043_phase_09_poc_alert_state.sql` returns `2` (the COUNT and SELECT).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3 [BLOCKING]: Push schema to dev DATABASE_URL via drizzle-kit</name>
  <files>(no file modifications — runs migration against the live DB referenced by DATABASE_URL)</files>
  <read_first>
    - CLAUDE.md § "Vercel preview env vars" — confirms the same env-var pattern; for THIS task you push against the local/dev DATABASE_URL (the migration will be re-applied to preview / prod automatically by drizzle-kit on next deploy).
    - drizzle.config.ts — confirms `schema: "./src/db/schema.ts"` and the migration directory.
  </read_first>
  <behavior>
    - After this task: `psql $DATABASE_URL -c "SELECT * FROM kiosk_performance_alert_state LIMIT 0"` returns the table's column list (proves table exists at runtime, not just in TypeScript types).
    - After this task: `psql $DATABASE_URL -c "SELECT alert_silenced_at, alert_silenced_reason FROM kiosks LIMIT 1"` succeeds (columns exist).
    - After this task: `psql $DATABASE_URL -c "SELECT key, value FROM app_settings WHERE key IN ('underperformance_window_days', 'pipeline_stage_id_live')"` returns 2 rows.
  </behavior>
  <action>
    1. Confirm `DATABASE_URL` is set in the local environment (typically via `.env.local`). If not set, abort and prompt the operator.
    2. Run `npx drizzle-kit push` (this is the non-interactive command in this codebase per the schema_push_requirement).
    3. The push will detect the new table + columns + (Drizzle-managed) seed inserts. The hand-authored SQL migration file (0043) is the source of truth for any DDL drizzle-kit cannot infer (the `app_settings` seeds + the CHECK constraint + the `DO $$ ... position=7000 ...` block).
    4. **If `drizzle-kit push` does not run the hand-authored 0043 file** (i.e. it only diffs the schema.ts → DB and skips the SQL files), additionally run `npx drizzle-kit migrate` to apply the migration file. Verify which mechanism this codebase uses by reading `drizzle.config.ts` and the `package.json` scripts (`db:push`, `db:migrate`) — match the existing convention.
    5. Verify post-push with the three psql commands listed in `<behavior>` above (or via `npx drizzle-kit studio` if psql is not on PATH).

    **Critical:** Do NOT proceed to plan 09-02 onward until this push succeeds. The downstream cron + admin page + silencing UI all hit `relation does not exist` if the table is not in the live DB.
  </action>
  <verify>
    <automated>node -e "const { db } = require('./src/db'); const { kioskPerformanceAlertState } = require('./src/db/schema'); db.select().from(kioskPerformanceAlertState).limit(0).then(() => { console.log('OK'); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });" 2>&amp;1</automated>
  </verify>
  <done>
    - `npx drizzle-kit push` (and/or `migrate`) exits 0.
    - `kiosk_performance_alert_state` table exists in the live DB (verified by select above).
    - `kiosks.alert_silenced_at` + `kiosks.alert_silenced_reason` columns exist.
    - `app_settings` has rows for `underperformance_window_days` and `pipeline_stage_id_live`.
    - `pipeline_stage_id_live` value is a valid UUID matching the seeded `pipeline_stages` row at `position=7000`.
  </done>
</task>

</tasks>

<verification>
- `grep -c "kioskPerformanceAlertState" src/db/schema.ts` ≥ 1
- `grep -c "alertSilencedAt" src/db/schema.ts` ≥ 1
- `test -f migrations/0043_phase_09_poc_alert_state.sql` exits 0
- `npx tsc --noEmit -p tsconfig.json` exits 0
- Live select against `kiosk_performance_alert_state` succeeds (Task 3 verify command)
- `psql $DATABASE_URL -c "SELECT value FROM app_settings WHERE key='pipeline_stage_id_live'"` returns a UUID-shaped string
</verification>

<success_criteria>
After this plan:
1. `src/db/schema.ts` contains `kioskPerformanceAlertState` + `kiosks.alertSilencedAt` + `kiosks.alertSilencedReason` exported and typed correctly.
2. `migrations/0043_phase_09_poc_alert_state.sql` exists with all 4 deltas (table + 2 columns + 2 app_settings seeds).
3. The schema is live in the dev DB — runtime selects succeed against the new table and the seeded `pipeline_stage_id_live` value resolves to the UUID of the `Live` pipeline stage.
4. No new TS errors introduced.
</success_criteria>

<output>
After completion, create `.planning/phases/09-poc-underperformance-alerts/09-01-SUMMARY.md` with:
- Migration filename emitted
- The resolved `pipeline_stage_id_live` UUID (operator can verify it matches their dev DB's seeded Live stage)
- Confirmation that `drizzle-kit push` ran clean
- Any deviations from the plan (e.g. if drizzle-kit push had to be paired with `migrate` for the SQL file to apply)
</output>
