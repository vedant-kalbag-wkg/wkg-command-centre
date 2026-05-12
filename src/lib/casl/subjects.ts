import {
  auditLogs,
  analyticsPresets,
  emailLog,
  kiosks,
  locationProducts,
  locations,
  rolePermissions,
  roles,
  user,
} from "@/db/schema";
import { SUBJECTS, ACTIONS, type Subject, type Action } from "./types";

/**
 * Maps each CASL Subject literal to its backing Drizzle PgTable.
 * Used by readableFields/fieldsOfSubject to auto-derive the column list.
 *
 * Note: "Analytics" maps to analyticsPresets — the queryable analytics
 * entity that CASL rules govern (saved configurations + shared views).
 */
export const SUBJECT_TABLES = {
  Location: locations,
  Kiosk: kiosks,
  User: user,
  AuditLog: auditLogs,
  Analytics: analyticsPresets,
  RolePermission: rolePermissions,
  EmailLog: emailLog,
  LocationProduct: locationProducts,
  Role: roles,
} as const;

export type SubjectTable = (typeof SUBJECT_TABLES)[keyof typeof SUBJECT_TABLES];

const SUBJECT_SET = new Set<string>(SUBJECTS);
const ACTION_SET = new Set<string>(ACTIONS);

/**
 * Asserts that the given string is a valid CASL Subject literal.
 * Throws a descriptive error for unknown / wrong-cased subjects.
 * Subjects are case-sensitive — "location" and "LOCATION" are not valid.
 */
export function assertValidSubject(value: unknown): asserts value is Subject {
  if (typeof value !== "string" || !SUBJECT_SET.has(value)) {
    throw new Error(
      `Unknown CASL subject: ${JSON.stringify(value)}. ` +
        `Valid subjects are: ${[...SUBJECT_SET].join(", ")}`,
    );
  }
}

/**
 * Asserts that the given string is a valid CASL Action literal.
 * Throws a descriptive error for unknown / wrong-cased actions.
 * Actions are case-sensitive — "Read" and "READ" are not valid.
 */
export function assertValidAction(value: unknown): asserts value is Action {
  if (typeof value !== "string" || !ACTION_SET.has(value)) {
    throw new Error(
      `Unknown CASL action: ${JSON.stringify(value)}. ` +
        `Valid actions are: ${[...ACTION_SET].join(", ")}`,
    );
  }
}
