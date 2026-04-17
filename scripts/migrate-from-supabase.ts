/**
 * M5 — One-shot Supabase → wkg-kiosk-tool ETL migration.
 *
 * Reads ALL data from data-dashboard's Supabase Postgres (via service_role
 * key to bypass RLS) and writes into the local wkg-kiosk-tool Postgres.
 *
 * Idempotent: uses upsert-on-conflict throughout. Safe to re-run after a
 * partial failure.
 *
 * Run: npm run db:migrate:supabase
 * Prereqs: .env.local has SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import {
  analyticsSavedViews,
  analyticsPresets,
  businessEvents,
  eventCategories,
  hotelGroups,
  locationGroupMemberships,
  locationGroups,
  locationHotelGroupMemberships,
  locationRegionMemberships,
  locations,
  outletExclusions,
  products,
  providers,
  regions,
  salesRecords,
  user,
  userScopes,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const userIdMap = new Map<string, string>();
const locationIdMap = new Map<string, string>();
const productIdMap = new Map<string, string>();
const hotelGroupIdMap = new Map<string, string>();
const regionIdMap = new Map<string, string>();
const locationGroupIdMap = new Map<string, string>();
const eventCategoryIdMap = new Map<string, string>();

function log(phase: string, msg: string) {
  console.log(`[${phase}] ${msg}`);
}

// ──────────────────────────────────────────────────────────────
// Phase 1: Dimensions (hotel_metadata_cache → locations + dimension tables)
// ──────────────────────────────────────────────────────────────

async function migrateDimensions() {
  log("DIMENSIONS", "Starting...");

  const { data: hotels, error } = await supabase
    .from("hotel_metadata_cache")
    .select("*");
  if (error) throw new Error(`hotel_metadata_cache read failed: ${error.message}`);
  if (!hotels || hotels.length === 0) {
    log("DIMENSIONS", "No hotels found. Skipping.");
    return;
  }
  log("DIMENSIONS", `Read ${hotels.length} hotels from Supabase`);

  const distinctHotelGroups = new Set<string>();
  const distinctRegions = new Set<string>();
  const distinctLocationGroups = new Set<string>();

  for (const h of hotels) {
    if (h.hotel_group) distinctHotelGroups.add(h.hotel_group);
    if (h.region) distinctRegions.add(h.region);
    if (h.location_group) distinctLocationGroups.add(h.location_group);
  }

  for (const name of distinctHotelGroups) {
    const [row] = await db
      .insert(hotelGroups)
      .values({ name })
      .onConflictDoNothing({ target: hotelGroups.name })
      .returning({ id: hotelGroups.id });
    if (row) hotelGroupIdMap.set(name, row.id);
    else {
      const [existing] = await db.select({ id: hotelGroups.id }).from(hotelGroups).where(eq(hotelGroups.name, name));
      hotelGroupIdMap.set(name, existing.id);
    }
  }
  log("DIMENSIONS", `Hotel groups: ${distinctHotelGroups.size}`);

  for (const name of distinctRegions) {
    const [row] = await db
      .insert(regions)
      .values({ name })
      .onConflictDoNothing({ target: regions.name })
      .returning({ id: regions.id });
    if (row) regionIdMap.set(name, row.id);
    else {
      const [existing] = await db.select({ id: regions.id }).from(regions).where(eq(regions.name, name));
      regionIdMap.set(name, existing.id);
    }
  }
  log("DIMENSIONS", `Regions: ${distinctRegions.size}`);

  for (const name of distinctLocationGroups) {
    const [row] = await db
      .insert(locationGroups)
      .values({ name })
      .onConflictDoNothing({ target: locationGroups.name })
      .returning({ id: locationGroups.id });
    if (row) locationGroupIdMap.set(name, row.id);
    else {
      const [existing] = await db.select({ id: locationGroups.id }).from(locationGroups).where(eq(locationGroups.name, name));
      locationGroupIdMap.set(name, existing.id);
    }
  }
  log("DIMENSIONS", `Location groups: ${distinctLocationGroups.size}`);

  let locInserted = 0;
  let locUpdated = 0;
  for (const h of hotels) {
    if (!h.outlet_code) continue;

    const existing = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.outletCode, h.outlet_code))
      .limit(1);

    const values = {
      name: h.hotel_name ?? h.outlet_code,
      outletCode: h.outlet_code,
      hotelGroup: h.hotel_group,
      region: h.region,
      locationGroup: h.location_group,
      numRooms: h.rooms,
      starRating: h.star_rating,
      liveDate: h.live_date ? new Date(h.live_date) : null,
    };

    let locId: string;
    if (existing.length > 0) {
      locId = existing[0].id;
      await db.update(locations).set(values).where(eq(locations.id, locId));
      locUpdated++;
    } else {
      const [row] = await db.insert(locations).values(values).returning({ id: locations.id });
      locId = row.id;
      locInserted++;
    }
    locationIdMap.set(h.outlet_code, locId);

    if (h.hotel_group && hotelGroupIdMap.has(h.hotel_group)) {
      await db
        .insert(locationHotelGroupMemberships)
        .values({ locationId: locId, hotelGroupId: hotelGroupIdMap.get(h.hotel_group)! })
        .onConflictDoNothing();
    }
    if (h.region && regionIdMap.has(h.region)) {
      await db
        .insert(locationRegionMemberships)
        .values({ locationId: locId, regionId: regionIdMap.get(h.region)! })
        .onConflictDoNothing();
    }
    if (h.location_group && locationGroupIdMap.has(h.location_group)) {
      await db
        .insert(locationGroupMemberships)
        .values({ locationId: locId, locationGroupId: locationGroupIdMap.get(h.location_group)! })
        .onConflictDoNothing();
    }
  }
  log("DIMENSIONS", `Locations: ${locInserted} inserted, ${locUpdated} updated`);

  // Products — distinct product_name from sales_data
  const { data: prodNames, error: prodErr } = await supabase
    .from("sales_data")
    .select("product_name")
    .not("product_name", "is", null);
  if (prodErr) throw new Error(`products read failed: ${prodErr.message}`);
  const uniqueProducts = new Set((prodNames ?? []).map((r: { product_name: string }) => r.product_name));
  for (const name of uniqueProducts) {
    if (!name?.trim()) continue;
    const [row] = await db
      .insert(products)
      .values({ name: name.trim() })
      .onConflictDoNothing({ target: products.name })
      .returning({ id: products.id });
    if (row) productIdMap.set(name.trim().toLowerCase(), row.id);
    else {
      const [existing] = await db.select({ id: products.id }).from(products).where(eq(products.name, name.trim()));
      if (existing) productIdMap.set(name.trim().toLowerCase(), existing.id);
    }
  }
  log("DIMENSIONS", `Products: ${uniqueProducts.size}`);
}

// ──────────────────────────────────────────────────────────────
// Phase 2: Users (profiles + user_permissions → user + userScopes)
// ──────────────────────────────────────────────────────────────

async function migrateUsers() {
  log("USERS", "Starting...");

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("*");
  if (error) throw new Error(`profiles read failed: ${error.message}`);
  if (!profiles || profiles.length === 0) {
    log("USERS", "No profiles found. Skipping.");
    return;
  }
  log("USERS", `Read ${profiles.length} profiles from Supabase`);

  let created = 0;
  let skipped = 0;
  for (const p of profiles) {
    const existing = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, p.email))
      .limit(1);

    if (existing.length > 0) {
      userIdMap.set(p.id, existing[0].id);
      skipped++;
      continue;
    }

    try {
      const result = await auth.api.createUser({
        body: {
          email: p.email,
          password: `MigratedUser-${randomUUID().slice(0, 8)}!`,
          name: p.full_name ?? p.email,
          role: p.role === "admin" ? "admin" : "user",
        },
      });
      userIdMap.set(p.id, result.user.id);

      await db
        .update(user)
        .set({ userType: "internal", role: p.role === "admin" ? "admin" : "member" })
        .where(eq(user.id, result.user.id));
      created++;
    } catch (err) {
      log("USERS", `Failed to create user ${p.email}: ${err}`);
      skipped++;
    }
  }
  log("USERS", `Users: ${created} created, ${skipped} skipped (existing)`);

  // User permissions → userScopes
  const { data: perms, error: permErr } = await supabase
    .from("user_permissions")
    .select("*");
  if (permErr) throw new Error(`user_permissions read failed: ${permErr.message}`);

  let scopeCount = 0;
  for (const p of perms ?? []) {
    const newUserId = userIdMap.get(p.user_id);
    if (!newUserId) continue;

    type ScopeEntry = typeof userScopes.$inferInsert;
    const scopeEntries: ScopeEntry[] = [];

    for (const hotel of p.hotels ?? []) {
      if (hotel) scopeEntries.push({ userId: newUserId, dimensionType: "hotel_group" as const, dimensionId: hotel });
    }
    for (const hg of p.hotel_groups ?? []) {
      if (hg) scopeEntries.push({ userId: newUserId, dimensionType: "hotel_group" as const, dimensionId: hg });
    }
    for (const r of p.regions ?? []) {
      if (r) scopeEntries.push({ userId: newUserId, dimensionType: "region" as const, dimensionId: r });
    }
    for (const prod of p.products ?? []) {
      if (prod) scopeEntries.push({ userId: newUserId, dimensionType: "product" as const, dimensionId: prod });
    }

    for (const entry of scopeEntries) {
      await db
        .insert(userScopes)
        .values(entry)
        .onConflictDoNothing();
      scopeCount++;
    }
  }
  log("USERS", `UserScopes: ${scopeCount} rows created`);
}

// ──────────────────────────────────────────────────────────────
// Phase 3: Sales data (sales_data → salesRecords)
// ──────────────────────────────────────────────────────────────

async function migrateSales() {
  log("SALES", "Starting...");

  const { count, error: countErr } = await supabase
    .from("sales_data")
    .select("*", { count: "exact", head: true });
  if (countErr) throw new Error(`sales count failed: ${countErr.message}`);
  const totalRows = count ?? 0;
  log("SALES", `Total rows in Supabase: ${totalRows}`);

  if (totalRows === 0) return;

  const BATCH = 1000;
  let processed = 0;
  let inserted = 0;
  let skipNoLoc = 0;
  let skipNoProd = 0;

  for (let offset = 0; offset < totalRows; offset += BATCH) {
    const { data: rows, error } = await supabase
      .from("sales_data")
      .select("*")
      .range(offset, offset + BATCH - 1)
      .order("id", { ascending: true });

    if (error) throw new Error(`sales batch read at ${offset} failed: ${error.message}`);
    if (!rows || rows.length === 0) break;

    const inserts: Array<typeof salesRecords.$inferInsert> = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const locationId = r.outlet_code ? locationIdMap.get(r.outlet_code) : undefined;
      if (!locationId) { skipNoLoc++; continue; }

      const productId = r.product_name
        ? productIdMap.get(r.product_name.trim().toLowerCase())
        : undefined;
      if (!productId) { skipNoProd++; continue; }

      const saleRef = r.saleref ?? `${r.outlet_code}-${r.sale_date}-${offset + i}`;

      inserts.push({
        saleRef,
        refNo: null,
        transactionDate: r.sale_date,
        transactionTime: r.sale_time ?? null,
        locationId,
        productId,
        providerId: null,
        quantity: r.quantity ?? 1,
        grossAmount: r.amount != null ? String(r.amount) : "0",
        netAmount: r.total_amount != null ? String(r.total_amount) : null,
        discountCode: null,
        discountAmount: r.discount_amount != null ? String(r.discount_amount) : null,
        bookingFee: r.booking_fee != null ? String(r.booking_fee) : null,
        saleCommission: r.sale_commission != null ? String(r.sale_commission) : null,
        currency: "GBP",
        customerCode: null,
        customerName: null,
      });
    }

    if (inserts.length > 0) {
      try {
        await db
          .insert(salesRecords)
          .values(inserts)
          .onConflictDoNothing();
        inserted += inserts.length;
      } catch (err) {
        log("SALES", `Batch at offset ${offset} insert error: ${err}`);
      }
    }

    processed += rows.length;
    if (processed % 5000 === 0 || offset + BATCH >= totalRows) {
      log("SALES", `Progress: ${processed}/${totalRows} rows (${inserted} inserted, ${skipNoLoc} skip-no-loc, ${skipNoProd} skip-no-prod)`);
    }
  }

  log("SALES", `Done: ${inserted} inserted, ${skipNoLoc} skipped (no location), ${skipNoProd} skipped (no product)`);
}

// ──────────────────────────────────────────────────────────────
// Phase 4: Analytics metadata
// ���─────────────────────────────────────────────────────────────

async function migrateAnalyticsMetadata() {
  log("METADATA", "Starting...");

  // Outlet exclusions
  const { data: exclusions } = await supabase.from("outlet_exclusions").select("*");
  let exclCount = 0;
  for (const e of exclusions ?? []) {
    await db
      .insert(outletExclusions)
      .values({
        outletCode: e.outlet_code,
        patternType: e.pattern_type ?? "exact",
        label: e.label ?? null,
      })
      .onConflictDoNothing();
    exclCount++;
  }
  log("METADATA", `Outlet exclusions: ${exclCount}`);

  // Event categories
  const { data: cats } = await supabase.from("event_categories").select("*");
  for (const c of cats ?? []) {
    const [row] = await db
      .insert(eventCategories)
      .values({
        name: c.name,
        color: c.color ?? "#666666",
        isCore: c.is_core ?? false,
      })
      .onConflictDoNothing({ target: eventCategories.name })
      .returning({ id: eventCategories.id });
    if (row) eventCategoryIdMap.set(c.id, row.id);
    else {
      const [existing] = await db.select({ id: eventCategories.id }).from(eventCategories).where(eq(eventCategories.name, c.name));
      if (existing) eventCategoryIdMap.set(c.id, existing.id);
    }
  }
  log("METADATA", `Event categories: ${(cats ?? []).length}`);

  // Business events
  const { data: events } = await supabase.from("business_events").select("*");
  let eventCount = 0;
  for (const e of events ?? []) {
    const categoryId = eventCategoryIdMap.get(e.category_id);
    if (!categoryId) continue;
    const createdBy = e.created_by ? userIdMap.get(e.created_by) : null;
    await db
      .insert(businessEvents)
      .values({
        title: e.title,
        description: e.description ?? null,
        categoryId,
        startDate: e.start_date,
        endDate: e.end_date ?? null,
        scopeType: e.scope_type ?? "global",
        scopeValue: e.scope_value ?? null,
        createdBy: createdBy ?? null,
      })
      .onConflictDoNothing();
    eventCount++;
  }
  log("METADATA", `Business events: ${eventCount}`);

  // Saved views → analyticsSavedViews
  const { data: views } = await supabase.from("saved_views").select("*");
  let viewCount = 0;
  for (const v of views ?? []) {
    const ownerId = userIdMap.get(v.user_id);
    if (!ownerId) continue;
    await db
      .insert(analyticsSavedViews)
      .values({
        ownerId,
        name: v.name,
        viewType: "trend",
        config: v.series_config ?? {},
      })
      .onConflictDoNothing();
    viewCount++;
  }
  log("METADATA", `Saved views: ${viewCount}`);

  // Permission presets → analyticsPresets
  const { data: presets } = await supabase.from("permission_presets").select("*");
  let presetCount = 0;
  for (const p of presets ?? []) {
    const ownerId = p.created_by ? userIdMap.get(p.created_by) : null;
    await db
      .insert(analyticsPresets)
      .values({
        name: p.name,
        ownerId: ownerId ?? "system",
        config: {
          products: p.products ?? [],
          hotels: p.hotels ?? [],
          hotel_groups: p.hotel_groups ?? [],
          regions: p.regions ?? [],
          description: p.description ?? null,
        },
        isShared: true,
      })
      .onConflictDoNothing();
    presetCount++;
  }
  log("METADATA", `Presets: ${presetCount}`);
}

// ��─────────────────────────────────────────────────────────────
// Phase 5: Verification
// ──────────────────────────────────────────────────────────────

async function verify() {
  log("VERIFY", "Running verification checks...");
  let failures = 0;

  // Row counts
  const locCount = await db.select({ c: sql<number>`count(*)::int` }).from(locations);
  log("VERIFY", `Locations: ${locCount[0].c}`);

  const prodCount = await db.select({ c: sql<number>`count(*)::int` }).from(products);
  log("VERIFY", `Products: ${prodCount[0].c}`);

  const salesCount = await db.select({ c: sql<number>`count(*)::int` }).from(salesRecords);
  log("VERIFY", `Sales records: ${salesCount[0].c}`);

  const userCount = await db.select({ c: sql<number>`count(*)::int` }).from(user);
  log("VERIFY", `Users: ${userCount[0].c}`);

  const scopeCount = await db.select({ c: sql<number>`count(*)::int` }).from(userScopes);
  log("VERIFY", `User scopes: ${scopeCount[0].c}`);

  // FK integrity: sales → locations
  const orphanSales = await db.execute(sql`
    SELECT count(*) AS c FROM sales_records sr
    WHERE sr.location_id NOT IN (SELECT id FROM locations)
  `);
  const orphanCount = Number((orphanSales as unknown as Array<{ c: number }>)[0]?.c ?? 0);
  if (orphanCount > 0) {
    log("VERIFY", `FAIL: ${orphanCount} sales records with orphaned locationId`);
    failures++;
  } else {
    log("VERIFY", "PASS: No orphaned sales → locations");
  }

  // FK integrity: sales → products
  const orphanProds = await db.execute(sql`
    SELECT count(*) AS c FROM sales_records sr
    WHERE sr.product_id NOT IN (SELECT id FROM products)
  `);
  const orphanProdCount = Number((orphanProds as unknown as Array<{ c: number }>)[0]?.c ?? 0);
  if (orphanProdCount > 0) {
    log("VERIFY", `FAIL: ${orphanProdCount} sales records with orphaned productId`);
    failures++;
  } else {
    log("VERIFY", "PASS: No orphaned sales → products");
  }

  // Date range
  const dateRange = await db.execute(sql`
    SELECT min(transaction_date) AS min_date, max(transaction_date) AS max_date FROM sales_records
  `);
  log("VERIFY", `Date range: ${(dateRange as unknown as Array<{ min_date: string; max_date: string }>)[0]?.min_date} → ${(dateRange as unknown as Array<{ min_date: string; max_date: string }>)[0]?.max_date}`);

  // Duplicates
  const dupes = await db.execute(sql`
    SELECT count(*) AS c FROM (
      SELECT sale_ref, transaction_date FROM sales_records
      GROUP BY sale_ref, transaction_date
      HAVING count(*) > 1
    ) d
  `);
  const dupeCount = Number((dupes as unknown as Array<{ c: number }>)[0]?.c ?? 0);
  if (dupeCount > 0) {
    log("VERIFY", `WARN: ${dupeCount} duplicate (saleRef, date) pairs`);
  } else {
    log("VERIFY", "PASS: No duplicate (saleRef, date) pairs");
  }

  if (failures > 0) {
    log("VERIFY", `FAILED: ${failures} checks failed`);
    process.exit(1);
  } else {
    log("VERIFY", "ALL CHECKS PASSED");
  }
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────��───────────────────────────────────────────────────────

async function main() {
  console.log("=== Supabase → wkg-kiosk-tool ETL Migration ===\n");

  // Connectivity check
  const { count, error } = await supabase
    .from("sales_data")
    .select("*", { count: "exact", head: true });
  if (error) {
    console.error("Supabase connectivity failed:", error.message);
    process.exit(1);
  }
  log("INIT", `Connected to Supabase. sales_data has ${count} rows.`);

  await migrateDimensions();
  await migrateUsers();
  await migrateSales();
  await migrateAnalyticsMetadata();
  await verify();

  console.log("\n=== Migration complete ===");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
