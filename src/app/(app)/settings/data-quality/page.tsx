"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, Building2, Network, Globe, Check, X } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { KpiCard } from "@/components/analytics/kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchDataQualityReport, type DataQualityReport } from "./actions";

function scoreColor(score: number): string {
  if (score >= 75) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-600";
}

export default function DataQualityPage() {
  const [report, setReport] = useState<DataQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDataQualityReport()
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load report"))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return (
      <AppShell title="Data Quality">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Data Quality">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <KpiCard
          title="% with Region"
          value={loading ? "..." : `${report!.pctWithRegion}%`}
          loading={loading}
          icon={<MapPin className="size-3" />}
        />
        <KpiCard
          title="% with Hotel Group"
          value={loading ? "..." : `${report!.pctWithHotelGroup}%`}
          loading={loading}
          icon={<Building2 className="size-3" />}
        />
        <KpiCard
          title="% with Operating Group"
          value={loading ? "..." : `${report!.pctWithOperatingGroup}%`}
          loading={loading}
          icon={<Network className="size-3" />}
        />
        <KpiCard
          title="% with Market"
          value={loading ? "..." : `${report!.pctWithMarket}%`}
          loading={loading}
          icon={<Globe className="size-3" />}
        />
      </div>

      {/* Location quality table */}
      {!loading && report && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Outlet Code</TableHead>
                <TableHead className="text-center">Has Region</TableHead>
                <TableHead className="text-center">Has Hotel Group</TableHead>
                <TableHead className="text-center">Has Operating Group</TableHead>
                <TableHead className="text-center">Quality Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No locations found.
                  </TableCell>
                </TableRow>
              ) : (
                report.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/locations/${row.id}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.outletCode ?? "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.hasRegion ? (
                        <Check className="inline size-4 text-green-600" />
                      ) : (
                        <X className="inline size-4 text-red-400" />
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.hasHotelGroup ? (
                        <Check className="inline size-4 text-green-600" />
                      ) : (
                        <X className="inline size-4 text-red-400" />
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.hasOperatingGroup ? (
                        <Check className="inline size-4 text-green-600" />
                      ) : (
                        <X className="inline size-4 text-red-400" />
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`font-semibold ${scoreColor(row.qualityScore)}`}>
                        {row.qualityScore}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </AppShell>
  );
}
