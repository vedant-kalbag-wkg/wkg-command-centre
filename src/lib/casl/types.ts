import type { MongoAbility } from "@casl/ability";

export const ACTIONS = [
  "manage",
  "read",
  "create",
  "update",
  "delete",
  "merge",
  "impersonate",
  "import",
  "export",
  "silence_alert",
] as const;
export type Action = (typeof ACTIONS)[number];

export const SUBJECTS = [
  "all",
  "Kiosk",
  "Location",
  "User",
  "AuditLog",
  "Analytics",
  "RolePermission",
  "EmailLog",
  "LocationProduct",
  "Role",
] as const;
export type Subject = (typeof SUBJECTS)[number];

/** Re-exported alias for consumers that need a typed list of non-"all" subjects. */
export const KNOWN_SUBJECTS = SUBJECTS;

export type AppAbility = MongoAbility<[Action, Subject]>;

export type RawRule = {
  action: Action | string;
  subject: Subject | string;
  fields?: string[] | null;
  conditions?: Record<string, unknown> | null;
  inverted?: boolean;
};
