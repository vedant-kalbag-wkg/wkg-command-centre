import { describe, it, expect } from "vitest";
import {
  computeRestorePlan,
  DEFAULT_ALLOWLIST,
  parseArgs,
  type SnapshotRow,
  type CurrentRow,
} from "../../scripts/restore-locations-operator-edits";

/**
 * Pure-function tests for the diff/plan computation. The DB I/O parts of
 * the script (Pool, BEGIN/COMMIT) are exercised manually by the operator
 * during the v2 wipe-and-reseed runbook; they're trivial CRUD on top of
 * the plan this function returns.
 */

const REGION_GLOBAL = "00000000-0000-0000-0000-000000000001";
const REGION_UK = "00000000-0000-0000-0000-000000000002";

function snap(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: "snap-id-1",
    name: "Some Hotel",
    primary_region_id: REGION_UK,
    monday_item_id: "monday-1",
    notes: null,
    address: null,
    banking_details: null,
    contract_value: null,
    contract_start_date: null,
    contract_end_date: null,
    contract_terms: null,
    contract_documents: null,
    hardware_assets: null,
    key_contacts: null,
    internal_poc_id: null,
    iana_timezone: "UTC",
    custom_fields: null,
    location_type: null,
    archived_at: null,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

function curr(overrides: Partial<CurrentRow> = {}): CurrentRow {
  return {
    id: "curr-id-1",
    name: "Some Hotel",
    primary_region_id: REGION_UK,
    monday_item_id: "monday-1",
    notes: null,
    address: null,
    banking_details: null,
    contract_value: null,
    contract_start_date: null,
    contract_end_date: null,
    contract_terms: null,
    contract_documents: null,
    hardware_assets: null,
    key_contacts: null,
    internal_poc_id: null,
    iana_timezone: "UTC",
    custom_fields: null,
    location_type: null,
    archived_at: null,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

describe("computeRestorePlan", () => {
  it("queues an UPDATE when snapshot has notes and current is null (Monday-keyed match)", () => {
    const snapshot = [snap({ notes: "operator wrote this" })];
    const current = [curr({ notes: null })];
    const result = computeRestorePlan(snapshot, current, DEFAULT_ALLOWLIST);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toMatchObject({
      currentId: "curr-id-1",
      field: "notes",
      snapshotValue: "operator wrote this",
      currentValue: null,
      matchedBy: "monday_item_id",
    });
    expect(result.unmatched).toHaveLength(0);
  });

  it("does NOT queue an update when both snapshot and current have a value (current wins)", () => {
    const snapshot = [snap({ notes: "old operator note" })];
    const current = [curr({ notes: "monday or operator wrote this post-reseed" })];
    const result = computeRestorePlan(snapshot, current, DEFAULT_ALLOWLIST);
    expect(result.updates).toHaveLength(0);
  });

  it("does NOT queue an update when snapshot is null", () => {
    const snapshot = [snap({ notes: null })];
    const current = [curr({ notes: null })];
    const result = computeRestorePlan(snapshot, current, DEFAULT_ALLOWLIST);
    expect(result.updates).toHaveLength(0);
  });

  it("falls back to (name, primary_region_id) for snapshot rows with no monday_item_id (LOCATION_NEEDED sentinel)", () => {
    const sentinelSnap = snap({
      id: "snap-sentinel",
      name: "LOCATION_NEEDED",
      primary_region_id: REGION_GLOBAL,
      monday_item_id: null,
      address: "Operator-typed address",
    });
    const sentinelCurr = curr({
      id: "curr-sentinel",
      name: "LOCATION_NEEDED",
      primary_region_id: REGION_GLOBAL,
      monday_item_id: null,
      address: null,
    });
    const result = computeRestorePlan([sentinelSnap], [sentinelCurr], DEFAULT_ALLOWLIST);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toMatchObject({
      currentId: "curr-sentinel",
      field: "address",
      snapshotValue: "Operator-typed address",
      matchedBy: "name+region",
    });
  });

  it("reports unmatched when snapshot row has no current counterpart (post-reseed deletion)", () => {
    const snapshot = [snap({ id: "gone-from-current", monday_item_id: "monday-99", notes: "lost" })];
    const current: CurrentRow[] = [];
    const result = computeRestorePlan(snapshot, current, DEFAULT_ALLOWLIST);
    expect(result.updates).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]).toMatchObject({
      snapshotId: "gone-from-current",
      snapshotName: "Some Hotel",
    });
  });

  it("respects a custom field allowlist (notes only)", () => {
    const snapshot = [snap({ notes: "n", hardware_assets: "h" })];
    const current = [curr({ notes: null, hardware_assets: null })];
    const result = computeRestorePlan(snapshot, current, ["notes"]);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].field).toBe("notes");
  });

  it("does not restore iana_timezone when current is the schema default 'UTC' and snapshot is also 'UTC'", () => {
    const snapshot = [snap({ iana_timezone: "UTC" })];
    const current = [curr({ iana_timezone: "UTC" })];
    const result = computeRestorePlan(snapshot, current, DEFAULT_ALLOWLIST);
    expect(result.updates.filter((u) => u.field === "iana_timezone")).toHaveLength(0);
  });

  it("restores iana_timezone when snapshot has a non-default value and current has reverted to 'UTC'", () => {
    const snapshot = [snap({ iana_timezone: "Europe/London" })];
    const current = [curr({ iana_timezone: "UTC" })];
    const result = computeRestorePlan(snapshot, current, DEFAULT_ALLOWLIST);
    const tzUpdate = result.updates.find((u) => u.field === "iana_timezone");
    expect(tzUpdate).toBeDefined();
    expect(tzUpdate?.snapshotValue).toBe("Europe/London");
  });

  it("treats jsonb fields as restorable when snapshot has an object and current is null", () => {
    const snapshot = [
      snap({ banking_details: { bank: "Acme", acct: "1234" } as unknown as null }),
    ];
    const current = [curr({ banking_details: null })];
    const result = computeRestorePlan(snapshot, current, DEFAULT_ALLOWLIST);
    const bd = result.updates.find((u) => u.field === "banking_details");
    expect(bd).toBeDefined();
    expect(bd?.snapshotValue).toEqual({ bank: "Acme", acct: "1234" });
  });

  it("matches by (name, primary_region_id) without false positives across boundary collisions", () => {
    // NUL-byte separator on the byNameRegion key eliminates a theoretical
    // collision between rows whose `name + primary_region_id` concatenations
    // alias each other. With the previous joinless key `${name}${region}`,
    // a row {name:"Foo", region:"1abcd"} and {name:"Foo1", region:"abcd"} both
    // map to "Foo1abcd". The NUL-byte form keeps them distinct so the
    // snapshot row matches the correct current row.
    const snapshot = [
      snap({
        id: "snap-1",
        name: "Foo",
        primary_region_id: "1abcd",
        monday_item_id: null,
        notes: "for Foo",
      }),
    ];
    const current = [
      curr({
        id: "curr-foo1-abcd",
        name: "Foo1",
        primary_region_id: "abcd",
        monday_item_id: null,
        notes: null,
      }),
      curr({
        id: "curr-foo-1abcd",
        name: "Foo",
        primary_region_id: "1abcd",
        monday_item_id: null,
        notes: null,
      }),
    ];
    const result = computeRestorePlan(snapshot, current, DEFAULT_ALLOWLIST);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].currentId).toBe("curr-foo-1abcd");
  });

  it("aggregates per-field counts in the summary", () => {
    const snapshot = [
      snap({ id: "s1", monday_item_id: "m1", notes: "a" }),
      snap({ id: "s2", monday_item_id: "m2", notes: "b" }),
      snap({ id: "s3", monday_item_id: "m3", hardware_assets: "h" }),
    ];
    const current = [
      curr({ id: "c1", monday_item_id: "m1" }),
      curr({ id: "c2", monday_item_id: "m2" }),
      curr({ id: "c3", monday_item_id: "m3" }),
    ];
    const result = computeRestorePlan(snapshot, current, DEFAULT_ALLOWLIST);
    expect(result.summary.totalRestoredFields).toBe(3);
    expect(result.summary.rowsWithRestorableFields).toBe(3);
    expect(result.summary.perField.notes).toBe(2);
    expect(result.summary.perField.hardware_assets).toBe(1);
  });
});

describe("parseArgs", () => {
  // parseArgs reads argv-shaped string[], so we mimic the
  // `["node", "script.ts", ...args]` shape Node hands main().
  function argv(...args: string[]): string[] {
    return ["node", "scripts/restore-locations-operator-edits.ts", ...args];
  }

  it("accepts a custom --field-allowlist where every field is in DEFAULT_ALLOWLIST", () => {
    const parsed = parseArgs(
      argv(
        "--snapshot=/tmp/some.json",
        "--field-allowlist=notes,address,banking_details",
      ),
    );
    expect(parsed.snapshotPath).toBe("/tmp/some.json");
    expect(parsed.apply).toBe(false);
    expect(parsed.allowlist).toEqual(["notes", "address", "banking_details"]);
  });

  it("throws when --field-allowlist contains a field not in DEFAULT_ALLOWLIST", () => {
    expect(() =>
      parseArgs(
        argv(
          "--snapshot=/tmp/some.json",
          "--field-allowlist=notes,not_a_real_column,address",
        ),
      ),
    ).toThrow(
      /--field-allowlist contains fields not in DEFAULT_ALLOWLIST: not_a_real_column/,
    );
  });

  it("defaults to DEFAULT_ALLOWLIST when --field-allowlist is omitted", () => {
    const parsed = parseArgs(argv("--snapshot=/tmp/some.json"));
    expect(parsed.allowlist).toBe(DEFAULT_ALLOWLIST);
  });
});
