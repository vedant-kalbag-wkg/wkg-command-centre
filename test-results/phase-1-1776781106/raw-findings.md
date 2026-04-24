# Phase 1 — Raw Findings

| key | value |
| --- | --- |
| target | https://wkg-command-centre-eqar2y046-vedant-kalbag-wkgs-projects.vercel.app |
| iterations | 5 |
| timestamp | 2026-04-21T14:26:42.286Z |
| snapshot rows captured | 25 |

## Top 10 by impact (mean_exec_time × calls)

| # | queryid | calls | mean_ms | total_ms | impact | rows | query |
| - | ------- | ----- | ------- | -------- | ------ | ---- | ----- |
| 1 | [2876412854933992484](./explain-2876412854933992484.txt) | 10 | 147.07 | 1470.66 | 1470.66 | 10 | SELECT COALESCE(SUM("sales_records"."gross_amount"), $4) AS total_revenue, COUNT(*)::text AS total_… |
| 2 | [883656055125514950](./explain-883656055125514950.txt) | 5 | 217.46 | 1087.32 | 1087.32 | 65 | SELECT "products"."name" AS category_name, COALESCE(SUM("sales_records"."gross_amount"), $4) AS rev… |
| 3 | [-7832206712676690579](./explain--7832206712676690579.txt) | 5 | 200.06 | 1000.29 | 1000.29 | 65 | SELECT "products"."name" AS product_name, COALESCE(SUM("sales_records"."gross_amount"), $5) AS reve… |
| 4 | [-296059890286988519](./explain--296059890286988519.txt) | 5 | 175.94 | 879.70 | 879.70 | 1825 | SELECT "sales_records"."transaction_date"::text AS date, COALESCE(SUM("sales_records"."gross_amount… |
| 5 | [2494768760741788218](./explain-2494768760741788218.txt) | 5 | 125.06 | 625.32 | 625.32 | 1000 | SELECT "locations"."id" AS location_id, COALESCE("locations"."outlet_code", $4) AS outlet_code, "lo… |
| 6 | [-6188082297284223554](./explain--6188082297284223554.txt) | 10 | 58.50 | 585.00 | 585.00 | 2430 | SELECT "sales_records"."location_id" AS location_id, "locations"."name" AS location_name, COALESCE(… |
| 7 | [-6634863189833404805](./explain--6634863189833404805.txt) | 5 | 114.87 | 574.33 | 574.33 | 360 | SELECT "hotel_groups"."id" AS group_id, "hotel_groups"."name" AS group_name, COALESCE(SUM("sales_re… |
| 8 | [-6485876512338032616](./explain--6485876512338032616.txt) | 10 | 41.79 | 417.86 | 417.86 | 50 | SELECT "products"."name" AS name, COALESCE(SUM("sales_records"."gross_amount"), $5) AS revenue FROM… |
| 9 | [-3265543506531508125](./explain--3265543506531508125.txt) | 5 | 53.74 | 268.69 | 268.69 | 1215 | SELECT "sales_records"."location_id" AS location_id, COALESCE("locations"."outlet_code", $4) AS out… |
| 10 | [-8558234332791204324](./explain--8558234332791204324.txt) | 5 | 51.86 | 259.32 | 259.32 | 1825 | SELECT "sales_records"."transaction_date"::text AS date, COALESCE(SUM("sales_records"."gross_amount… |
