// Phase 9 (hotel-level rewrite, post PR #38) — Render-assertion tests for
// PocUnderperformanceEmail.
//
// Run with: npx vitest run --project unit src/emails/__tests__/poc-underperformance.test.tsx

import { render } from "@react-email/render";
import { describe, it, expect } from "vitest";

import { BRAND } from "../brand";
import { PocUnderperformanceEmail } from "../poc-underperformance";

const ONE_HOTEL_PROPS = {
  pocName: "Alex",
  hotels: [
    {
      locationId: "loc-001",
      hotelName: "Hilton Mayfair",
      region: "London",
      currency: "GBP",
      totalRevenue: 123.45,
      totalTransactions: 42,
      kioskCount: 2,
      numRooms: 120,
      salesPerRoom: "£1.03",
      compositeScore: 8,
      subMetricPercentiles: {
        revenue: 5,
        transactions: 12,
        revenuePerRoom: 4,
        txnPerKiosk: 18,
        basketValue: 22,
      },
      detailUrl: `${BRAND.prodUrl}/locations/loc-001`,
    },
  ],
  moreCount: 0,
  windowDays: 30,
  runIsoWeek: "2026-W19",
};

const THREE_HOTEL_PROPS = {
  pocName: "Sam",
  hotels: [
    {
      locationId: "loc-010",
      hotelName: "Marriott Canary Wharf",
      region: "London",
      currency: "GBP",
      totalRevenue: 200.0,
      totalTransactions: 80,
      kioskCount: 3,
      numRooms: 220,
      salesPerRoom: "£0.91",
      compositeScore: 5,
      subMetricPercentiles: {
        revenue: 3,
        transactions: 7,
        revenuePerRoom: 2,
        txnPerKiosk: 12,
        basketValue: 9,
      },
      detailUrl: `${BRAND.prodUrl}/locations/loc-010`,
    },
    {
      locationId: "loc-011",
      hotelName: "Premier Inn Bristol",
      region: "South West",
      currency: "GBP",
      totalRevenue: 150.75,
      totalTransactions: 60,
      kioskCount: 1,
      numRooms: null,
      salesPerRoom: null,
      compositeScore: 12,
      subMetricPercentiles: {
        revenue: 8,
        transactions: 15,
        revenuePerRoom: null,
        txnPerKiosk: 14,
        basketValue: 19,
      },
      detailUrl: `${BRAND.prodUrl}/locations/loc-011`,
    },
    {
      locationId: "loc-012",
      hotelName: "Ibis Manchester",
      region: "North West",
      currency: "GBP",
      totalRevenue: 99.0,
      totalTransactions: 30,
      kioskCount: 1,
      numRooms: 90,
      salesPerRoom: "£1.10",
      compositeScore: 3,
      subMetricPercentiles: {
        revenue: 2,
        transactions: 5,
        revenuePerRoom: 1,
        txnPerKiosk: 8,
        basketValue: 6,
      },
      detailUrl: `${BRAND.prodUrl}/locations/loc-012`,
    },
  ],
  moreCount: 0,
  windowDays: 14,
  runIsoWeek: "2026-W20",
};

const TWO_HOTEL_SNAPSHOT_PROPS = {
  pocName: "Jordan",
  hotels: [
    {
      locationId: "loc-100",
      hotelName: "Hilton Leeds",
      region: "Yorkshire",
      currency: "GBP",
      totalRevenue: 345.67,
      totalTransactions: 110,
      kioskCount: 2,
      numRooms: 150,
      salesPerRoom: "£2.30",
      compositeScore: 7,
      subMetricPercentiles: {
        revenue: 4,
        transactions: 9,
        revenuePerRoom: 3,
        txnPerKiosk: 11,
        basketValue: 14,
      },
      detailUrl: `${BRAND.prodUrl}/locations/loc-100`,
    },
    {
      locationId: "loc-101",
      hotelName: "Travelodge Edinburgh",
      region: "Scotland",
      currency: "GBP",
      totalRevenue: 88.0,
      totalTransactions: 25,
      kioskCount: 1,
      numRooms: 60,
      salesPerRoom: "£1.47",
      compositeScore: 4,
      subMetricPercentiles: {
        revenue: 2,
        transactions: 6,
        revenuePerRoom: 3,
        txnPerKiosk: 7,
        basketValue: 10,
      },
      detailUrl: `${BRAND.prodUrl}/locations/loc-101`,
    },
  ],
  moreCount: 0,
  windowDays: 30,
  runIsoWeek: "2026-W20",
};

describe("PocUnderperformanceEmail", () => {
  it("Test 1: renders hotel card with name, region, sales, composite, percentiles, detailUrl", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_HOTEL_PROPS} />);
    expect(html).toContain("Hilton Mayfair");
    expect(html).toContain("London");
    expect(html).toContain("123.45");
    // composite score (rendered as a number)
    expect(html).toContain("8");
    // percentile rendering uses pNN
    expect(html).toContain("p5");
    expect(html).toContain(`${BRAND.prodUrl}/locations/loc-001`);
  });

  it("Test 2: renders all 3 hotelNames in document order", async () => {
    const html = await render(
      <PocUnderperformanceEmail {...THREE_HOTEL_PROPS} />,
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
        {...ONE_HOTEL_PROPS}
        moreCount={12}
      />,
    );
    expect(html).toContain("12");
    expect(html).toContain("more");
  });

  it("Test 4: does NOT render 'more' copy when moreCount=0", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_HOTEL_PROPS} />);
    expect(html).not.toContain("more hotel");
  });

  it("Test 5: renders CTA href pointing at /analytics/portfolio", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_HOTEL_PROPS} />);
    expect(html).toContain(`${BRAND.prodUrl}/analytics/portfolio`);
  });

  it("Test 6: renders recipient name from pocName", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_HOTEL_PROPS} />);
    expect(html).toContain("Alex");
  });

  it("Test 7: renders brand color #00A6D3 (Azure CTA) somewhere", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_HOTEL_PROPS} />);
    expect(html).toContain("#00A6D3");
  });

  it("Test 8: renders brand color #121212 (Graphite heading) somewhere", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_HOTEL_PROPS} />);
    expect(html).toContain("#121212");
  });

  it("Test 9: renders windowDays as number in body copy", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_HOTEL_PROPS} />);
    expect(html).toContain("30");
  });

  it("Test 10: renders weights footnote with default weights", async () => {
    const html = await render(<PocUnderperformanceEmail {...ONE_HOTEL_PROPS} />);
    // @react-email/render inserts <!-- --> markers between adjacent text
    // nodes. Strip HTML comments before substring assertions so the literal
    // weights line is matchable.
    const stripped = html.replace(/<!--.*?-->/g, "");
    expect(stripped).toContain("revenue 30%");
    expect(stripped).toContain("transactions 20%");
    expect(stripped).toContain("revenue/room 25%");
    expect(stripped).toContain("txn/kiosk 15%");
    expect(stripped).toContain("basket value 10%");
  });

  it("Test 11: renders '—' for null salesPerRoom and null sub-metric percentile", async () => {
    const html = await render(
      <PocUnderperformanceEmail {...THREE_HOTEL_PROPS} />,
    );
    // Premier Inn Bristol has numRooms=null and revenuePerRoom percentile=null
    expect(html).toContain("rooms unknown");
    // /room cell + /room percentile both render an em-dash
    expect(html).toContain("—");
  });

  it("Test 12: snapshot for canonical 2-hotel render", async () => {
    const html = await render(
      <PocUnderperformanceEmail {...TWO_HOTEL_SNAPSHOT_PROPS} />,
    );
    expect(html).toMatchSnapshot();
  });
});
