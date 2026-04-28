/**
 * Unit tests for `scripts/probe-multi-pos-merge-collisions.ts`.
 *
 * Tests the pure CSV parser + the collision-probe function with a stubbed
 * query callback so no real DB is touched. Asserts every warning string the
 * report can produce + the exit-code logic.
 */
import { describe, it, expect } from "vitest";
import {
  parseProposalCsv,
  probeCollisionsForPair,
  formatReport,
  type Pair,
  type QueryFn,
} from "../../../scripts/probe-multi-pos-merge-collisions";

const CANONICAL = "00000000-0000-0000-0000-000000000001";
const DEFUNCT = "00000000-0000-0000-0000-000000000002";
const REGION_A = "11111111-1111-1111-1111-111111111111";
const REGION_B = "22222222-2222-2222-2222-222222222222";
const HOTEL_GROUP_X = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PRODUCT_X = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PROVIDER_X = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const PAIR: Pair = {
  clusterId: 1,
  canonicalId: CANONICAL,
  canonicalName: "Canonical Hotel",
  defunctId: DEFUNCT,
  defunctName: "Defunct Hotel",
};

/**
 * Build a canned query stub keyed on the SQL FROM table. Each table key maps
 * to the rows the stub should return for that query.
 */
function makeQueryStub(canned: Record<string, Record<string, unknown>[]>): QueryFn {
  return async (text: string) => {
    if (text.includes("FROM location_region_memberships")) {
      return { rows: canned.location_region_memberships ?? [] };
    }
    if (text.includes("FROM location_group_memberships")) {
      return { rows: canned.location_group_memberships ?? [] };
    }
    if (text.includes("FROM location_hotel_group_memberships")) {
      return { rows: canned.location_hotel_group_memberships ?? [] };
    }
    if (text.includes("FROM location_products")) {
      return { rows: canned.location_products ?? [] };
    }
    if (text.includes("FROM locations")) {
      return { rows: canned.locations ?? [] };
    }
    return { rows: [] };
  };
}

describe("parseProposalCsv", () => {
  it("skips self-rows (defunct_id empty) and yields one Pair per defunct row", () => {
    const csv = [
      "cluster_id,cluster_basis,address,region,canonical_outlet_code,canonical_id,canonical_name,canonical_sales_count,canonical_amount_total,defunct_outlet_code,defunct_id,defunct_name,defunct_sales_count,defunct_amount_total,defunct_kiosks_count,notes",
      `1,address,"A St, City",UK,X1,${CANONICAL},Canonical,0,0,,,,0,0,,`,
      `1,address,"A St, City",UK,X1,${CANONICAL},Canonical,0,0,X2,${DEFUNCT},Defunct,0,0,1,`,
    ].join("\n");
    const pairs = parseProposalCsv(csv);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({
      clusterId: 1,
      canonicalId: CANONICAL,
      canonicalName: "Canonical",
      defunctId: DEFUNCT,
      defunctName: "Defunct",
    });
  });

  it("handles quoted fields with embedded commas", () => {
    const csv = [
      "cluster_id,cluster_basis,address,region,canonical_outlet_code,canonical_id,canonical_name,canonical_sales_count,canonical_amount_total,defunct_outlet_code,defunct_id,defunct_name,defunct_sales_count,defunct_amount_total,defunct_kiosks_count,notes",
      `2,address,"Heathrow, Hayes, UK",UK,X1,${CANONICAL},"Hotel, A Member of X",0,0,X2,${DEFUNCT},"Hotel, Sister",0,0,1,`,
    ].join("\n");
    const pairs = parseProposalCsv(csv);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].canonicalName).toBe("Hotel, A Member of X");
    expect(pairs[0].defunctName).toBe("Hotel, Sister");
  });
});

describe("probeCollisionsForPair", () => {
  it("returns no warnings for a clean pair", async () => {
    const query = makeQueryStub({
      // No memberships, no products. Both rows have the same region.
      locations: [
        { id: CANONICAL, primary_region_id: REGION_A },
        { id: DEFUNCT, primary_region_id: REGION_A },
      ],
    });
    const report = await probeCollisionsForPair(PAIR, query);
    expect(report.warnings).toEqual([]);
  });

  it("flags region collision when both rows have a location_region_memberships row", async () => {
    const query = makeQueryStub({
      location_region_memberships: [
        { location_id: CANONICAL },
        { location_id: DEFUNCT },
      ],
      locations: [
        { id: CANONICAL, primary_region_id: REGION_A },
        { id: DEFUNCT, primary_region_id: REGION_A },
      ],
    });
    const report = await probeCollisionsForPair(PAIR, query);
    expect(report.warnings.some((w) => w.includes("region collision"))).toBe(true);
  });

  it("flags group collision when both rows have a location_group_memberships row", async () => {
    const query = makeQueryStub({
      location_group_memberships: [
        { location_id: CANONICAL },
        { location_id: DEFUNCT },
      ],
      locations: [
        { id: CANONICAL, primary_region_id: REGION_A },
        { id: DEFUNCT, primary_region_id: REGION_A },
      ],
    });
    const report = await probeCollisionsForPair(PAIR, query);
    expect(report.warnings.some((w) => w.includes("group collision"))).toBe(true);
  });

  it("flags hotel_group PK collision when canonical and defunct share a hotel_group_id", async () => {
    const query = makeQueryStub({
      location_hotel_group_memberships: [
        { location_id: CANONICAL, hotel_group_id: HOTEL_GROUP_X },
        { location_id: DEFUNCT, hotel_group_id: HOTEL_GROUP_X },
      ],
      locations: [
        { id: CANONICAL, primary_region_id: REGION_A },
        { id: DEFUNCT, primary_region_id: REGION_A },
      ],
    });
    const report = await probeCollisionsForPair(PAIR, query);
    expect(
      report.warnings.some((w) => w.includes("hotel_group PK collision")),
    ).toBe(true);
  });

  it("flags location_products PK collision when both rows share (product_id, provider_id)", async () => {
    const query = makeQueryStub({
      location_products: [
        { location_id: CANONICAL, product_id: PRODUCT_X, provider_id: PROVIDER_X },
        { location_id: DEFUNCT, product_id: PRODUCT_X, provider_id: PROVIDER_X },
      ],
      locations: [
        { id: CANONICAL, primary_region_id: REGION_A },
        { id: DEFUNCT, primary_region_id: REGION_A },
      ],
    });
    const report = await probeCollisionsForPair(PAIR, query);
    expect(
      report.warnings.some((w) => w.includes("location_products PK collision")),
    ).toBe(true);
  });

  it("flags cross-region merge when canonical and defunct have different primary_region_id", async () => {
    const query = makeQueryStub({
      locations: [
        { id: CANONICAL, primary_region_id: REGION_A },
        { id: DEFUNCT, primary_region_id: REGION_B },
      ],
    });
    const report = await probeCollisionsForPair(PAIR, query);
    expect(report.warnings.some((w) => w.includes("cross-region merge"))).toBe(true);
  });

  it("does NOT flag region collision if only one side has a membership row", async () => {
    const query = makeQueryStub({
      location_region_memberships: [{ location_id: CANONICAL }],
      locations: [
        { id: CANONICAL, primary_region_id: REGION_A },
        { id: DEFUNCT, primary_region_id: REGION_A },
      ],
    });
    const report = await probeCollisionsForPair(PAIR, query);
    expect(report.warnings.some((w) => w.includes("region collision"))).toBe(false);
  });
});

describe("formatReport", () => {
  it("returns exit code 0 and a clean message when no warnings", () => {
    const result = formatReport([{ pair: PAIR, warnings: [] }]);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("no collisions detected");
  });

  it("returns exit code 1 when any pair has warnings", () => {
    const result = formatReport([
      { pair: PAIR, warnings: ["region collision: example"] },
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("region collision");
    expect(result.output).toContain("Cluster 1");
  });

  it("groups multiple pairs by cluster_id and skips clusters with no warnings", () => {
    const cleanPair: Pair = { ...PAIR, clusterId: 2 };
    const result = formatReport([
      { pair: PAIR, warnings: ["region collision: x"] },
      { pair: cleanPair, warnings: [] },
    ]);
    expect(result.output).toContain("Cluster 1");
    expect(result.output).not.toContain("Cluster 2");
    expect(result.exitCode).toBe(1);
  });
});
