# Phase 1: Foundation - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Auth, RBAC, complete database schema, and app shell — everything downstream phases build on. Delivers: working authentication layer, three-role access control system, fully-normalised database schema (including temporal assignment tracking, configurable pipeline stages, append-only audit logging), and the navigable app shell.

</domain>

<decisions>
## Implementation Decisions

### Auth Flow
- Invite-only access — admin sends email invite, user sets password via link. No public signup.
- Long-lived sessions (30-day sliding window) — users rarely need to re-login
- Password reset via email link flow (enter email → receive link → set new password on dedicated page)
- Login page fully branded with WeKnow identity (logo, Azure/Graphite colours, Circular Pro font)
- Better Auth 1.5.x for auth/RBAC (pre-decided)

### User Management
- Admin invites users with email + role only; user fills in their own name/details on first login
- User management lives in Settings > Users (not a separate admin area)
- Deactivate only — no permanent user deletion; records preserved for audit trail
- Admin can change a user's role anytime, with a confirmation warning about permission changes

### App Shell & Navigation
- Collapsible left sidebar with icons + labels (Linear/ClickUp style), collapsible to icon-only
- Flat nav list: Kiosks, Locations, Settings — views (Table/Kanban/Gantt/Calendar) are tabs within the Kiosks page
- Default landing page after login: Kiosk table view (dashboard replaces this in Phase 5)
- Mobile/tablet: sidebar becomes hamburger menu overlay

### Role Permissions
- Three roles: **Admin**, **Member** (full CRUD), **Viewer** (read-only)
- Admin is a distinct role, not a flag on other roles
- Member and Admin both have full CRUD on kiosks and locations
- Viewer can see everything except sensitive fields
- Sensitive fields = banking details + contract documents/values only (not maintenance fees or other financial fields)
- Sensitive field access: Admin + Member can see/edit; Viewer sees them as hidden/redacted
- Unauthorised controls: shown as disabled with tooltip explaining why (not hidden, not click-to-error)

### Database Schema (Pre-decided)
- `kiosk_assignments` temporal join table for assignment history
- FLOAT8 for pipeline stage ordering positions
- Application-layer audit log with denormalized actor/entity names

### Claude's Discretion
- Loading skeleton and spinner design
- Exact spacing, typography scale, and component sizing
- Error state handling (toasts, inline errors, error pages)
- Session expiry redirect behaviour
- Sidebar animation and collapse behaviour
- Form validation approach

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & Requirements
- `.planning/PROJECT.md` — Project vision, constraints, key decisions
- `.planning/REQUIREMENTS.md` — AUTH-01 through AUTH-05 define Phase 1 requirements

### Brand Guidelines
- `~/.claude/weknow-brand-guidelines.md` — WeKnow brand colours (Azure #00A6D3, Graphite #121212), Circular Pro font, logo usage rules

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no existing code

### Established Patterns
- None yet — Phase 1 establishes all patterns (Next.js 16, Drizzle ORM, Tailwind v4, shadcn/ui)

### Integration Points
- Neon PostgreSQL — cloud database connection via Drizzle ORM
- Better Auth 1.5.x — auth provider integration
- `.env.test` — contains Monday.com API key (used in Phase 4, not Phase 1)

</code_context>

<specifics>
## Specific Ideas

- Navigation should feel like Linear/ClickUp — clean collapsible sidebar, professional internal tool
- Login page should be branded, not a generic white card
- Views (Table, Kanban, Gantt, Calendar) are tabs within the Kiosks page, not separate sidebar items

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-03-18*
