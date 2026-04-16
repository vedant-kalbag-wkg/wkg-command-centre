import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import {
  auditLogs,
  importStagings,
  locations,
  products,
  providers as providersTable,
  salesImports,
  salesRecords,
  user,
} from "@/db/schema";
import {
  _cancelImportForActor,
  _commitImportForActor,
  _stageImportForActor,
  type ImportActor,
} from "@/app/(app)/settings/data-import/sales/pipeline";

const HEADER =
  "Saleref,RefNo,Din,Time,OutletCode,ProductName,ProviderName,Quantity,Gross,Net,DiscountCode,DiscountAmount,BookingFee,SaleCommission,Currency,CustomerCode,CustomerName";

const HAPPY_CSV = [
  HEADER,
  "S-001,R-1,01-Mar-26,10:15,OUT-A,London Eye,AttractionsCo,2,80.00,70.00,,,5.00,7.00,GBP,C-1,Jane",
  "S-002,R-2,01-Mar-26,11:30,OUT-B,Shard View,AttractionsCo,1,35.00,30.00,PROMO10,3.50,2.50,3.00,,C-2,Dan",
  "S-003,R-3,02-Mar-26,14:00,OUT-A,London Eye,AttractionsCo,4,120.00,100.00,,,10.00,12.00,EUR,,",
  "",
].join("\n");

describe("sales-import pipeline (integration)", () => {
  let ctx: TestDbContext;
  const admin: ImportActor = { id: randomUUID(), name: "Admin User" };

  beforeAll(async () => {
    ctx = await setupTestDb();
    await ctx.db.insert(user).values({
      id: admin.id,
      email: "admin@t.t",
      name: admin.name,
      emailVerified: true,
      userType: "internal",
      role: "admin",
    });
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    await ctx.db.delete(auditLogs);
    await ctx.db.delete(salesRecords);
    await ctx.db.delete(importStagings);
    await ctx.db.delete(salesImports);
    await ctx.db.delete(providersTable);
    await ctx.db.delete(products);
    await ctx.db.delete(locations);

    await ctx.db.insert(locations).values([
      { name: "Hotel A", outletCode: "OUT-A" },
      { name: "Hotel B", outletCode: "OUT-B" },
    ]);
    await ctx.db.insert(products).values([
      { name: "London Eye" },
      { name: "Shard View" },
    ]);
    await ctx.db.insert(providersTable).values({ name: "AttractionsCo" });
  });

  describe("stageImport", () => {
    it("happy path: stages 3 valid rows and returns correct summary", async () => {
      const summary = await _stageImportForActor(
        { filename: "happy.csv", bytes: new TextEncoder().encode(HAPPY_CSV) },
        admin,
        ctx.db,
      );

      expect(summary.totalRows).toBe(3);
      expect(summary.validCount).toBe(3);
      expect(summary.invalidCount).toBe(0);
      expect(summary.dateRangeStart).toBe("2026-03-01");
      expect(summary.dateRangeEnd).toBe("2026-03-02");

      const imports = await ctx.db.select().from(salesImports);
      expect(imports).toHaveLength(1);
      expect(imports[0].status).toBe("staging");
      expect(imports[0].filename).toBe("happy.csv");
      expect(imports[0].rowCount).toBe(3);

      const stagings = await ctx.db
        .select()
        .from(importStagings)
        .where(eq(importStagings.importId, summary.importId));
      expect(stagings).toHaveLength(3);
      expect(stagings.every((s) => s.status === "valid")).toBe(true);
    });

    it("rejects duplicate upload (same sourceHash)", async () => {
      const bytes = new TextEncoder().encode(HAPPY_CSV);
      await _stageImportForActor({ filename: "a.csv", bytes }, admin, ctx.db);
      await expect(
        _stageImportForActor({ filename: "a.csv", bytes }, admin, ctx.db),
      ).rejects.toThrow(/already been uploaded/i);
    });

    it("marks rows with unknown outlet as invalid (doesn't throw)", async () => {
      const csv =
        HEADER + "\nS-X,R-1,01-Mar-26,10:15,OUT-UNKNOWN,London Eye,,1,10.00,,,,,,GBP,,\n";
      const summary = await _stageImportForActor(
        { filename: "bad-outlet.csv", bytes: new TextEncoder().encode(csv) },
        admin,
        ctx.db,
      );
      expect(summary.invalidCount).toBe(1);
      expect(summary.validCount).toBe(0);

      const stagings = await ctx.db
        .select()
        .from(importStagings)
        .where(eq(importStagings.importId, summary.importId));
      expect(stagings[0].status).toBe("invalid");
      expect(stagings[0].validationErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "outletCode" }),
        ]),
      );
    });

    it("writes a stage audit log entry", async () => {
      const summary = await _stageImportForActor(
        { filename: "audit.csv", bytes: new TextEncoder().encode(HAPPY_CSV) },
        admin,
        ctx.db,
      );
      const logs = await ctx.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, summary.importId));
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("stage");
      expect(logs[0].entityType).toBe("sales_import");
      expect(logs[0].actorId).toBe(admin.id);
    });
  });

  describe("commitImport", () => {
    it("happy path: commits all staged rows into salesRecords", async () => {
      const { importId } = await _stageImportForActor(
        { filename: "happy.csv", bytes: new TextEncoder().encode(HAPPY_CSV) },
        admin,
        ctx.db,
      );

      const result = await _commitImportForActor(importId, admin, ctx.db);
      expect(result.committedRows).toBe(3);

      const records = await ctx.db.select().from(salesRecords);
      expect(records).toHaveLength(3);
      expect(records.map((r) => r.saleRef).sort()).toEqual(["S-001", "S-002", "S-003"]);

      const imports = await ctx.db
        .select()
        .from(salesImports)
        .where(eq(salesImports.id, importId));
      expect(imports[0].status).toBe("committed");

      const stagings = await ctx.db
        .select()
        .from(importStagings)
        .where(eq(importStagings.importId, importId));
      expect(stagings.every((s) => s.status === "committed")).toBe(true);
    });

    it("all-or-nothing: refuses to commit if any staged row is invalid", async () => {
      const csv =
        HEADER +
        "\nS-1,R-1,01-Mar-26,10:15,OUT-A,London Eye,,1,10.00,,,,,,GBP,,\nS-2,R-2,01-Mar-26,10:15,OUT-UNKNOWN,London Eye,,1,10.00,,,,,,GBP,,\n";
      const { importId } = await _stageImportForActor(
        { filename: "mixed.csv", bytes: new TextEncoder().encode(csv) },
        admin,
        ctx.db,
      );

      await expect(_commitImportForActor(importId, admin, ctx.db)).rejects.toThrow(
        /validation errors/i,
      );

      const records = await ctx.db.select().from(salesRecords);
      expect(records).toHaveLength(0);

      const imports = await ctx.db
        .select()
        .from(salesImports)
        .where(eq(salesImports.id, importId));
      expect(imports[0].status).toBe("staging");
    });

    it("writes a commit audit log entry with committedRows in metadata", async () => {
      const { importId } = await _stageImportForActor(
        { filename: "audit.csv", bytes: new TextEncoder().encode(HAPPY_CSV) },
        admin,
        ctx.db,
      );
      await _commitImportForActor(importId, admin, ctx.db);

      const logs = await ctx.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, importId), eq(auditLogs.action, "commit")));
      expect(logs).toHaveLength(1);
      expect(logs[0].newValue).toBe("3"); // committedRows
    });

    it("rejects commit on a non-staging import", async () => {
      const { importId } = await _stageImportForActor(
        { filename: "happy.csv", bytes: new TextEncoder().encode(HAPPY_CSV) },
        admin,
        ctx.db,
      );
      await _commitImportForActor(importId, admin, ctx.db);
      await expect(_commitImportForActor(importId, admin, ctx.db)).rejects.toThrow(
        /not in staging/i,
      );
    });

    it("rolls back on unique-constraint conflict with pre-existing sales rows", async () => {
      const { importId: firstId } = await _stageImportForActor(
        { filename: "first.csv", bytes: new TextEncoder().encode(HAPPY_CSV) },
        admin,
        ctx.db,
      );
      await _commitImportForActor(firstId, admin, ctx.db);

      // Second upload with DIFFERENT bytes but overlapping (saleRef, date)
      const duplicateContent = HAPPY_CSV.replace("S-001,R-1", "S-001,R-REDO");
      const { importId: secondId } = await _stageImportForActor(
        { filename: "second.csv", bytes: new TextEncoder().encode(duplicateContent) },
        admin,
        ctx.db,
      );
      await expect(_commitImportForActor(secondId, admin, ctx.db)).rejects.toThrow();

      const records = await ctx.db.select().from(salesRecords);
      expect(records).toHaveLength(3); // only the first import's rows

      const imports = await ctx.db
        .select()
        .from(salesImports)
        .where(eq(salesImports.id, secondId));
      expect(imports[0].status).toBe("failed");
    });
  });

  describe("cancelImport", () => {
    it("deletes staging rows and marks import failed (hash preserved)", async () => {
      const bytes = new TextEncoder().encode(HAPPY_CSV);
      const { importId } = await _stageImportForActor(
        { filename: "cancel.csv", bytes },
        admin,
        ctx.db,
      );

      await _cancelImportForActor(importId, admin, ctx.db);

      const stagings = await ctx.db
        .select()
        .from(importStagings)
        .where(eq(importStagings.importId, importId));
      expect(stagings).toHaveLength(0);

      const imports = await ctx.db
        .select()
        .from(salesImports)
        .where(eq(salesImports.id, importId));
      expect(imports[0].status).toBe("failed");

      // Re-uploading same bytes still rejected (hash is preserved)
      await expect(
        _stageImportForActor({ filename: "retry.csv", bytes }, admin, ctx.db),
      ).rejects.toThrow(/already been uploaded/i);
    });

    it("writes a cancel audit log entry", async () => {
      const { importId } = await _stageImportForActor(
        { filename: "c.csv", bytes: new TextEncoder().encode(HAPPY_CSV) },
        admin,
        ctx.db,
      );
      await _cancelImportForActor(importId, admin, ctx.db);

      const logs = await ctx.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, importId), eq(auditLogs.action, "cancel")));
      expect(logs).toHaveLength(1);
    });
  });
});
