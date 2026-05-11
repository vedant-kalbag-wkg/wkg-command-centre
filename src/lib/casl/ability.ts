import { cache } from "react";
import { createMongoAbility, AbilityBuilder } from "@casl/ability";
import type { AppAbility, Action, Subject } from "./types";
import { applyExternalUserInvariant } from "./external-invariant";

// Per-request memoisation — N RSC islands hit the DB once per render pass.
// Same idiom as getUserCtx, getSessionOrThrow, scopedSalesCondition.
export const buildAbility = cache(async (userId: string): Promise<AppAbility> => {
  // Dynamic imports keep RSC tree-shake intact; matches getUserCtx style.
  const { db } = await import("@/db");
  const { user: userTable, userRoles, rolePermissions, roles, userScopes } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  // 1. Load user (for userType + system bypass).
  const [u] = await db
    .select({ id: userTable.id, userType: userTable.userType, role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
  const userType = (u?.userType ?? "internal") as "internal" | "external" | "system";

  // 2. System short-circuit (userType OR text-mirror == 'system'). ETL
  //    cron and scripts pass through here when running with a system
  //    identity; they always get manage all without DB roundtrip.
  if (userType === "system" || (u?.role as string) === "system") {
    builder.can("manage", "all");
    return builder.build();
  }

  if (!u) {
    // Unknown user — empty ability + external invariant for safety
    applyExternalUserInvariant(builder, "external");
    return builder.build();
  }

  // 3. Single-pass load: grants (one row per (user_role, rule)) + scopes.
  const grants = await db
    .select({
      roleId: userRoles.roleId,
      roleKind: roles.kind,
      action: rolePermissions.action,
      subject: rolePermissions.subject,
      fields: rolePermissions.fields,
      conditions: rolePermissions.conditions,
      inverted: rolePermissions.inverted,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(eq(userRoles.userId, userId));

  const scopeRows = await db
    .select({
      roleId: userScopes.roleId,
      dim: userScopes.dimensionType,
      id: userScopes.dimensionId,
    })
    .from(userScopes)
    .where(eq(userScopes.userId, userId));

  // 4. System-role short-circuit at the rule-set level — if ANY of the
  //    user's roles is kind='system' (Admin), grant manage all and skip
  //    rule iteration.
  if (grants.some((g) => g.roleKind === "system")) {
    builder.can("manage", "all");
  } else {
    for (const g of grants) {
      if (!g.action || !g.subject) continue; // role with zero rules
      const target = g.inverted ? builder.cannot : builder.can;
      // Per-(user, role) scope merge — only this role's rules carry this
      // role's scope conditions. Different roles for the same user get
      // different scope shapes.
      const scopeCond = deriveScopeConditions(
        g.subject as Subject,
        scopeRows.filter((s) => s.roleId === g.roleId),
      );
      const mergedConditions =
        scopeCond || g.conditions
          ? { ...((g.conditions as Record<string, unknown>) ?? {}), ...(scopeCond ?? {}) }
          : undefined;
      target.bind(builder)(
        g.action as Action,
        g.subject as Subject,
        (g.fields as string[] | null) ?? undefined,
        mergedConditions as never,
      );
    }
  }

  // 5. External-user invariant — appended LAST so deny-wins applies.
  //    Defense-in-depth: an admin cannot grant external users banking
  //    access via the role editor; this strip is unconditional.
  applyExternalUserInvariant(builder, userType);

  return builder.build();
});

// Subject-aware mapping: scope rows → CASL conditions.
// - Region scope on Location: { regionId: { $in: [...] } }
// - Region scope on Kiosk: { regionId: { $in: [...] } } (kiosk denormalises regionId via assigned location)
// - HotelGroup scope on Location: { hotelGroupId: { $in: [...] } }
// - Location scope on Kiosk: { locationId: { $in: [...] } }
// - Other dimensions follow same shape — see SCOPE_DIMENSION_TO_FIELD.
const SCOPE_DIMENSION_TO_FIELD: Partial<Record<Subject, Partial<Record<string, string>>>> = {
  Location:        { region: "regionId",        hotel_group: "hotelGroupId", location: "id",         location_group: "locationGroupId" },
  Kiosk:           { region: "regionId",        hotel_group: "hotelGroupId", location: "locationId", product: "productId",        provider: "providerId" },
  LocationProduct: { product: "productId",     location: "locationId" },
  Analytics:       { region: "regionId",        hotel_group: "hotelGroupId", location: "locationId" },
  // Subjects with no scoped fields (User, AuditLog, EmailLog, Role, RolePermission)
  // do not appear here — their rules carry no scope merge.
};

function deriveScopeConditions(
  subject: Subject,
  scopes: Array<{ dim: string | null; id: string }>,
): Record<string, unknown> | null {
  const subjMap = SCOPE_DIMENSION_TO_FIELD[subject];
  if (!subjMap || scopes.length === 0) return null;
  // Group by dimension type, emit one $in per dimension.
  const grouped: Record<string, string[]> = {};
  for (const s of scopes) {
    if (!s.dim) continue;
    const field = subjMap[s.dim];
    if (!field) continue;
    (grouped[field] ??= []).push(s.id);
  }
  if (Object.keys(grouped).length === 0) return null;
  const cond: Record<string, unknown> = {};
  for (const [field, ids] of Object.entries(grouped)) {
    cond[field] = { $in: ids };
  }
  return cond;
}

// Re-export types so that test files and downstream consumers can import
// AppAbility, Subject, and Action from this module directly.
export type { AppAbility, Subject, Action } from "./types";
