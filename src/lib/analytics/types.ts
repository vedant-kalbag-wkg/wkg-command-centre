// ─── Filter Types ─────────────────────────────────────────────────────────────

export type DatePreset =
  | "this-month" | "last-month" | "last-3-months"
  | "this-quarter" | "last-quarter" | "ytd" | "last-year"

export type FilterDimension =
  | "hotelIds" | "regionIds" | "productIds"
  | "hotelGroupIds" | "locationGroupIds"

export type AnalyticsFilters = {
  dateFrom: string       // YYYY-MM-DD
  dateTo: string         // YYYY-MM-DD
  hotelIds?: string[]    // location IDs
  regionIds?: string[]
  productIds?: string[]
  hotelGroupIds?: string[]
  locationGroupIds?: string[]
  maturityBuckets?: string[]
}

// ─── Portfolio Types ──────────────────────────────────────────────────────────

export type PortfolioSummary = {
  totalRevenue: number
  totalTransactions: number
  totalQuantity: number
  avgBasketValue: number
  uniqueProducts: number
  uniqueOutlets: number
}

export type CategoryPerformanceRow = {
  categoryName: string
  revenue: number
  transactions: number
  quantity: number
  avgValue: number
}

export type TopProductRow = {
  rank: number
  productName: string
  categoryName: string
  revenue: number
  transactions: number
  quantity: number
}

export type DailyTrendRow = {
  date: string           // YYYY-MM-DD
  revenue: number
  transactions: number
}

export type HourlyDistributionRow = {
  hour: number           // 0-23
  revenue: number
  transactions: number
}

export type OutletTierRow = {
  locationId: string
  outletCode: string
  hotelName: string
  liveDate: string | null
  revenue: number
  transactions: number
  percentile: number
  sharePercentage: number
  tier: OutletTier
}

export type OutletTier = "Premium" | "Standard" | "Developing" | "Emerging"

export type ComparisonMode = "mom" | "yoy"

export type PortfolioData = {
  summary: PortfolioSummary
  previousSummary: PortfolioSummary | null
  comparisonMode?: ComparisonMode
  categoryPerformance: CategoryPerformanceRow[]
  topProducts: TopProductRow[]
  dailyTrends: DailyTrendRow[]
  hourlyDistribution: HourlyDistributionRow[]
  outletTiers: OutletTierRow[]
}

// ─── Heat Map Types ───────────────────────────────────────────────────────────

export type HeatMapHotel = {
  rank: number
  locationId: string
  outletCode: string
  hotelName: string
  liveDate: string | null
  revenue: number
  transactions: number
  revenuePerRoom: number | null
  txnPerKiosk: number | null
  avgBasketValue: number
  compositeScore: number
}

export type HeatMapData = {
  topPerformers: HeatMapHotel[]
  bottomPerformers: HeatMapHotel[]
  allPerformers: HeatMapHotel[]
  scoreWeights: ScoreWeights
}

export type ScoreWeights = {
  revenue: number        // 0.30
  transactions: number   // 0.20
  revenuePerRoom: number // 0.25
  txnPerKiosk: number    // 0.15
  basketValue: number    // 0.10
}

// ─── Trend Builder Types ──────────────────────────────────────────────────────

export type TrendMetric = "revenue" | "transactions" | "avg_basket_value" | "booking_fee"

export type SeriesFilters = {
  productIds?: string[]
  locationIds?: string[]
  hotelGroupIds?: string[]
  regionIds?: string[]
  locationGroupIds?: string[]
}

export type SeriesConfig = {
  id: string
  metric: TrendMetric
  filters: SeriesFilters
  color: string
  label: string
  labelEdited?: boolean
  hidden: boolean
}

export type TrendDataPoint = {
  date: string           // YYYY-MM-DD
  value: number
}

export type TrendGranularity = "auto" | "daily" | "weekly" | "monthly"

// ─── Pivot Types ──────────────────────────────────────────────────────────────

export type PivotAggregation = "sum" | "avg" | "count" | "min" | "max"

export type PivotValueConfig = {
  field: string
  aggregation: PivotAggregation
}

export type PivotConfig = {
  rowFields: string[]
  columnFields: string[]
  values: PivotValueConfig[]
  periodComparison?: "mom" | "yoy" | null
}

export type PivotCell = {
  value: number
  formatted: string
}

export type PivotRow = {
  dimensions: Record<string, string>
  cells: Record<string, PivotCell>
}

export type PivotResponse = {
  headers: string[]
  rows: PivotRow[]
  grandTotals: Record<string, PivotCell>
  rowCount: number
  truncated: boolean
}

// ─── Dimension Page Types ─────────────────────────────────────────────────────

export type HotelGroupData = {
  id: string
  name: string
  revenue: number
  transactions: number
  hotelCount: number
  revenueChange: number | null
  transactionChange: number | null
}

export type HotelGroupDetail = {
  metrics: { revenue: number; transactions: number; hotelCount: number; avgRevenuePerHotel: number }
  hotels: HotelInGroup[]
  trends: DailyTrendRow[]
  previousMetrics: { revenue: number; transactions: number } | null
}

export type HotelInGroup = {
  locationId: string
  outletCode: string
  hotelName: string
  revenue: number
  transactions: number
  quantity: number
  rooms: number | null
  kiosks: number | null
  starRating: number | null
  revenuePerRoom: number | null
}

export type RegionData = {
  id: string
  name: string
  revenue: number
  transactions: number
  hotelGroupCount: number
  locationGroupCount: number
  marketId: string | null
  marketName: string | null
}

export type RegionDetail = {
  metrics: { revenue: number; transactions: number; hotelGroupCount: number; locationGroupCount: number }
  hotelGroupBreakdown: { name: string; revenue: number; transactions: number; hotelCount: number; avgRevenuePerHotel: number }[]
  locationGroupBreakdown: { name: string; revenue: number; transactions: number; outletCount: number; totalRooms: number | null }[]
  previousMetrics: { revenue: number; transactions: number } | null
}

export type LocationGroupData = {
  id: string
  name: string
  revenue: number
  transactions: number
  hotelCount: number
  totalRooms: number | null
  revenuePerRoom: number | null
  txnPerKiosk: number | null
  avgBasketValue: number
}

export type LocationGroupDetail = {
  metrics: { revenue: number; transactions: number; hotelCount: number; totalRooms: number | null }
  capacityMetrics: { revenuePerRoom: number | null; txnPerRoom: number | null; txnPerKiosk: number | null; avgBasketValue: number; totalRooms: number | null; totalKiosks: number | null }
  peerAnalysis: { metric: string; value: number; percentile: number }[]
  hotelBreakdown: HotelInGroup[]
  previousMetrics: { revenue: number; transactions: number } | null
}

// ─── Weather Types ────────────────────────────────────────────────────────────

export type DailyWeather = {
  date: string
  temperatureMax: number
  temperatureMin: number
  precipitation: number
}

// ─── Business Event Types ─────────────────────────────────────────────────────

export type BusinessEventDisplay = {
  id: string
  title: string
  description: string | null
  startDate: string
  endDate: string | null
  categoryId: string
  categoryName: string
  categoryColor: string
  scopeType: "global" | "hotel" | "region" | "hotel_group"
  scopeValue: string | null
}

// ─── Dimension Option Types (for filter dropdowns) ────────────────────────────

export type DimensionOptions = {
  locations: { id: string; name: string; outletCode: string }[]
  products: { id: string; name: string; category: string | null }[]
  hotelGroups: { id: string; name: string }[]
  regions: { id: string; name: string }[]
  locationGroups: { id: string; name: string }[]
}

// ─── High Performer Patterns ─────────────────────────────────────────────────

export type HighPerformerPatterns = {
  greenCount: number;
  totalCount: number;
  insights: string[];
  hotelGroupDistribution: { name: string; count: number; percentage: number }[];
  regionDistribution: { name: string; count: number; percentage: number }[];
  avgKioskCount: number | null;
  avgRoomCount: number | null;
  avgRevenuePerRoom: number | null;
  topProducts: { name: string; revenue: number }[];
};

// ─── Location Flag Types ─────────────────────────────────────────────────────

export type FlagType = "relocate" | "monitor" | "strategic_exception";

export type LocationFlag = {
  id: string;
  locationId: string;
  flagType: FlagType;
  reason: string | null;
  actorName: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
};

// ─── Experiment Cohort Types ─────────────────────────────────────────────────

export type ExperimentCohort = {
  id: string;
  name: string;
  description: string | null;
  locationIds: string[];
  controlType: "rest_of_portfolio" | "named_control";
  controlLocationIds: string[] | null;
  interventionDate: string | null;
  createdBy: string;
  createdAt: string;
};

export type CohortComparison = {
  cohortMetrics: { revenue: number; transactions: number; avgRevenue: number };
  controlMetrics: { revenue: number; transactions: number; avgRevenue: number };
  delta: { revenue: number; transactions: number; avgRevenue: number };
};

// ─── Action Item Types ──────────────────────────────────────────────────────

export type ActionItemType = "investigation" | "relocation" | "training" | "equipment_change";
export type ActionItemStatus = "open" | "in_progress" | "resolved" | "cancelled";

export type ActionItem = {
  id: string;
  sourceType: "flag" | "manual" | "data_quality";
  sourceId: string | null;
  locationId: string | null;
  locationName: string | null;
  actionType: ActionItemType;
  title: string;
  description: string | null;
  ownerName: string | null;
  ownerId: string | null;
  dueDate: string | null;
  status: ActionItemStatus;
  outcomeNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

// ─── Temporal Comparison Types ───────────────────────────────────────────────

export type PeriodMetrics = {
  revenue: number;
  transactions: number;
  avgRevenue: number;
  periodLabel: string;
  dateFrom: string;
  dateTo: string;
};

export type TemporalComparison = {
  pre: PeriodMetrics;
  during: PeriodMetrics;
  yoyPre: PeriodMetrics;
  yoyDuring: PeriodMetrics;
};

// ─── Comparison Types ────────────────────────────────────────────────────────

export type ComparisonEntityType = "location" | "hotel_group" | "region"

export type ComparisonEntity = {
  entityId: string
  entityName: string
  revenue: number
  transactions: number
  avgBasket: number
}

// ─── Maturity Analysis Types ────────────────────────────────────────────────

export type MaturityBucketMetrics = {
  bucket: string;
  locationCount: number;
  avgRevenue: number;
  totalRevenue: number;
};

export type RevenueRampPoint = {
  monthsSinceInstall: number;
  avgRevenue: number;
  locationCount: number;
};

export type InstallCohort = {
  installMonth: string;
  locationCount: number;
  avgMonthlyRevenue: number;
};

export type MaturityAnalysis = {
  bucketMetrics: MaturityBucketMetrics[];
  rampCurve: RevenueRampPoint[];
  installCohorts: InstallCohort[];
};

// ─── Change Indicator ─────────────────────────────────────────────────────────

export type ChangeDirection = "up" | "down" | "neutral"

export type ChangeIndicator = {
  text: string
  color: string
  direction: ChangeDirection
}
