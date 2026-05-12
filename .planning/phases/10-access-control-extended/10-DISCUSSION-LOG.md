# Phase 10: Access Control Extended — Discussion Log

**Captured:** 2026-05-10
**Mode:** discuss (default), 4/4 areas covered
**Reference:** `10-CONTEXT.md` (canonical decisions); this file is for human audit/retrospective only and is NOT consumed by downstream agents.

---

## Areas presented

User selected all 4 of the candidate gray areas:
1. Rules persistence schema
2. Default tier mapping + role identity
3. Custom-role assignment model
4. Admin-UI authoring shape

Skipped (already locked at scoping, not re-asked): library choice (CASL), integration point (`get-user-ctx.ts`), `redactSensitiveFields → permittedFieldsOf` migration, default tier coverage (Admin / Ops-IT / Read-only), `userScopes` retention, "no manual SQL for ops" convention.

---

## Area 1 — Rules persistence schema

### Q1.1 — Storage shape

| Option | Choice |
|---|---|
| Single JSONB column on `roles` | |
| Normalised `role_permissions` rows | |
| **Hybrid: roles row + rule rows** | ✓ |

### Q1.2 — Edit semantics

| Option | Choice |
|---|---|
| **Replace-all (delete + reinsert)** | ✓ |
| Per-rule diff | |
| Append-only with `role_versions` | |

### Q1.3 — Conditions wiring

User asked for a deeper trade-off comparison before answering.

| Option | Choice |
|---|---|
| Substitute placeholders into rule conditions | |
| **Append scope rules at build time (Option B)** | ✓ |
| Keep dual paths | |

Rationale offered: standard CASL JSON in storage; single auditable integration point in builder; matches phase success criterion #1 wording most cleanly without the silent-failure surface of placeholder substitution.

### Q1.4 — Subject + action taxonomy

| Option | Choice |
|---|---|
| **CRUD + a few domain actions, named subjects** | ✓ |
| Pure CRUD with synthetic subjects for non-CRUD ops | |
| Open string actions + subjects | |

---

## Area 2 — Default tier mapping + role identity

### Q2.1 — Tier identity

| Option | Choice |
|---|---|
| Editable seed rows (`kind='tier'`) | |
| **Immutable system Admin + editable Ops-IT / Read-only seeds** | ✓ |
| All 3 immutable; custom roles only for AUTH-07 | |

### Q2.2 — `user.role` migration

| Option | Choice |
|---|---|
| Add `role_id` FK; keep text column as legacy | |
| **Replace text column with `role_id` in one migration** | ✓ |
| Keep `user.role` text + add `role_id` permanently | |

Claude raised a Better Auth compatibility concern (session middleware reads `user.role` text); flagged for the planner as research question #1 in CONTEXT.md.

### Q2.3 — Edge roles (`system` + external invariant)

User asked for a deeper trade-off comparison before answering.

| Option | Choice |
|---|---|
| **Bypass CASL for system; external = code-level invariant** | ✓ |
| Both as data — system row + external deny-rules | |
| Bypass system; external via `applies_to_user_type` column | |

Rationale: external users are a contract-grade safety boundary; sensitive-key list is small + stable; admin-UI authorability adds near-zero practical value vs. the silent-failure cost of misauthored deny rules.

---

## Area 3 — Custom-role assignment model

### Q3.1 — Assignment shape

User chose an "Other" answer: IAM-style multi-role per user, each role with its own scoped permission set.

| Option | Choice |
|---|---|
| ONE role per user (custom replaces tier) | |
| ONE tier + N additional rule grants | |
| MULTIPLE roles per user (union of rule sets) | (closest base) |
| **IAM-style — multiple roles per user, each role scoped independently** | ✓ (user override) |

### Q3.2 — Scope binding

| Option | Choice |
|---|---|
| On the role definition (role-bound scope) | |
| **On the assignment (per-user-role-grant scope)** | ✓ |
| Hybrid: role declares scope-needed; assignment picks dimensions | |

Implication captured in CONTEXT.md: `userScopes` table evolves to per-(user, role, dimension).

### Q3.3 — Conflict resolution

| Option | Choice |
|---|---|
| Allow-union, no inverts | |
| **Explicit-deny-wins (AWS IAM semantics)** | ✓ |
| Last-rule-wins (CASL default with priority column) | |

---

## Area 4 — Admin-UI authoring shape

### Q4.1 — Primary authoring surface

| Option | Choice |
|---|---|
| **Form-driven GUI** | ✓ |
| Raw JSON editor with schema validation + live preview | |
| Hybrid (form + JSON drawer) | |

### Q4.2 — UI location

| Option | Choice |
|---|---|
| **New `/settings/roles` page (sibling to `/settings/users`)** | ✓ |
| Tab inside `/settings/users` | |
| Embedded inline on each user's edit page | |

### Q4.3 — Save safety

| Option | Choice |
|---|---|
| **Diff preview + impacted-users count** | ✓ |
| Diff + impacted-users + impersonation simulator | |
| Diff + impacted-users + impersonation + protected-tier guards | |

Rationale: Admin tier is `kind='system'` (data-layer immutable), so UI-layer protected-tier guards are redundant; impersonation simulator deferred to future milestone.

---

## Deferred ideas (none captured during this discussion)

The user did not surface any out-of-scope ideas. The "Out of scope for Phase 10" section in CONTEXT.md is derived from the architectural context (e.g. JSON editor, impersonation simulator, role inheritance) — items the discussion considered and explicitly chose not to include.

---

## Folded / reviewed todos

`gsd-sdk query todo.match-phase` lookup not run (command not present in this gsd-sdk install). No folded todos.

---

## Notes for planner

- Six open research questions live at the bottom of CONTEXT.md; the planner should ensure RESEARCH.md (or equivalent) answers each before tasks are written.
- Migration ordering is non-trivial (research question #3) — schema + seed + cutover + Better Auth adjustment + `user.role` drop. Decide PR atomicity early.
- Server-side lock-out prevention at write-time is a hard requirement even though the UI doesn't surface protected-tier guards.
