// Phase 9 Plan 09-04 — Render-assertion tests for PocUnderperformanceEmail.
//
// TDD RED phase: these tests are written before the component exists.
// Run with: npx vitest run --project unit src/emails/__tests__/poc-underperformance.test.ts

import { render } from "@react-email/render";
import { describe, it, expect } from "vitest";

import { BRAND } from "../brand";
import { PocUnderperformanceEmail } from "../poc-underperformance";

const ONE_KIOSK_PROPS = {
  pocName: "Alex",
  kiosks: [
    {
      kioskId: "K001",
      locationName: "Hilton Mayfair",
      region: "London",
      revenue: 123.45,
      percentile: 8,
      detailUrl: `${BRAND.prodUrl}/kiosks/abc-123`,
    },
  ],
  moreCount: 0,
  windowDays: 30,
  runIsoWeek: "2026-W19",
};

const THREE_KIOSK_PROPS = {
  pocName: "Sam",
  kiosks: [
    {
      kioskId: "K010",
      locationName: "Marriott Canary Wharf",
      region: "London",
      revenue: 200.0,
      percentile: 5,
      detailUrl: `${BRAND.prodUrl}/kiosks/k010`,
    },
    {
      kioskId: "K011",
      locationName: "Premier Inn Bristol",
      region: "South West",
      revenue: 150.75,
      percentile: 12,
      detailUrl: `${BRAND.prodUrl}/kiosks/k011`,
    },
    {
      kioskId: "K012",
      locationName: "Ibis Manchester",
      region: "North West",
      revenue: 99.0,
      percentile: 3,
      detailUrl: `${BRAND.prodUrl}/kiosks/k012`,
    },
  ],
  moreCount: 0,
  windowDays: 14,
  runIsoWeek: "2026-W20",
};

const TWO_KIOSK_SNAPSHOT_PROPS = {
  pocName: "Jordan",
  kiosks: [
    {
      kioskId: "K100",
      locationName: "Hilton Leeds",
      region: "Yorkshire",
      revenue: 345.67,
      percentile: 7,
      detailUrl: `${BRAND.prodUrl}/kiosks/k100`,
    },
    {
      kioskId: "K101",
      locationName: "Travelodge Edinburgh",
      region: "Scotland",
      revenue: 88.0,
      percentile: 4,
      detailUrl: `${BRAND.prodUrl}/kiosks/k101`,
    },
  ],
  moreCount: 0,
  windowDays: 30,
  runIsoWeek: "2026-W20",
};

describe("PocUnderperformanceEmail", () => {
  it("Test 1: renders kiosk row with location, region, revenue, percentile, detailUrl", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_KIOSK_PROPS} />);
    expect(html).toContain("Hilton Mayfair");
    expect(html).toContain("London");
    expect(html).toContain("123.45");
    expect(html).toContain("8");
    expect(html).toContain(`${BRAND.prodUrl}/kiosks/abc-123`);
  });

  it("Test 2: renders all 3 kiosk locationNames in document order", async () => {
    const html = await render(
      <PocUnderperformanceEmail {...THREE_KIOSK_PROPS} />,
    );
    const idxMarriott = html.indexOf("Marriott Canary Wharf");
    const idxPremier = html.indexOf("Premier Inn Bristol");
    const idxIbis = html.indexOf("Ibis Manchester");
    expect(idxMarriott).toBeGreaterThan(-1);
    expect(idxPremier).toBeGreaterThan(-1);
    expect(idxIbis).toBeGreaterThan(-1);
    expect(idxMarriott).toBeLessThan(idxPremier);
    expect(idxPremier).toBeLessThan(idxIbis);
  });

  it("Test 3: renders '12 more' copy when moreCount=12", async () => {
    const html = await render(
      <PocUnderperformanceEmail
        {...ONE_KIOSK_PROPS}
        moreCount={12}
      />,
    );
    expect(html).toContain("12");
    expect(html).toContain("more");
  });

  it("Test 4: does NOT render 'more' copy when moreCount=0", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_KIOSK_PROPS} />);
    // should not contain "more kiosk" — the "+ N more kiosks" conditional
    expect(html).not.toContain("more kiosk");
  });

  it("Test 5: renders CTA href pointing at /analytics/portfolio", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_KIOSK_PROPS} />);
    expect(html).toContain(`${BRAND.prodUrl}/analytics/portfolio`);
  });

  it("Test 6: renders recipient name from pocName", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_KIOSK_PROPS} />);
    expect(html).toContain("Alex");
  });

  it("Test 7: renders brand color #00A6D3 (Azure CTA) somewhere", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_KIOSK_PROPS} />);
    expect(html).toContain("#00A6D3");
  });

  it("Test 8: renders brand color #121212 (Graphite heading) somewhere", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_KIOSK_PROPS} />);
    expect(html).toContain("#121212");
  });

  it("Test 9: renders windowDays as number in body copy", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_KIOSK_PROPS} />);
    expect(html).toContain("30");
  });

  it("Test 10: snapshot for canonical 2-kiosk render", async () => {
    const html = await render(
      <PocUnderperformanceEmail {...TWO_KIOSK_SNAPSHOT_PROPS} />,
    );
    expect(html).toMatchSnapshot();
  });
});
