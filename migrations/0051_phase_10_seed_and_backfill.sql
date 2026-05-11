-- Phase 10 (Plan 10-02) — Access Control Extended: seed defaults + backfill
--
-- Data migration. Companion DDL is 0050. Companion NOT-NULL flip (optional)
-- is 0052. All three land in one PR (PR-level atomicity per project convention).
--
-- Idempotent: every INSERT uses ON CONFLICT DO NOTHING; every UPDATE is
-- guarded by WHERE conditions that match only un-backfilled rows.
--
-- IMPORTANT: this migration does NOT touch user.role text values.
-- user.role text is preserved as the denormalised mirror of primary tier
-- (RESEARCH.md Q1). The mirror is REFRESHED at runtime by
-- refreshUserRoleMirror(userId, tx) on every assignRole / revokeRole;
-- since this migration only ADDS user_roles rows in lock-step with the
-- existing user.role text, the mirror is already consistent post-migration.
--
-- Deltas:
--   1.   Seed 3 roles: admin (system), ops-it (tier), read-only (tier)
--   2.   Seed role_permissions for ops-it (mirrors v1.0 internal/member behaviour)
--   3.   Seed role_permissions for read-only (mirrors v1.0 internal/viewer behaviour)
--   4.   Backfill user_roles from existing user.role text values
--   5.   Backfill user_scopes.role_id from each user's primary user_roles row

-- ── Delta 1 — seed 3 roles ─────────────────────────────────────────────
INSERT INTO "roles" ("name", "kind", "display_name", "description")
  VALUES
    ('admin',     'system', 'Admin',     'Full access. Immutable system role; bypasses CASL ability-builder rule evaluation.'),
    ('ops-it',    'tier',   'Ops-IT',    'Operations + IT default tier. Editable rule set; v1.0 ''member'' parity.'),
    ('read-only', 'tier',   'Read-only', 'Read-only default tier. Editable rule set; v1.0 ''viewer'' parity.')
  ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

-- ── Delta 2 — role_permissions for ops-it ──────────────────────────────
-- Mirrors v1.0 redactSensitiveFields(member, internal) behaviour:
-- internal/member sees all fields including sensitive (banking, contracts).
-- Plus CRUD on operational subjects (Kiosk, Location, Installation, Product).
INSERT INTO "role_permissions" ("role_id", "action", "subject", "fields", "conditions", "inverted")
  SELECT r.id, action, subject, fields::jsonb, NULL::jsonb, false
    FROM "roles" r,
    (VALUES
      ('read',         'Location',          NULL),
      ('update',       'Location',          NULL),
      ('read',         'Kiosk',             NULL),
      ('update',       'Kiosk',             NULL),
      ('create',       'Kiosk',             NULL),
      ('read',         'User',              '["id","name","email","role","userType","createdAt"]'),
      ('read',         'AuditLog',          NULL),
      ('read',         'Analytics',         NULL),
      ('read',         'EmailLog',          NULL),
      ('read',         'LocationProduct',   NULL),
      ('update',       'LocationProduct',   NULL),
      ('merge',        'Location',          NULL),
      ('import',       'Location',          NULL),
      ('export',       'Analytics',         NULL),
      ('silence_alert','Location',          NULL)
    ) AS rules(action, subject, fields)
    WHERE r.name = 'ops-it'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ── Delta 3 — role_permissions for read-only ───────────────────────────
-- Mirrors v1.0 redactSensitiveFields(viewer, internal) behaviour:
-- internal/viewer sees all read fields BUT bankingDetails/contractValue/
-- contractTerms/contractDocuments redacted to NULL. Encoded as:
--   can('read', 'Location') with no field restriction
--   cannot('read', 'Location', ['bankingDetails','contractValue','contractTerms','contractDocuments'])
INSERT INTO "role_permissions" ("role_id", "action", "subject", "fields", "conditions", "inverted")
  SELECT r.id, action, subject, fields::jsonb, NULL::jsonb, inverted
    FROM "roles" r,
    (VALUES
      ('read', 'Location',         NULL,                                                                              false),
      ('read', 'Location',         '["bankingDetails","contractValue","contractTerms","contractDocuments"]',          true ),
      ('read', 'Kiosk',            NULL,                                                                              false),
      ('read', 'User',             '["id","name","email","userType","createdAt"]',                                    false),
      ('read', 'AuditLog',         NULL,                                                                              false),
      ('read', 'Analytics',        NULL,                                                                              false),
      ('read', 'EmailLog',         NULL,                                                                              false),
      ('read', 'LocationProduct',  NULL,                                                                              false)
    ) AS rules(action, subject, fields, inverted)
    WHERE r.name = 'read-only'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ── Delta 4 — backfill user_roles from user.role text ──────────────────
-- For every existing user, insert a user_roles row pointing at the role
-- that matches their current user.role text. ON CONFLICT covers the case
-- where this migration is re-run.
INSERT INTO "user_roles" ("user_id", "role_id", "assigned_by")
  SELECT u.id,
         (SELECT id FROM "roles" WHERE name = 'admin'),
         NULL
    FROM "user" u
    WHERE u.role = 'admin'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "user_roles" ("user_id", "role_id", "assigned_by")
  SELECT u.id,
         (SELECT id FROM "roles" WHERE name = 'ops-it'),
         NULL
    FROM "user" u
    WHERE u.role = 'member'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "user_roles" ("user_id", "role_id", "assigned_by")
  SELECT u.id,
         (SELECT id FROM "roles" WHERE name = 'read-only'),
         NULL
    FROM "user" u
    WHERE u.role = 'viewer'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint

--> statement-breakpoint

-- Note: 'system' user.role text values (ETL/automation) are NOT given a
-- user_roles row. The ability builder short-circuits userType='system' OR
-- (legacy) role='system' before consulting user_roles. See
-- src/lib/casl/ability.ts §"system short-circuit" — Plan 10-03.

-- ── Delta 5 — backfill user_scopes.role_id ─────────────────────────────
-- Every existing user_scopes row is bound to that user's primary tier role
-- (which matches their user.role text). Pick the user's tier user_roles row
-- (kind in ('system', 'tier')); if multiple exist (shouldn't, since pre-
-- cutover users have exactly one tier), pick deterministically by
-- kind = 'system' first, then alphabetical role name.
UPDATE "user_scopes" us
  SET "role_id" = (
    SELECT ur."role_id"
      FROM "user_roles" ur
      INNER JOIN "roles" r ON r.id = ur.role_id
      WHERE ur.user_id = us.user_id
        AND r.kind IN ('system', 'tier')
      ORDER BY (r.kind = 'system') DESC, r.name ASC
      LIMIT 1
  )
  WHERE us."role_id" IS NULL;
--> statement-breakpoint
