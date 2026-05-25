# Command Centre — gRPC Service Interface Specification

> Source: Analytics routes in `wkg-command-centre` Next.js UI
> Target: Java Spring Boot microservice → consumed by `kato` api-gateway controllers
> Written: 2026-05-25

---

## 1. Design Principles

- **One RPC per distinct server action** in the Next.js UI — the api-gateway controller maps each HTTP handler 1:1 to a gRPC call; no fan-out at the gateway layer.
- **`AnalyticsFilter` is shared** across all analytics RPCs — defined once in `common.proto` and imported.
- **Pagination** on list/pivot endpoints uses cursor-based `page_token` + `page_size`, not offset.
- **Streaming** is used only for export (CSV/Excel bytes) — all other RPCs are unary.
- **User identity and RBAC** are passed via gRPC metadata (request header), not in the proto message body. The service applies `scopedSalesCondition` based on the caller's role/scopes.
- **All monetary values are GBP**, `numeric(12,2)` encoded as string to avoid float precision loss.
- **`currency_key`** on responses is `null` (empty string) when the cohort has mixed currencies; the gateway/frontend uses it to switch display labels.

---

## 2. Common Types (`common.proto`)

```protobuf
syntax = "proto3";
package wkg.commandcentre.v1;

import "google/protobuf/wrappers.proto";

// ── Shared analytics filter ────────────────────────────────────────────────────

enum MetricMode {
  METRIC_MODE_SALES   = 0;   // all non-fee, non-reversal transactions
  METRIC_MODE_REVENUE = 1;   // WKG booking-fee rows only (is_weknow_fee=true)
}

message AnalyticsFilter {
  string date_from                    = 1;  // YYYY-MM-DD (required)
  string date_to                      = 2;  // YYYY-MM-DD (required)
  repeated string hotel_ids           = 3;  // location UUIDs
  repeated string region_ids          = 4;
  repeated string product_ids         = 5;
  repeated string hotel_group_ids     = 6;
  repeated string location_group_ids  = 7;
  repeated string maturity_buckets    = 8;  // "0-1mo","1-3mo","3-6mo","6-9mo","9-12mo","12mo+"
  repeated string location_types      = 9;  // "hotel","retail_desk","online","airport","hex_kiosk","internal"
  MetricMode metric_mode              = 10;
  bool include_internal_accounts      = 11; // default false
}

// ── Shared metric snapshot ─────────────────────────────────────────────────────

message Metrics {
  string revenue        = 1;  // GBP, numeric string e.g. "12345.67"
  int64  transactions   = 2;
  string avg_basket_gbp = 3;  // GBP, numeric string
  string currency_key   = 4;  // ISO code if single-currency cohort, empty = multi-currency
}

message MetricsWithComparison {
  Metrics current  = 1;
  Metrics previous = 2;  // populated when comparison period requested
  double  revenue_change_pct      = 3;
  double  transactions_change_pct = 4;
}

// ── Pagination ─────────────────────────────────────────────────────────────────

message PageRequest {
  int32  page_size  = 1;  // default 50, max 500
  string page_token = 2;  // opaque cursor from previous response
}

message PageInfo {
  string next_page_token = 1;  // empty = last page
  int32  total_count     = 2;  // total rows before pagination (for UI)
}

// ── Period comparison presets ──────────────────────────────────────────────────

enum ComparisonPeriod {
  COMPARISON_PERIOD_NONE          = 0;
  COMPARISON_PERIOD_PREVIOUS_MOM  = 1;  // same length, immediately prior
  COMPARISON_PERIOD_PREVIOUS_YOY  = 2;  // same calendar window, prior year
}
```

---

## 3. Service: `AnalyticsService`

Covers all 13 analytics route data shapes.

```protobuf
service AnalyticsService {

  // ── Portfolio ─────────────────────────────────────────────────────────────

  // Summary KPIs: total revenue, transactions, avg basket, previous period
  rpc GetPortfolioSummary (PortfolioSummaryRequest)
      returns (PortfolioSummaryResponse);

  // Revenue / transaction breakdown by product category
  rpc GetPortfolioCategories (PortfolioRequest)
      returns (PortfolioCategoriesResponse);

  // Top products ranked by revenue
  rpc GetPortfolioProducts (PortfolioRequest)
      returns (PortfolioProductsResponse);

  // Daily or hourly time-series for the portfolio
  rpc GetPortfolioTrend (PortfolioTrendRequest)
      returns (PortfolioTrendResponse);

  // Outlet tier classification (revenue buckets)
  rpc GetPortfolioOutletTiers (PortfolioRequest)
      returns (PortfolioOutletTiersResponse);

  // High-performer pattern analysis (region distribution, product mix)
  rpc GetHighPerformerAnalysis (PortfolioRequest)
      returns (HighPerformerAnalysisResponse);

  // ── Heat Map ─────────────────────────────────────────────────────────────

  // All locations ranked by composite score with property enrichment
  rpc GetHeatMap (HeatMapRequest)
      returns (HeatMapResponse);

  // ── Trend Builder ─────────────────────────────────────────────────────────

  // Multi-series time-series (revenue, transactions, avg basket, booking fee)
  // with optional YoY comparison series and business-event overlays
  rpc GetTrendSeries (TrendSeriesRequest)
      returns (TrendSeriesResponse);

  // ── Hotel Groups ─────────────────────────────────────────────────────────

  rpc ListHotelGroups (ListHotelGroupsRequest)
      returns (ListHotelGroupsResponse);

  rpc GetHotelGroupDetail (HotelGroupDetailRequest)
      returns (HotelGroupDetailResponse);

  // ── Regions ───────────────────────────────────────────────────────────────

  rpc ListRegions (ListRegionsRequest)
      returns (ListRegionsResponse);

  rpc GetRegionDetail (RegionDetailRequest)
      returns (RegionDetailResponse);

  // ── Location Groups ───────────────────────────────────────────────────────

  rpc ListLocationGroups (ListLocationGroupsRequest)
      returns (ListLocationGroupsResponse);

  rpc GetLocationGroupDetail (LocationGroupDetailRequest)
      returns (LocationGroupDetailResponse);

  // ── Compare ───────────────────────────────────────────────────────────────

  // Side-by-side metrics for a set of entity IDs of the same dimension type
  rpc GetComparison (ComparisonRequest)
      returns (ComparisonResponse);

  // ── Experiments ───────────────────────────────────────────────────────────

  rpc GetExperimentMetrics (ExperimentRequest)
      returns (ExperimentResponse);

  // ── Maturity Analysis ─────────────────────────────────────────────────────

  rpc GetMaturityBuckets (MaturityRequest)
      returns (MaturityBucketsResponse);

  rpc GetMaturityRampCurve (MaturityRequest)
      returns (MaturityRampCurveResponse);

  rpc GetInstallCohorts (MaturityRequest)
      returns (InstallCohortsResponse);

  // ── Pivot Table ───────────────────────────────────────────────────────────

  rpc GetPivotTable (PivotTableRequest)
      returns (PivotTableResponse);
}
```

### 3.1 Portfolio messages

```protobuf
message PortfolioRequest {
  AnalyticsFilter filter = 1;
}

message PortfolioSummaryRequest {
  AnalyticsFilter  filter            = 1;
  ComparisonPeriod comparison_period = 2;
}

message PortfolioSummaryResponse {
  MetricsWithComparison metrics         = 1;
  string                date_range_from = 2;
  string                date_range_to   = 3;
}

message CategoryRow {
  string  category_code  = 1;
  string  category_name  = 2;
  string  revenue_gbp    = 3;
  int64   transactions   = 4;
  double  revenue_share  = 5;  // 0.0–1.0
}

message PortfolioCategoriesResponse {
  repeated CategoryRow rows = 1;
}

message ProductRow {
  string product_id     = 1;
  string product_name   = 2;
  string netsuite_code  = 3;
  string revenue_gbp    = 4;
  int64  transactions   = 5;
  double revenue_share  = 6;
}

message PortfolioProductsResponse {
  repeated ProductRow rows       = 1;
  int32               total_count = 2;
}

enum TrendGranularity {
  TREND_GRANULARITY_DAILY   = 0;
  TREND_GRANULARITY_HOURLY  = 1;
  TREND_GRANULARITY_WEEKLY  = 2;
  TREND_GRANULARITY_MONTHLY = 3;
}

message PortfolioTrendRequest {
  AnalyticsFilter  filter      = 1;
  TrendGranularity granularity = 2;
}

message TrendPoint {
  string bucket       = 1;  // "2026-05-01" (daily/weekly/monthly) or "14" (hourly = hour of day)
  string revenue_gbp  = 2;
  int64  transactions = 3;
  string avg_basket   = 4;
}

message PortfolioTrendResponse {
  repeated TrendPoint points = 1;
}

message OutletTierRow {
  string tier_label    = 1;  // e.g. "Top 10%", "£0–£1k"
  int32  outlet_count  = 2;
  string revenue_gbp   = 3;
  double revenue_share = 4;
}

message PortfolioOutletTiersResponse {
  repeated OutletTierRow tiers     = 1;
  int32                  truncated = 2;  // rows omitted by cap (max 200)
  int32                  total     = 3;
}

message HighPerformerAnalysisResponse {
  repeated RegionDistributionRow region_distribution = 1;
  repeated ProductMixRow         product_mix         = 2;
}

message RegionDistributionRow {
  string region_id    = 1;
  string region_name  = 2;
  int32  hotel_count  = 3;
  double revenue_share = 4;
}

message ProductMixRow {
  string product_id    = 1;
  string product_name  = 2;
  double revenue_share = 3;
}
```

### 3.2 Heat Map messages

```protobuf
message HeatMapRequest {
  AnalyticsFilter filter    = 1;
  HeatMapWeights  weights   = 2;  // optional — omit to use defaults
  HeatMapScope    scope     = 3;
}

enum HeatMapScope {
  HEAT_MAP_SCOPE_ALL    = 0;
  HEAT_MAP_SCOPE_TOP10  = 1;
  HEAT_MAP_SCOPE_BOTTOM10 = 2;
}

message HeatMapWeights {
  double revenue         = 1;  // default 0.30
  double transactions    = 2;  // default 0.20
  double rev_per_room    = 3;  // default 0.25
  double txn_per_kiosk   = 4;  // default 0.15
  double avg_basket      = 5;  // default 0.10
  // weights must sum to 1.0
}

message HeatMapRow {
  int32  rank               = 1;
  string location_id        = 2;
  string location_name      = 3;
  string outlet_code        = 4;
  string hotel_group_name   = 5;
  string revenue_gbp        = 6;
  int64  transactions       = 7;
  string rev_per_room_gbp   = 8;  // empty if room_count unknown
  string txn_per_kiosk      = 9;
  string avg_basket_gbp     = 10;
  double composite_score    = 11;
  double percentile         = 12;  // 0.0–100.0
  int32  kiosk_count        = 13;
  int32  room_count         = 14;
}

message HeatMapResponse {
  repeated HeatMapRow rows = 1;
  int32 total_locations    = 2;
}
```

### 3.3 Trend Builder messages

```protobuf
enum TrendMetric {
  TREND_METRIC_REVENUE       = 0;
  TREND_METRIC_TRANSACTIONS  = 1;
  TREND_METRIC_AVG_BASKET    = 2;
  TREND_METRIC_BOOKING_FEE   = 3;
}

message TrendSeries {
  string                name        = 1;  // user-supplied series label
  TrendMetric           metric      = 2;
  AnalyticsFilter       filter      = 3;  // per-series filter (can narrow dates, hotels, etc.)
  bool                  include_yoy = 4;  // append a YoY comparison series
}

message TrendSeriesRequest {
  repeated TrendSeries  series      = 1;
  TrendGranularity      granularity = 2;
  bool                  include_business_events = 3;
  repeated string       event_category_ids      = 4;  // filter overlaid events
}

message TrendDataPoint {
  string bucket        = 1;  // ISO date or hour-of-day integer
  string value         = 2;  // revenue as GBP string, or transaction count
}

message TrendSeriesResult {
  string                    series_name = 1;
  TrendMetric               metric      = 2;
  repeated TrendDataPoint   points      = 3;
  bool                      is_yoy      = 4;
}

message BusinessEventOverlay {
  string event_id       = 1;
  string title          = 2;
  string event_date     = 3;
  string category_name  = 4;
  string category_color = 5;
}

message TrendSeriesResponse {
  repeated TrendSeriesResult    series  = 1;
  repeated BusinessEventOverlay events  = 2;
}
```

### 3.4 Hotel Groups messages

```protobuf
message ListHotelGroupsRequest {
  AnalyticsFilter  filter            = 1;
  ComparisonPeriod comparison_period = 2;
  PageRequest      page              = 3;
}

message HotelGroupSummaryRow {
  string                id              = 1;
  string                name            = 2;
  int32                 hotel_count     = 3;
  MetricsWithComparison metrics         = 4;
}

message ListHotelGroupsResponse {
  repeated HotelGroupSummaryRow rows     = 1;
  PageInfo                      page_info = 2;
}

message HotelGroupDetailRequest {
  string          hotel_group_id = 1;
  AnalyticsFilter filter         = 2;
}

message HotelGroupDetailResponse {
  string              id                = 1;
  string              name              = 2;
  Metrics             metrics           = 3;
  repeated HotelRow   hotels            = 4;
  repeated TrendPoint trend             = 5;  // daily for the filter window
}

message HotelRow {
  string location_id   = 1;
  string location_name = 2;
  Metrics metrics      = 3;
  int32  room_count    = 4;
  int32  kiosk_count   = 5;
}
```

### 3.5 Regions messages

```protobuf
message ListRegionsRequest {
  AnalyticsFilter  filter            = 1;
  ComparisonPeriod comparison_period = 2;
}

message RegionSummaryRow {
  string                id              = 1;
  string                name            = 2;
  string                code            = 3;
  int32                 hotel_count     = 4;
  int32                 hotel_group_count = 5;
  int32                 location_group_count = 6;
  MetricsWithComparison metrics         = 7;
}

message ListRegionsResponse {
  repeated RegionSummaryRow rows = 1;
}

message RegionDetailRequest {
  string          region_id = 1;
  AnalyticsFilter filter    = 2;
}

message RegionDetailResponse {
  string              id              = 1;
  string              name            = 2;
  Metrics             metrics         = 3;
  repeated HotelRow   hotels          = 4;
  repeated LocationGroupBreakdownRow location_groups = 5;
}

message LocationGroupBreakdownRow {
  string  location_group_id   = 1;
  string  location_group_name = 2;
  int32   hotel_count         = 3;
  Metrics metrics             = 4;
}
```

### 3.6 Location Groups messages

```protobuf
message ListLocationGroupsRequest {
  AnalyticsFilter  filter            = 1;
  ComparisonPeriod comparison_period = 2;
  PageRequest      page              = 3;
}

message LocationGroupSummaryRow {
  string                id          = 1;
  string                name        = 2;
  int32                 hotel_count = 3;
  int32                 total_rooms = 4;
  MetricsWithComparison metrics     = 5;
  string                rev_per_room_gbp  = 6;
  string                txn_per_kiosk     = 7;
}

message ListLocationGroupsResponse {
  repeated LocationGroupSummaryRow rows     = 1;
  PageInfo                         page_info = 2;
}

message LocationGroupDetailRequest {
  string          location_group_id = 1;
  AnalyticsFilter filter            = 2;
}

message LocationGroupDetailResponse {
  string              id              = 1;
  string              name            = 2;
  Metrics             metrics         = 3;
  string              rev_per_room_gbp = 4;
  string              txn_per_kiosk    = 5;
  repeated HotelRow   hotels           = 6;
  repeated HotelRow   peer_hotels      = 7;  // hotels in same region outside this group
}
```

### 3.7 Compare messages

```protobuf
enum CompareDimension {
  COMPARE_DIMENSION_LOCATION       = 0;
  COMPARE_DIMENSION_HOTEL_GROUP    = 1;
  COMPARE_DIMENSION_REGION         = 2;
  COMPARE_DIMENSION_LOCATION_GROUP = 3;
  COMPARE_DIMENSION_PRODUCT        = 4;
}

message ComparisonRequest {
  repeated string  entity_ids = 1;  // 2–N entity UUIDs of the same dimension type
  CompareDimension dimension  = 2;
  AnalyticsFilter  filter     = 3;
}

message ComparisonEntityResult {
  string              entity_id   = 1;
  string              entity_name = 2;
  Metrics             metrics     = 3;
  repeated TrendPoint trend       = 4;  // daily for filter window
}

message ComparisonResponse {
  repeated ComparisonEntityResult entities = 1;
}
```

### 3.8 Experiments messages

```protobuf
message ExperimentRequest {
  string          experiment_cohort_id = 1;
  AnalyticsFilter filter               = 2;
  bool            include_yoy          = 3;
}

message ExperimentPhaseMetrics {
  string phase_label   = 1;  // "Pre-intervention", "During intervention"
  string date_from     = 2;
  string date_to       = 3;
  Metrics cohort       = 4;
  Metrics control      = 5;
  Metrics delta        = 6;  // cohort - control
}

message ExperimentResponse {
  string                         cohort_name    = 1;
  int32                          cohort_size    = 2;
  repeated ExperimentPhaseMetrics phases         = 3;
  repeated TrendPoint            cohort_trend   = 4;
  repeated TrendPoint            control_trend  = 5;
}
```

### 3.9 Maturity Analysis messages

```protobuf
message MaturityRequest {
  AnalyticsFilter filter = 1;
}

message MaturityBucketRow {
  string  bucket_label   = 1;  // "0-1mo", "1-3mo", etc.
  int32   location_count = 2;
  string  avg_revenue_gbp = 3;
  string  total_revenue_gbp = 4;
}

message MaturityBucketsResponse {
  repeated MaturityBucketRow buckets = 1;
}

message RampPoint {
  int32  months_since_install = 1;
  string avg_revenue_gbp      = 2;
  int32  location_count       = 3;
}

message MaturityRampCurveResponse {
  repeated RampPoint points = 1;
}

message InstallCohortRow {
  string install_month      = 1;  // "YYYY-MM"
  int32  location_count     = 2;
  string avg_monthly_rev_gbp = 3;
}

message InstallCohortsResponse {
  repeated InstallCohortRow cohorts = 1;
}
```

### 3.10 Pivot Table messages

```protobuf
enum PivotField {
  PIVOT_FIELD_LOCATION       = 0;
  PIVOT_FIELD_HOTEL_GROUP    = 1;
  PIVOT_FIELD_REGION         = 2;
  PIVOT_FIELD_PRODUCT        = 3;
  PIVOT_FIELD_LOCATION_GROUP = 4;
  PIVOT_FIELD_PROVIDER       = 5;
  PIVOT_FIELD_DATE_MONTH     = 6;
  PIVOT_FIELD_DATE_WEEK      = 7;
}

enum PivotAggregation {
  PIVOT_AGG_SUM   = 0;
  PIVOT_AGG_AVG   = 1;
  PIVOT_AGG_COUNT = 2;
  PIVOT_AGG_MIN   = 3;
  PIVOT_AGG_MAX   = 4;
}

enum PivotValueMetric {
  PIVOT_VALUE_REVENUE      = 0;
  PIVOT_VALUE_TRANSACTIONS = 1;
  PIVOT_VALUE_AVG_BASKET   = 2;
}

message PivotTableRequest {
  AnalyticsFilter filter      = 1;
  PivotField      row_field   = 2;
  PivotField      column_field = 3;
  PivotValueMetric value_metric = 4;
  PivotAggregation aggregation  = 5;
  PageRequest      page         = 6;  // paginates rows, not columns
}

message PivotCell {
  string column_id    = 1;
  string column_label = 2;
  string value        = 3;  // numeric string
}

message PivotRow {
  string             row_id    = 1;
  string             row_label = 2;
  repeated PivotCell cells     = 3;
  string             row_total = 4;
}

message PivotTableResponse {
  repeated string   column_labels  = 1;
  repeated PivotRow rows           = 2;
  repeated string   column_totals  = 3;  // indexed same as column_labels
  string            grand_total    = 4;
  PageInfo          page_info      = 5;
}
```

---

## 4. Service: `CommissionService`

```protobuf
service CommissionService {

  // Commission ledger summary grouped by location and product
  rpc GetCommissionSummary (CommissionRequest)
      returns (CommissionSummaryResponse);

  // Monthly commission totals for trend chart
  rpc GetCommissionTrend (CommissionRequest)
      returns (CommissionTrendResponse);

  // Recalculate commissions for a location-product pair + month (admin action)
  rpc RecalculateCommissions (RecalculateCommissionsRequest)
      returns (RecalculateCommissionsResponse);
}

message CommissionRequest {
  AnalyticsFilter filter = 1;
}

message CommissionRow {
  string location_id           = 1;
  string location_name         = 2;
  string product_id            = 3;
  string product_name          = 4;
  string gross_amount_gbp      = 5;
  string commissionable_amount = 6;
  string commission_amount     = 7;
  string tier_version          = 8;  // effectiveFrom of active tier
}

message CommissionSummaryResponse {
  repeated CommissionRow rows           = 1;
  string                 total_commission_gbp = 2;
}

message CommissionTrendPoint {
  string month              = 1;  // "YYYY-MM"
  string commission_gbp     = 2;
  string commissionable_gbp = 3;
}

message CommissionTrendResponse {
  repeated CommissionTrendPoint points = 1;
}

message RecalculateCommissionsRequest {
  string location_product_id = 1;  // UUID
  string month               = 2;  // "YYYY-MM"
}

message RecalculateCommissionsResponse {
  int32 reversed      = 1;
  int32 recalculated  = 2;
}
```

---

## 5. Service: `FlagsService`

Covers the flags and actions-dashboard analytics routes.

```protobuf
service FlagsService {

  rpc ListFlags (ListFlagsRequest)
      returns (ListFlagsResponse);

  rpc CreateFlag (CreateFlagRequest)
      returns (Flag);

  rpc UpdateFlag (UpdateFlagRequest)
      returns (Flag);

  rpc ListActionItems (ListActionItemsRequest)
      returns (ListActionItemsResponse);

  rpc CreateActionItem (CreateActionItemRequest)
      returns (ActionItem);

  rpc UpdateActionItem (UpdateActionItemRequest)
      returns (ActionItem);
}

enum FlagType {
  FLAG_TYPE_RELOCATE           = 0;
  FLAG_TYPE_MONITOR            = 1;
  FLAG_TYPE_STRATEGIC_EXCEPTION = 2;
}

enum FlagStatus {
  FLAG_STATUS_ACTIVE   = 0;
  FLAG_STATUS_RESOLVED = 1;
}

message Flag {
  string     id            = 1;
  string     location_id   = 2;
  string     location_name = 3;
  FlagType   type          = 4;
  FlagStatus status        = 5;
  string     reason        = 6;
  string     created_at    = 7;
  string     resolved_at   = 8;
  int32      action_item_count = 9;
}

message ListFlagsRequest {
  repeated FlagType   types       = 1;
  repeated FlagStatus statuses    = 2;
  repeated string     location_ids = 3;
  PageRequest         page        = 4;
}

message ListFlagsResponse {
  repeated Flag rows     = 1;
  PageInfo      page_info = 2;
}

message CreateFlagRequest {
  string   location_id = 1;
  FlagType type        = 2;
  string   reason      = 3;
}

message UpdateFlagRequest {
  string     flag_id   = 1;
  FlagStatus status    = 2;
  string     reason    = 3;  // optional update to reason text
}

enum ActionItemType {
  ACTION_ITEM_INVESTIGATION  = 0;
  ACTION_ITEM_RELOCATION     = 1;
  ACTION_ITEM_TRAINING       = 2;
  ACTION_ITEM_EQUIPMENT      = 3;
}

enum ActionItemStatus {
  ACTION_ITEM_OPEN        = 0;
  ACTION_ITEM_IN_PROGRESS = 1;
  ACTION_ITEM_RESOLVED    = 2;
  ACTION_ITEM_CANCELLED   = 3;
}

message ActionItem {
  string           id          = 1;
  string           flag_id     = 2;
  ActionItemType   type        = 3;
  ActionItemStatus status      = 4;
  string           description = 5;
  string           assignee_id = 6;
  string           due_date    = 7;  // YYYY-MM-DD
  string           created_at  = 8;
  string           updated_at  = 9;
}

message ListActionItemsRequest {
  string               flag_id   = 1;  // optional — omit to list all
  repeated ActionItemStatus statuses = 2;
  repeated ActionItemType   types    = 3;
  PageRequest          page      = 4;
}

message ListActionItemsResponse {
  repeated ActionItem rows     = 1;
  PageInfo            page_info = 2;
}

message CreateActionItemRequest {
  string         flag_id     = 1;
  ActionItemType type        = 2;
  string         description = 3;
  string         assignee_id = 4;
  string         due_date    = 5;
}

message UpdateActionItemRequest {
  string           action_item_id = 1;
  ActionItemStatus status         = 2;
  string           description    = 3;
  string           assignee_id    = 4;
  string           due_date       = 5;
}
```

---

## 6. Service: `ExportService`

Server-streaming — the gateway forwards the byte stream to the HTTP response.

```protobuf
service ExportService {

  // Returns a stream of raw file bytes (CSV or Excel).
  // The gateway sets Content-Type and Content-Disposition from the first ExportChunk.
  rpc ExportAnalytics (ExportRequest)
      returns (stream ExportChunk);
}

enum ExportTab {
  EXPORT_TAB_PORTFOLIO       = 0;
  EXPORT_TAB_HEAT_MAP        = 1;
  EXPORT_TAB_HOTEL_GROUPS    = 2;
  EXPORT_TAB_REGIONS         = 3;
  EXPORT_TAB_LOCATION_GROUPS = 4;
}

enum ExportFormat {
  EXPORT_FORMAT_CSV   = 0;
  EXPORT_FORMAT_EXCEL = 1;
}

message ExportRequest {
  ExportTab       tab    = 1;
  AnalyticsFilter filter = 2;
  ExportFormat    format = 3;
}

message ExportChunk {
  bytes  data         = 1;   // raw file bytes (chunked at ~64KB)
  string filename     = 2;   // only set on first chunk
  string content_type = 3;   // only set on first chunk
}
```

---

## 7. Service: `DimensionService`

Populates filter dropdowns in the UI. Results are scoped to the caller's RBAC context.

```protobuf
service DimensionService {

  rpc ListLocations (DimensionListRequest)
      returns (LocationListResponse);

  rpc ListRegions (DimensionListRequest)
      returns (RegionListResponse);

  rpc ListHotelGroups (DimensionListRequest)
      returns (HotelGroupListResponse);

  rpc ListLocationGroups (DimensionListRequest)
      returns (LocationGroupListResponse);

  rpc ListProducts (DimensionListRequest)
      returns (ProductListResponse);

  rpc ListProviders (DimensionListRequest)
      returns (ProviderListResponse);
}

message DimensionListRequest {
  string search_query = 1;  // optional — filter by name prefix
  int32  limit        = 2;  // default 100, max 500
}

message LocationItem {
  string id              = 1;
  string name            = 2;
  string outlet_code     = 3;
  string location_type   = 4;
  string region_id       = 5;
}

message LocationListResponse {
  repeated LocationItem items = 1;
}

message RegionItem {
  string id   = 1;
  string name = 2;
  string code = 3;
}

message RegionListResponse {
  repeated RegionItem items = 1;
}

message HotelGroupItem {
  string id   = 1;
  string name = 2;
}

message HotelGroupListResponse {
  repeated HotelGroupItem items = 1;
}

message LocationGroupItem {
  string id   = 1;
  string name = 2;
}

message LocationGroupListResponse {
  repeated LocationGroupItem items = 1;
}

message ProductItem {
  string id             = 1;
  string name           = 2;
  string netsuite_code  = 3;
  string category_code  = 4;
  string category_name  = 5;
}

message ProductListResponse {
  repeated ProductItem items = 1;
}

message ProviderItem {
  string id   = 1;
  string name = 2;
}

message ProviderListResponse {
  repeated ProviderItem items = 1;
}
```

---

## 8. Service: `EtlService`

Exposes ETL control and observability to the gateway (admin-only operations).

```protobuf
service EtlService {

  // Manually trigger the Azure ETL run (equivalent to POST /api/etl/azure/run)
  rpc TriggerAzureEtl (TriggerEtlRequest)
      returns (TriggerEtlResponse);

  // List recent blob ingestion history
  rpc ListBlobIngestions (ListBlobIngestionsRequest)
      returns (ListBlobIngestionsResponse);

  // List recent sales imports
  rpc ListSalesImports (ListSalesImportsRequest)
      returns (ListSalesImportsResponse);
}

message TriggerEtlRequest {
  // empty — auth enforced via gRPC metadata
}

message TriggerEtlResponse {
  string           status              = 1;  // "ok" | "skipped-lock"
  repeated string  processed_blobs     = 2;
  repeated string  skipped_blobs       = 3;
  repeated FailedBlob failed_blobs     = 4;
}

message FailedBlob {
  string region_code = 1;
  string blob_path   = 2;
  string error       = 3;
}

message ListBlobIngestionsRequest {
  string region_id = 1;  // optional filter
  string status    = 2;  // "success" | "failed" | "" (all)
  PageRequest page = 3;
}

message BlobIngestionRow {
  string id           = 1;
  string region_code  = 2;
  string blob_path    = 3;
  string blob_date    = 4;
  string status       = 5;
  string processed_at = 6;
  string error_message = 7;
  string import_id    = 8;
}

message ListBlobIngestionsResponse {
  repeated BlobIngestionRow rows     = 1;
  PageInfo                  page_info = 2;
}

message ListSalesImportsRequest {
  string region_id = 1;
  string status    = 2;  // "staging" | "committed" | "failed" | "" (all)
  PageRequest page = 3;
}

message SalesImportRow {
  string id               = 1;
  string filename         = 2;
  string status           = 3;
  string region_id        = 4;
  int32  row_count        = 5;
  string date_range_start = 6;
  string date_range_end   = 7;
  string uploaded_at      = 8;
}

message ListSalesImportsResponse {
  repeated SalesImportRow rows     = 1;
  PageInfo                page_info = 2;
}
```

---

## 9. Complete Service Inventory

| Service | RPCs | Consumed by route(s) |
|---|---|---|
| `AnalyticsService` | 21 | portfolio, heat-map, trend-builder, hotel-groups, regions, location-groups, compare, experiments, maturity, pivot |
| `CommissionService` | 3 | commission |
| `FlagsService` | 6 | flags, actions-dashboard |
| `ExportService` | 1 (streaming) | All tabs via `/api/export/csv` and `/api/export/excel` |
| `DimensionService` | 6 | Filter dropdowns on all analytics routes |
| `EtlService` | 3 | Admin panel / ops tooling |
| **Total** | **40** | |

---

## 10. gRPC Metadata Contract (Auth)

The api-gateway injects caller identity into gRPC metadata on every call. The command-centre service reads these to apply `scopedSalesCondition` (RBAC row filtering):

| Metadata Key | Type | Description |
|---|---|---|
| `x-user-id` | string | Better Auth user ID (text, not UUID) |
| `x-user-role` | string | `admin` \| `member` \| `external` |
| `x-user-scopes` | string (JSON) | Serialised `UserScope[]` — `{dimensionType, dimensionId}[]` |
| `x-request-id` | string | Trace ID for distributed logging |

---

## 11. Key Implementation Notes for Spring Boot

1. **RBAC scope enforcement:** Every analytics query must apply `scopedSalesCondition` — a WHERE clause predicate that limits `location_id` to the intersection of the user's `user_scopes` rows and the filter's explicit `hotel_ids`. Admins bypass this (no predicate). Externals always have it applied even if `hotel_ids` is empty.

2. **`unstable_cache` equivalent:** The Next.js app caches query results keyed on `{userId + userRole + userScopes + filters}`. In Spring Boot, replicate this with Redis: key `analytics:{sha256(userId+role+scopes+filterJson)}`, TTL 5 minutes. Invalidate all keys on ETL commit.

3. **Revenue vs Sales mode:** `MetricMode.SALES` → `WHERE is_weknow_fee = false AND is_reversal = false`. `MetricMode.REVENUE` → `WHERE is_weknow_fee = true` (booking fee rows only, `netsuite_code = '9991'`).

4. **`currency_key` logic:** For any aggregation, if all records in the result set share a single `currency` value, set `currency_key` to that ISO code. If mixed, set empty string. The frontend uses this to display "€12,345" instead of "£12,345 GBP".

5. **Maturity bucket calculation:** Buckets are relative to `filter.date_to`. A location is in bucket `0-1mo` if `date_to - kiosk_live_date <= 31 days`. Join `kiosks` → `kiosk_assignments` → `locations` to get `kiosks.installation_date` as the live date.

6. **Weighted average basket:** Trend builder basket value uses a split numerator/denominator pattern — accumulate `SUM(net_amount_gbp)` and `COUNT(*)` separately per bucket, then divide at the end. Do NOT average pre-computed per-row basket values (produces wrong results for mixed-volume buckets).

7. **Export streaming:** For CSV/Excel export the Spring Boot service should produce the file bytes in chunks (64 KB) and stream via server-side gRPC streaming to avoid holding large responses in memory. Excel generation should use Apache POI streaming API (`SXSSFWorkbook`).

8. **Business events for trend overlay:** `businessEvents` join `eventCategories` on `category_id`. Filter by `event_date BETWEEN date_from AND date_to` and optionally by `category_id IN (event_category_ids)`.

9. **Composite heat-map score:** `score = (revenue_norm * 0.30) + (txn_norm * 0.20) + (rev_per_room_norm * 0.25) + (txn_per_kiosk_norm * 0.15) + (basket_norm * 0.10)`. Each metric is min-max normalised across the result set: `norm = (value - min) / (max - min)`. If `room_count` is NULL, `rev_per_room` component falls back to 0 (not normalised) and the remaining weights are NOT redistributed — the score is simply lower for hotels with unknown room counts.

10. **Pivot table truncation:** Cap pivot rows at 200 (same as the Next.js query). Return `total_count` in `PageInfo` so the gateway can tell the frontend how many rows were omitted.

---

## 12. REST Endpoint Mapping (api-gateway controllers)

The api-gateway exposes these HTTP endpoints. Each maps 1:1 to a gRPC call above. The gateway validates the session token, builds gRPC metadata, calls the service, and serialises the response to JSON.

### 12.1 Common query parameters

These apply to **every** analytics `GET` endpoint. The parameter names match the existing Next.js export route convention exactly.

| Query param | Type | Maps to `AnalyticsFilter` field |
|---|---|---|
| `from` | `YYYY-MM-DD` (required) | `date_from` |
| `to` | `YYYY-MM-DD` (required) | `date_to` |
| `hotelIds` | comma-separated UUIDs | `hotel_ids` |
| `regionIds` | comma-separated UUIDs | `region_ids` |
| `productIds` | comma-separated UUIDs | `product_ids` |
| `hotelGroupIds` | comma-separated UUIDs | `hotel_group_ids` |
| `locationGroupIds` | comma-separated UUIDs | `location_group_ids` |
| `maturityBuckets` | comma-separated (`0-1mo,1-3mo,3-6mo,6-9mo,9-12mo,12mo+`) | `maturity_buckets` |
| `locationTypes` | comma-separated (`hotel,retail_desk,online,airport,hex_kiosk,internal`) | `location_types` |
| `metricMode` | `sales` \| `revenue` (default `sales`) | `metric_mode` |
| `includeInternal` | `true` \| `false` (default `false`) | `include_internal_accounts` |

Additional params where noted per-endpoint:

| Query param | Type | Used by |
|---|---|---|
| `comparison` | `none` \| `mom` \| `yoy` | Summary / list endpoints |
| `granularity` | `daily` \| `weekly` \| `monthly` \| `hourly` | Trend endpoints |
| `pageSize` | integer (default 50, max 500) | Paginated list endpoints |
| `pageToken` | opaque string | Paginated list endpoints (cursor from prior response) |

### 12.2 Auth

Every request requires a valid session. The gateway accepts either:
- `Authorization: Bearer <jwt>` header
- `Cookie: session=<session-token>` (for browser clients carrying the Better Auth cookie)

Unauthenticated requests → `401`. Authorised but insufficient scope → `403`.

---

### 12.3 Portfolio endpoints

```
GET /api/v1/command-centre/analytics/portfolio/summary
    ?from=&to=&[common filters]&comparison=yoy
    → PortfolioSummaryResponse
    gRPC: AnalyticsService.GetPortfolioSummary

GET /api/v1/command-centre/analytics/portfolio/categories
    ?from=&to=&[common filters]
    → PortfolioCategoriesResponse
    gRPC: AnalyticsService.GetPortfolioCategories

GET /api/v1/command-centre/analytics/portfolio/products
    ?from=&to=&[common filters]&pageSize=&pageToken=
    → PortfolioProductsResponse
    gRPC: AnalyticsService.GetPortfolioProducts

GET /api/v1/command-centre/analytics/portfolio/trend
    ?from=&to=&[common filters]&granularity=daily
    → PortfolioTrendResponse
    gRPC: AnalyticsService.GetPortfolioTrend

GET /api/v1/command-centre/analytics/portfolio/outlet-tiers
    ?from=&to=&[common filters]
    → PortfolioOutletTiersResponse
    gRPC: AnalyticsService.GetPortfolioOutletTiers

GET /api/v1/command-centre/analytics/portfolio/high-performers
    ?from=&to=&[common filters]
    → HighPerformerAnalysisResponse
    gRPC: AnalyticsService.GetHighPerformerAnalysis
```

**HTTP status codes (all analytics GET endpoints):**

| Status | Condition |
|---|---|
| `200` | Success |
| `400` | Missing required `from`/`to`, invalid date format, unrecognised enum value |
| `401` | No valid session |
| `403` | User lacks scope to see the requested data |
| `500` | Upstream query failure |

---

### 12.4 Heat Map endpoint

```
GET /api/v1/command-centre/analytics/heat-map
    ?from=&to=&[common filters]
    &scope=all|top10|bottom10      (default: all)
    &wRevenue=0.30                 (optional weight overrides, must sum to 1.0)
    &wTransactions=0.20
    &wRevPerRoom=0.25
    &wTxnPerKiosk=0.15
    &wBasket=0.10
    → HeatMapResponse
    gRPC: AnalyticsService.GetHeatMap
```

---

### 12.5 Trend Builder endpoint

**POST** — the request body carries per-series filter config which is too complex for query params.

```
POST /api/v1/command-centre/analytics/trend-series
Content-Type: application/json

{
  "globalFilter": {
    "from": "2026-01-01",
    "to":   "2026-05-25",
    "metricMode": "sales"
    // + any common filter fields
  },
  "series": [
    {
      "name": "UK Hotels",
      "metric": "revenue",           // revenue|transactions|avg_basket_value|booking_fee
      "filter": {                    // overrides / narrows globalFilter per series
        "regionIds": ["uuid-uk"],
        "locationTypes": ["hotel"]
      },
      "includeYoy": false
    },
    {
      "name": "EU Hotels",
      "metric": "revenue",
      "filter": { "regionIds": ["uuid-eu"] },
      "includeYoy": true
    }
  ],
  "granularity": "daily",            // daily|weekly|monthly|hourly
  "includeBusinessEvents": true,
  "eventCategoryIds": ["uuid-cat1"]
}

→ TrendSeriesResponse
gRPC: AnalyticsService.GetTrendSeries
```

**HTTP status:** `400` if any series has missing `metric` or `name`; `400` if `granularity` is `hourly` with a date range > 7 days (too many data points).

---

### 12.6 Hotel Groups endpoints

```
GET /api/v1/command-centre/analytics/hotel-groups
    ?from=&to=&[common filters]&comparison=mom&pageSize=&pageToken=
    → ListHotelGroupsResponse
    gRPC: AnalyticsService.ListHotelGroups

GET /api/v1/command-centre/analytics/hotel-groups/{hotelGroupId}
    ?from=&to=&[common filters]
    → HotelGroupDetailResponse
    gRPC: AnalyticsService.GetHotelGroupDetail
```

---

### 12.7 Regions endpoints

```
GET /api/v1/command-centre/analytics/regions
    ?from=&to=&[common filters]&comparison=yoy
    → ListRegionsResponse
    gRPC: AnalyticsService.ListRegions

GET /api/v1/command-centre/analytics/regions/{regionId}
    ?from=&to=&[common filters]
    → RegionDetailResponse
    gRPC: AnalyticsService.GetRegionDetail
```

---

### 12.8 Location Groups endpoints

```
GET /api/v1/command-centre/analytics/location-groups
    ?from=&to=&[common filters]&comparison=mom&pageSize=&pageToken=
    → ListLocationGroupsResponse
    gRPC: AnalyticsService.ListLocationGroups

GET /api/v1/command-centre/analytics/location-groups/{locationGroupId}
    ?from=&to=&[common filters]
    → LocationGroupDetailResponse
    gRPC: AnalyticsService.GetLocationGroupDetail
```

---

### 12.9 Compare endpoint

```
GET /api/v1/command-centre/analytics/compare
    ?from=&to=&[common filters]
    &dimension=location|hotel_group|region|location_group|product
    &entityIds=uuid1,uuid2,uuid3    (2–N entity IDs of the same dimension)
    → ComparisonResponse
    gRPC: AnalyticsService.GetComparison

HTTP 400 if: fewer than 2 entityIds, or dimension is missing.
```

---

### 12.10 Experiments endpoint

```
GET /api/v1/command-centre/analytics/experiments/{cohortId}
    ?from=&to=&[common filters]&includeYoy=true
    → ExperimentResponse
    gRPC: AnalyticsService.GetExperimentMetrics

HTTP 404 if cohortId does not exist or is not visible to the caller.
```

---

### 12.11 Maturity Analysis endpoints

```
GET /api/v1/command-centre/analytics/maturity/buckets
    ?from=&to=&[common filters]
    → MaturityBucketsResponse
    gRPC: AnalyticsService.GetMaturityBuckets

GET /api/v1/command-centre/analytics/maturity/ramp-curve
    ?from=&to=&[common filters]
    → MaturityRampCurveResponse
    gRPC: AnalyticsService.GetMaturityRampCurve

GET /api/v1/command-centre/analytics/maturity/install-cohorts
    ?from=&to=&[common filters]
    → InstallCohortsResponse
    gRPC: AnalyticsService.GetInstallCohorts
```

---

### 12.12 Pivot Table endpoint

**POST** — row/column/value configuration is multi-field and not suited to query params.

```
POST /api/v1/command-centre/analytics/pivot
Content-Type: application/json

{
  "filter": {
    "from": "2026-01-01",
    "to":   "2026-05-25"
    // + any common filter fields
  },
  "rowField":    "location",          // location|hotel_group|region|product|location_group|provider|date_month|date_week
  "columnField": "product",
  "valueMetric": "revenue",           // revenue|transactions|avg_basket
  "aggregation": "sum",               // sum|avg|count|min|max
  "pageSize": 50,
  "pageToken": ""
}

→ PivotTableResponse
gRPC: AnalyticsService.GetPivotTable

HTTP 400 if rowField == columnField, or aggregation is avg/min/max on transactions.
```

---

### 12.13 Commission endpoints

```
GET /api/v1/command-centre/analytics/commission/summary
    ?from=&to=&[common filters]
    → CommissionSummaryResponse
    gRPC: CommissionService.GetCommissionSummary

GET /api/v1/command-centre/analytics/commission/trend
    ?from=&to=&[common filters]
    → CommissionTrendResponse
    gRPC: CommissionService.GetCommissionTrend

POST /api/v1/command-centre/analytics/commission/recalculate
Content-Type: application/json
Body: { "locationProductId": "uuid", "month": "2026-04" }
→ RecalculateCommissionsResponse
gRPC: CommissionService.RecalculateCommissions

Requires: admin role. HTTP 403 for non-admin callers.
```

---

### 12.14 Flags and Action Items endpoints

```
GET  /api/v1/command-centre/flags
     ?types=relocate,monitor,strategic_exception
     &statuses=active,resolved
     &locationIds=uuid1,uuid2
     &pageSize=&pageToken=
     → ListFlagsResponse
     gRPC: FlagsService.ListFlags

POST /api/v1/command-centre/flags
     Body: { "locationId": "uuid", "type": "monitor", "reason": "..." }
     → Flag
     gRPC: FlagsService.CreateFlag

PATCH /api/v1/command-centre/flags/{flagId}
      Body: { "status": "resolved", "reason": "..." }
      → Flag
      gRPC: FlagsService.UpdateFlag

GET  /api/v1/command-centre/action-items
     ?flagId=uuid                   (optional — omit for all action items)
     &statuses=open,in_progress
     &types=investigation,relocation,training,equipment
     &pageSize=&pageToken=
     → ListActionItemsResponse
     gRPC: FlagsService.ListActionItems

POST /api/v1/command-centre/action-items
     Body: { "flagId": "uuid", "type": "training", "description": "...", "assigneeId": "uuid", "dueDate": "2026-06-01" }
     → ActionItem
     gRPC: FlagsService.CreateActionItem

PATCH /api/v1/command-centre/action-items/{actionItemId}
      Body: { "status": "resolved", "description": "...", "assigneeId": "uuid", "dueDate": "2026-06-01" }
      → ActionItem
      gRPC: FlagsService.UpdateActionItem
```

---

### 12.15 Export endpoints

The gateway streams the gRPC byte chunks directly to the HTTP response body — no buffering.

```
GET /api/v1/command-centre/export
    ?tab=portfolio|heat-map|hotel-groups|regions|location-groups
    &format=csv|excel                (default: csv)
    &from=&to=&[common filters]
    → streaming file download

Response headers set by gateway from first ExportChunk:
    Content-Type:        text/csv; charset=utf-8
                         application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
    Content-Disposition: attachment; filename="analytics-{tab}-{from}-{to}.csv"

gRPC: ExportService.ExportAnalytics (server-streaming)

HTTP 400 if tab is missing or unrecognised.
HTTP 400 if format is unrecognised.
```

> **Note:** The existing Next.js routes are `GET /api/export/csv` and `GET /api/export/excel` as separate endpoints. The Spring Boot version collapses these into one endpoint with a `format` param — simpler to maintain. The api-gateway controller must handle the streaming response (do not materialise the full file in memory).

---

### 12.16 Dimension (filter loader) endpoints

Used to populate the filter dropdowns on every analytics page. Results are RBAC-scoped — an external user only sees locations they have access to.

```
GET /api/v1/command-centre/dimensions/locations
    ?q=search_term&limit=100
    → LocationListResponse
    gRPC: DimensionService.ListLocations

GET /api/v1/command-centre/dimensions/regions
    ?q=&limit=100
    → RegionListResponse
    gRPC: DimensionService.ListRegions

GET /api/v1/command-centre/dimensions/hotel-groups
    ?q=&limit=100
    → HotelGroupListResponse
    gRPC: DimensionService.ListHotelGroups

GET /api/v1/command-centre/dimensions/location-groups
    ?q=&limit=100
    → LocationGroupListResponse
    gRPC: DimensionService.ListLocationGroups

GET /api/v1/command-centre/dimensions/products
    ?q=&limit=100
    → ProductListResponse
    gRPC: DimensionService.ListProducts

GET /api/v1/command-centre/dimensions/providers
    ?q=&limit=100
    → ProviderListResponse
    gRPC: DimensionService.ListProviders
```

---

### 12.17 ETL admin endpoints

All require `admin` role. Return `403` for non-admin callers.

```
POST /api/v1/command-centre/etl/azure/trigger
     Body: {} (empty)
     → TriggerEtlResponse  { status, processedBlobs, skippedBlobs, failedBlobs }
     gRPC: EtlService.TriggerAzureEtl

     HTTP 409 if advisory lock already held (another run in progress).
     HTTP 503 if ETL_AZURE_ENABLED is false on the service.

GET  /api/v1/command-centre/etl/blob-ingestions
     ?regionId=uuid&status=success|failed|&pageSize=&pageToken=
     → ListBlobIngestionsResponse
     gRPC: EtlService.ListBlobIngestions

GET  /api/v1/command-centre/etl/sales-imports
     ?regionId=uuid&status=staging|committed|failed|&pageSize=&pageToken=
     → ListSalesImportsResponse
     gRPC: EtlService.ListSalesImports
```

---

### 12.18 Complete endpoint inventory

| Method | Path | gRPC | Auth |
|---|---|---|---|
| GET | `/analytics/portfolio/summary` | `AnalyticsService.GetPortfolioSummary` | any |
| GET | `/analytics/portfolio/categories` | `AnalyticsService.GetPortfolioCategories` | any |
| GET | `/analytics/portfolio/products` | `AnalyticsService.GetPortfolioProducts` | any |
| GET | `/analytics/portfolio/trend` | `AnalyticsService.GetPortfolioTrend` | any |
| GET | `/analytics/portfolio/outlet-tiers` | `AnalyticsService.GetPortfolioOutletTiers` | any |
| GET | `/analytics/portfolio/high-performers` | `AnalyticsService.GetHighPerformerAnalysis` | any |
| GET | `/analytics/heat-map` | `AnalyticsService.GetHeatMap` | any |
| POST | `/analytics/trend-series` | `AnalyticsService.GetTrendSeries` | any |
| GET | `/analytics/hotel-groups` | `AnalyticsService.ListHotelGroups` | any |
| GET | `/analytics/hotel-groups/{id}` | `AnalyticsService.GetHotelGroupDetail` | any |
| GET | `/analytics/regions` | `AnalyticsService.ListRegions` | any |
| GET | `/analytics/regions/{id}` | `AnalyticsService.GetRegionDetail` | any |
| GET | `/analytics/location-groups` | `AnalyticsService.ListLocationGroups` | any |
| GET | `/analytics/location-groups/{id}` | `AnalyticsService.GetLocationGroupDetail` | any |
| GET | `/analytics/compare` | `AnalyticsService.GetComparison` | any |
| GET | `/analytics/experiments/{cohortId}` | `AnalyticsService.GetExperimentMetrics` | any |
| GET | `/analytics/maturity/buckets` | `AnalyticsService.GetMaturityBuckets` | any |
| GET | `/analytics/maturity/ramp-curve` | `AnalyticsService.GetMaturityRampCurve` | any |
| GET | `/analytics/maturity/install-cohorts` | `AnalyticsService.GetInstallCohorts` | any |
| POST | `/analytics/pivot` | `AnalyticsService.GetPivotTable` | any |
| GET | `/analytics/commission/summary` | `CommissionService.GetCommissionSummary` | any |
| GET | `/analytics/commission/trend` | `CommissionService.GetCommissionTrend` | any |
| POST | `/analytics/commission/recalculate` | `CommissionService.RecalculateCommissions` | admin |
| GET | `/flags` | `FlagsService.ListFlags` | any |
| POST | `/flags` | `FlagsService.CreateFlag` | any |
| PATCH | `/flags/{id}` | `FlagsService.UpdateFlag` | any |
| GET | `/action-items` | `FlagsService.ListActionItems` | any |
| POST | `/action-items` | `FlagsService.CreateActionItem` | any |
| PATCH | `/action-items/{id}` | `FlagsService.UpdateActionItem` | any |
| GET | `/export` | `ExportService.ExportAnalytics` | any |
| GET | `/dimensions/locations` | `DimensionService.ListLocations` | any |
| GET | `/dimensions/regions` | `DimensionService.ListRegions` | any |
| GET | `/dimensions/hotel-groups` | `DimensionService.ListHotelGroups` | any |
| GET | `/dimensions/location-groups` | `DimensionService.ListLocationGroups` | any |
| GET | `/dimensions/products` | `DimensionService.ListProducts` | any |
| GET | `/dimensions/providers` | `DimensionService.ListProviders` | any |
| POST | `/etl/azure/trigger` | `EtlService.TriggerAzureEtl` | admin |
| GET | `/etl/blob-ingestions` | `EtlService.ListBlobIngestions` | admin |
| GET | `/etl/sales-imports` | `EtlService.ListSalesImports` | admin |

All paths are prefixed `/api/v1/command-centre`. **Total: 39 REST endpoints → 40 gRPC RPCs** (export collapses two Next.js routes into one).
