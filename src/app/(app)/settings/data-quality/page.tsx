"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, Building2, Network, Globe, Check, X, Database } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
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

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Data Quality"
        description="Completeness of location metadata used by analytics"
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {error ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
              {/* Tooltip text authored 2026-04-28 — values derive from
                  fetchDataQualityReport (src/app/(app)/settings/data-quality/actions.ts):
                  each percentage is the share of non-archived locations with
                  the relevant association populated. No D-decision applies —
                  these are admin-completeness metrics, not analytics KPIs. */}
              <KpiCard
                title="% with Region"
                tooltip="Share of active (non-archived) locations that have at least one row in location_region_memberships. Drives every region-scoped analytics rollup — locations missing a region are excluded from region dashboards."
                value={loading ? "..." : `${report!.pctWithRegion}%`}
                loading={loading}
                icon={<MapPin className="size-3" />}
              />
              <KpiCard
                title="% with Hotel Group"
                tooltip="Share of active locations that have at least one row in location_hotel_group_memberships. Locations without a hotel-group membership do not appear in Hotel Groups analytics or in Compare entity pickers scoped by hotel group."
                value={loading ? "..." : `${report!.pctWithHotelGroup}%`}
                loading={loading}
                icon={<Building2 className="size-3" />}
              />
              <KpiCard
                title="% with Operating Group"
                tooltip="Share of active locations whose locations.operating_group_id FK is populated. Operating groups are the legal-entity rollup used by finance — locations with no operating group cannot be billed-and-attributed correctly."
                value={loading ? "..." : `${report!.pctWithOperatingGroup}%`}
                loading={loading}
                icon={<Network className="size-3" />}
              />
              <KpiCard
                title="% with Market"
                tooltip="Share of active locations whose region maps to a non-null markets.id (regions.market_id). Market is the geographic super-region (UK, EU, ANZ, etc.) used by exec dashboards; locations whose region has no market FK are excluded from market-level rollups."
                value={loading ? "..." : `${report!.pctWithMarket}%`}
                loading={loading}
                icon={<Globe className="size-3" />}
              />
            </div>

            {/* Location quality table */}
            {!loading && report && (
              <div className="rounded-md border overflow-x-auto">
                {report.rows.length === 0 ? (
                  <EmptyState
                    icon={Database}
                    title="No locations found"
                    description="Create a location to start tracking data quality."
                  />
                ) : (
                  <Table>
                    <TableHeader sticky>
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
                      {report.rows.map((row) => (
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
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
