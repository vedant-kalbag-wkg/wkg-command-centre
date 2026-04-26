-- Phase 1.7 — Internal-user-with-zero-scopes safety
--
-- Pre-fix, src/lib/scoping/scoped-query.ts treated any internal user with
-- zero rows in user_scopes as unrestricted (returned a NULL filter). The
-- ETL automation actor (etl-system, seeded by 0022) is the only such user
-- today and legitimately needs unrestricted access; every other zero-scope
-- internal user is a provisioning gap that the new code path now refuses
-- to silently paper over.
--
-- Solution: introduce a new free-text role 'system' for non-interactive
-- automation actors. The runtime guard in scoped-query.ts grants admin OR
-- system unrestricted access; everyone else with zero scopes throws.
-- Better Auth treats user.role as plain text (the admin plugin only
-- enforces 'admin' specifically via adminRoles), so no enum/CHECK changes
-- are required at the DB layer.

UPDATE "user"
SET role = 'system', updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000001';
