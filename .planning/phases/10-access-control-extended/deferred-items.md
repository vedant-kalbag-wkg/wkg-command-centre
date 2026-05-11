# Phase 10 — Deferred Items

## DEFERRED-10-01 — Drop user.role text column

**Decision:** Per RESEARCH §Q1, Better Auth admin plugin (1.5.x) reads `session.user.role` text
in 12 endpoint handlers. The text mirror is preserved as denormalised primary-tier indicator,
refreshed in lock-step with user_roles writes via `refreshUserRoleMirror`. Dropping the column
requires either Better Auth 1.6+ (if it adds a hookable role-resolver) or replacing the admin
plugin's role-reads with a custom session augmenter. Out of scope for v1.1.

**Pre-condition:** Better Auth release notes show role-read can be hooked, OR project decides
to write a customSession plugin. Then v1.2 can DROP user.role + remove refreshUserRoleMirror.

**Tracking:** Re-evaluate during v1.2 planning. Confidence on remove path: MEDIUM (depends on
upstream).

## DEFERRED-10-02 — UAT-discovered gaps

Populated during operator UAT walk if specific issues are deferred. If clean, this section
can be removed.
