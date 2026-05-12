/**
 * Restore operator-only edits to `locations` after a v2 wipe-and-reseed.
 *
 * Pairs with scripts/v2-wipe-and-reseed.ts which dumps a snapshot of every
 * `locations` row (via `row_to_json(l)`) to /tmp/locations-pre-reseed-<ts>.json
 * BEFORE the TRUNCATE. The reseed re-derives most fields from Monday, but a
 * handful of columns are operator-managed and Monday cannot supply them
 * (hand-typed notes, the LOCATION_NEEDED sentinel's address, banking details,
 * future overrides). This script diffs the snapshot against the post-reseed
 * state and, for each allowed column where snapshot has a value AND current
 * is NULL (or `iana_timezone` has reverted to the 'UTC' default), queues a
 * surgical single-column UPDATE.
 *
 * Match key precedence per snapshot row:
 *   1. `monday_item_id` (universal idempotency key for Monday-sourced rows)
 *   2. (`name`, `primary_region_id`) — fallback for non-Monday rows like the
 *      LOCATION_NEEDED sentinel.
 *
 * Snapshot rows with no current counterpart (operator deleted the row
 * post-reseed) are logged as warnings and skipped — never re-inserted.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx --tsconfig tsconfig.json \
 *     scripts/restore-locations-operator-edits.ts \
 *     --snapshot=/tmp/locations-pre-reseed-<ts>.json [--apply] \
 *     [--field-allowlist=notes,address,banking_details]
 *
 * Dry-run is the default. --apply runs the UPDATEs inside one transaction.
 */
import { readFileSync, existsSync } from "fs";
import { Pool, type PoolClient } from "pg";

// ────────────────────────────────────────────────────────────────────────────
// Types — shape comes from `row_to_json(l)` in v2-wipe-and-reseed.ts, so all
// columns are snake_case JSON. We only type the fields we care about; the rest
// pass through unread.
// ────────────────────────────────────────────────────────────────────────────
export type SnapshotRow = {
  id: string;
  name: string;
  primary_region_id: string;
  monday_item_id: string | null;
  [field: string]: unknown;
};

export type CurrentRow = {
  id: string;
  name: string;
  primary_region_id: string;
  monday_item_id: string | null;
  [field: string]: unknown;
};

export type UpdateAction = {
  currentId: string;
  snapshotId: string;
  matchedBy: "monday_item_id" | "name+region";
  field: string;
  snapshotValue: unknown;
  currentValue: unknown;
};

export type UnmatchedSnapshot = {
  snapshotId: string;
  snapshotName: string;
  snapshotMondayItemId: string | null;
};

export type RestorePlan = {
  updates: UpdateAction[];
  unmatched: UnmatchedSnapshot[];
  summary: {
    rowsWithRestorableFields: number;
    totalRestoredFields: number;
    perField: Record<string, number>;
  };
};

/**
 * Columns Monday does NOT supply, so operator edits are the only source of
 * truth. Restoring these is safe iff current is NULL (or iana_timezone has
 * reverted to its schema default 'UTC'). See src/db/schema.ts `locations`
 * for canonical types. We never touch identity columns:
 *   id, name, normalised_name, customer_code, monday_item_id,
 *   primary_region_id, created_at, updated_at.
 */
export const DEFAULT_ALLOWLIST: readonly string[] = [
  "notes",
  "banking_details",
  "contract_value",
  "contract_start_date",
  "contract_end_date",
  "contract_terms",
  "contract_documents",
  "hardware_assets",
  "key_contacts",
  "internal_poc_id",
  "iana_timezone",
  "custom_fields",
  "address",
  "location_type",
  "archived_at",
  "latitude",
  "longitude",
];

// iana_timezone is `NOT NULL DEFAULT 'UTC'` — treat 'UTC' as "effectively
// unset" so we restore a snapshot's 'Europe/London' over a default 'UTC'.
function currentIsEmpty(field: string, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (field === "iana_timezone" && value === "UTC") return true;
  return false;
}

function snapshotHasValue(field: string, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  // For iana_timezone, 'UTC' is the no-op default — don't queue a UPDATE
  // that just re-sets the default.
  if (field === "iana_timezone" && value === "UTC") return false;
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Pure diff function — fully unit-tested. No DB.
// ────────────────────────────────────────────────────────────────────────────
export function computeRestorePlan(
  snapshotRows: SnapshotRow[],
  currentRows: CurrentRow[],
  allowlist: readonly string[],
): RestorePlan {
  // Index current rows by Monday id and by (name, region) for O(1) lookup.
  const byMondayId = new Map<string, CurrentRow>();
  const byNameRegion = new Map<string, CurrentRow>();
  for (const c of currentRows) {
    if (c.monday_item_id) byMondayId.set(c.monday_item_id, c);
    // NUL-byte separator eliminates a theoretical collision between rows
    // whose `name + primary_region_id` concatenations alias each other
    // (e.g. name="Foo " + region="bar..." vs name="Foo" + region=" bar...").
    byNameRegion.set(`${c.name}\x00${c.primary_region_id}`, c);
  }

  const updates: UpdateAction[] = [];
  const unmatched: UnmatchedSnapshot[] = [];
  const perField: Record<string, number> = {};
  const rowsTouched = new Set<string>();

  for (const s of snapshotRows) {
    let match: CurrentRow | undefined;
    let matchedBy: "monday_item_id" | "name+region" | null = null;

    if (s.monday_item_id) {
      match = byMondayId.get(s.monday_item_id);
      if (match) matchedBy = "monday_item_id";
    }
    if (!match) {
      match = byNameRegion.get(`${s.name}\x00${s.primary_region_id}`);
      if (match) matchedBy = "name+region";
    }

    if (!match || !matchedBy) {
      unmatched.push({
        snapshotId: s.id,
        snapshotName: s.name,
        snapshotMondayItemId: s.monday_item_id,
      });
      continue;
    }

    for (const field of allowlist) {
      const snapVal = s[field];
      const currVal = match[field];
      if (snapshotHasValue(field, snapVal) && currentIsEmpty(field, currVal)) {
        updates.push({
          currentId: match.id,
          snapshotId: s.id,
          matchedBy,
          field,
          snapshotValue: snapVal,
          currentValue: currVal ?? null,
        });
        perField[field] = (perField[field] ?? 0) + 1;
        rowsTouched.add(match.id);
      }
    }
  }

  return {
    updates,
    unmatched,
    summary: {
      rowsWithRestorableFields: rowsTouched.size,
      totalRestoredFields: updates.length,
      perField,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CLI / I/O — runs only when invoked directly.
// ────────────────────────────────────────────────────────────────────────────
export function parseArgs(argv: string[]): {
  snapshotPath: string;
  apply: boolean;
  allowlist: readonly string[];
} {
  let snapshotPath: string | null = null;
  let apply = false;
  let allowlist: readonly string[] = DEFAULT_ALLOWLIST;

  for (const arg of argv.slice(2)) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg.startsWith("--snapshot=")) {
      snapshotPath = arg.slice("--snapshot=".length);
    } else if (arg.startsWith("--field-allowlist=")) {
      const parsed = arg
        .slice("--field-allowlist=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // Validate at parse time — applyPlan's safety net (refusing to UPDATE
      // a non-allowlisted field name) is a last-resort guard; the operator
      // should see the bad input rejected up-front with a clear message.
      const invalidFields = parsed.filter(
        (f) => !DEFAULT_ALLOWLIST.includes(f),
      );
      if (invalidFields.length > 0) {
        throw new Error(
          `--field-allowlist contains fields not in DEFAULT_ALLOWLIST: ${invalidFields.join(", ")}`,
        );
      }
      allowlist = parsed;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!snapshotPath) {
    throw new Error(
      "Missing required --snapshot=<path> (path to the JSON file produced by v2-wipe-and-reseed.ts)",
    );
  }
  return { snapshotPath, apply, allowlist };
}

function preview(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "string") {
    return v.length > 40 ? JSON.stringify(v.slice(0, 37) + "...") : JSON.stringify(v);
  }
  const s = JSON.stringify(v);
  return s.length > 40 ? s.slice(0, 37) + "..." : s;
}

function printPlan(plan: RestorePlan, apply: boolean): void {
  console.log(
    `\n=== Restore plan (${apply ? "APPLY" : "DRY-RUN"}) ===`,
  );
  console.log(
    `rows_with_restorable_fields: ${plan.summary.rowsWithRestorableFields}`,
  );
  console.log(`total_restored_fields:       ${plan.summary.totalRestoredFields}`);
  console.log("");
  if (Object.keys(plan.summary.perField).length > 0) {
    console.log("per-field breakdown:");
    for (const [f, n] of Object.entries(plan.summary.perField).sort()) {
      console.log(`  ${f.padEnd(28)} ${String(n).padStart(4)}`);
    }
    console.log("");
  }

  if (plan.updates.length > 0) {
    console.log("Proposed UPDATEs:");
    const head =
      "match".padEnd(16) +
      "id".padEnd(38) +
      "field".padEnd(22) +
      "old".padEnd(20) +
      "new";
    console.log(head);
    console.log("-".repeat(head.length + 20));
    for (const u of plan.updates) {
      console.log(
        u.matchedBy.padEnd(16) +
          u.currentId.padEnd(38) +
          u.field.padEnd(22) +
          preview(u.currentValue).padEnd(20) +
          " " +
          preview(u.snapshotValue),
      );
    }
    console.log("");
  }

  if (plan.unmatched.length > 0) {
    console.warn(
      `WARNING: ${plan.unmatched.length} snapshot row(s) have no current match (likely deleted post-reseed):`,
    );
    for (const u of plan.unmatched) {
      console.warn(
        `  - id=${u.snapshotId} name=${JSON.stringify(u.snapshotName)} monday_item_id=${u.snapshotMondayItemId ?? "NULL"}`,
      );
    }
    console.warn(
      "These rows are SKIPPED. Operator may decide to re-insert manually.",
    );
    console.log("");
  }
}

async function applyPlan(client: PoolClient, plan: RestorePlan): Promise<void> {
  await client.query("BEGIN");
  try {
    for (const u of plan.updates) {
      // Whitelisted field names only; never interpolate user input.
      if (!DEFAULT_ALLOWLIST.includes(u.field)) {
        throw new Error(`Refusing to update non-allowlisted field: ${u.field}`);
      }
      await client.query(
        `UPDATE locations SET "${u.field}" = $1, updated_at = now() WHERE id = $2`,
        [u.snapshotValue, u.currentId],
      );
    }
    await client.query("COMMIT");
    console.log(`Applied ${plan.updates.length} UPDATE(s) in one transaction.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function main(): Promise<void> {
  const { snapshotPath, apply, allowlist } = parseArgs(process.argv);
  if (!existsSync(snapshotPath)) {
    throw new Error(`Snapshot file not found: ${snapshotPath}`);
  }
  const rawJson = readFileSync(snapshotPath, "utf8");
  let snapshotRows: SnapshotRow[];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) {
      throw new Error("Snapshot JSON root must be an array of row objects");
    }
    snapshotRows = parsed as SnapshotRow[];
  } catch (err) {
    throw new Error(
      `Failed to parse snapshot JSON at ${snapshotPath}: ${(err as Error).message}`,
    );
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: url });

  try {
    const currentResult = await pool.query<CurrentRow>(
      `SELECT * FROM locations`,
    );
    const plan = computeRestorePlan(
      snapshotRows,
      currentResult.rows,
      allowlist,
    );
    printPlan(plan, apply);

    if (apply && plan.updates.length > 0) {
      const client = await pool.connect();
      try {
        await applyPlan(client, plan);
      } finally {
        client.release();
      }
    } else if (!apply) {
      console.log("Dry-run only. Re-run with --apply to commit the UPDATEs.");
    } else {
      console.log("Nothing to apply.");
    }
  } finally {
    await pool.end();
  }
}

// Only run main() if invoked directly via `tsx scripts/...`. When the file
// is imported by the unit test, `main()` must not auto-execute.
const invokedDirectly = (() => {
  try {
    const entry = process.argv[1] ?? "";
    return entry.endsWith("restore-locations-operator-edits.ts");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
