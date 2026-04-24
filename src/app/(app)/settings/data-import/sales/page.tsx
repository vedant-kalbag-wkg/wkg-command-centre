import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { regions, salesBlobIngestions, salesImports } from "@/db/schema";
import { requireRole } from "@/lib/rbac";

export default async function SalesImportPage() {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }

  const rows = await db
    .select({
      id: salesBlobIngestions.id,
      regionCode: regions.code,
      regionName: regions.name,
      blobPath: salesBlobIngestions.blobPath,
      blobDate: salesBlobIngestions.blobDate,
      processedAt: salesBlobIngestions.processedAt,
      status: salesBlobIngestions.status,
      errorMessage: salesBlobIngestions.errorMessage,
      rowCount: salesImports.rowCount,
    })
    .from(salesBlobIngestions)
    .innerJoin(regions, eq(salesBlobIngestions.regionId, regions.id))
    .leftJoin(salesImports, eq(salesBlobIngestions.importId, salesImports.id))
    .orderBy(desc(salesBlobIngestions.processedAt))
    .limit(50);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Sales Ingestion History"
        description="Recent Azure ETL runs — read-only. Trigger new runs via `npm run etl:azure` or `POST /api/etl/azure/run`."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Region</TableHead>
                <TableHead>Blob path</TableHead>
                <TableHead>Blob date</TableHead>
                <TableHead>Processed at</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No ingestion runs yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.regionCode}
                      <span className="text-muted-foreground ml-1">· {row.regionName}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.blobPath}</TableCell>
                    <TableCell>{row.blobDate}</TableCell>
                    <TableCell className="text-xs">
                      {row.processedAt.toISOString()}
                    </TableCell>
                    <TableCell>
                      {row.status === "success" ? (
                        <Badge variant="subtle-success">success</Badge>
                      ) : (
                        <Badge variant="destructive">failed</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.rowCount != null ? row.rowCount.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell
                      className="max-w-md truncate text-xs text-muted-foreground"
                      title={row.errorMessage ?? undefined}
                    >
                      {row.errorMessage ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
