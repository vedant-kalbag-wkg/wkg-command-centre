-- Phase 10 (Plan 10-15 / gap-closure-round-3) — backfill missing admin user_roles
--
-- Migration 0051 Delta 4 (the original user_roles backfill) only catches
-- admins that existed BEFORE 0051 ran. Better Auth's admin plugin path
-- (auth.api.createUser({ role: "admin" }), used by src/db/seed.ts and by
-- scripts/reset-admin-password.ts) writes user.role='admin' text but does
-- NOT insert into user_roles. Result: any admin (re)created on a preview
-- or prod DB after 0051 ran has user.role='admin' but no user_roles row.
-- This breaks the CASL ability builder's line-67 short-circuit
-- (src/lib/casl/ability.ts) — grants.some((g) => g.roleKind === 'system')
-- returns false because grants is empty, so admin gets an empty Ability.
--
-- This migration is a literal re-run of 0051 Delta 4, idempotent via
-- ON CONFLICT DO NOTHING and a NOT EXISTS guard against admins who
-- already have a kind='system' grant. Safe to run on a DB where every
-- admin already has the row (no-op); fixes the gap on a DB where any
-- admin doesn't.
--
-- NO schema changes. NO other deltas. Migration 0054 (role_permissions
-- unique fix) is preserved verbatim and remains the most recent DDL.

INSERT INTO "user_roles" ("user_id", "role_id", "assigned_by")
  SELECT u.id,
         (SELECT id FROM "roles" WHERE name = 'admin'),
         NULL
    FROM "user" u
    WHERE u.role = 'admin'
      AND NOT EXISTS (
        SELECT 1 FROM "user_roles" ur
          INNER JOIN "roles" r ON r.id = ur.role_id
          WHERE ur.user_id = u.id
            AND r.kind = 'system'
      )
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
