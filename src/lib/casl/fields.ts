import { getTableColumns } from "drizzle-orm";
import { permittedFieldsOf } from "@casl/ability/extra";
import type { AppAbility, Subject } from "./types";
import { SUBJECT_TABLES } from "./subjects";

/**
 * Returns all column names from the Drizzle table backing a given Subject.
 * Used as the "universe" of fields when computing readable fields for
 * broad can("read", Subject) rules that don't specify a field list.
 */
export function fieldsOfSubject(subject: Subject): string[] {
  const table = SUBJECT_TABLES[subject as keyof typeof SUBJECT_TABLES];
  if (!table) return [];
  return Object.keys(getTableColumns(table));
}

/**
 * Returns the set of fields the given ability allows reading for a Subject.
 *
 * Uses CASL's permittedFieldsOf with the full column list as the fieldsFrom
 * callback — this correctly handles:
 *   - Broad can("read", Subject) rules → returns all schema columns
 *   - Field-scoped can("read", Subject, [f1, f2]) rules → returns those fields
 *   - cannot("read", Subject, [f]) rules → subtracts those fields
 *   - No can rules → returns []
 */
export function readableFields(ability: AppAbility, subject: Subject): string[] {
  const allColumns = fieldsOfSubject(subject);
  if (allColumns.length === 0) return [];

  return permittedFieldsOf(ability, "read", subject as Subject, {
    fieldsFrom: (rule) => {
      // If the rule has explicit fields, use them; otherwise use all columns.
      return rule.fields?.length ? rule.fields : allColumns;
    },
  }) as string[];
}
