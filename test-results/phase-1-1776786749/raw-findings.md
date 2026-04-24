# Phase 1 — Raw Findings

| key | value |
| --- | --- |
| target | https://wkg-command-centre-f8zfqtl8d-vedant-kalbag-wkgs-projects.vercel.app |
| iterations | 5 |
| timestamp | 2026-04-21T16:01:02.939Z |
| snapshot rows captured | 25 |

## Top 10 by impact (mean_exec_time × calls)

| # | queryid | calls | mean_ms | total_ms | impact | rows | query |
| - | ------- | ----- | ------- | -------- | ------ | ---- | ----- |
| 1 | [-2962781315713665215](./explain--2962781315713665215.txt) | 5 | 51.75 | 258.77 | 258.77 | 360 | WITH loc_agg AS ( SELECT "sales_records"."location_id" AS location_id, COALESCE(SUM("sales_records"… |
| 2 | [9097245178603701535](./explain-9097245178603701535.txt) | 1007 | 0.12 | 121.32 | 121.32 | 4198 | SELECT state, pg_catalog.to_char(state_change, $1::pg_catalog.text) AS state_change FROM pg_stat_ac… |
| 3 | [5625563864176894035](./explain-5625563864176894035.txt) | 59 | 1.74 | 102.45 | 102.45 | 59 | -- We export stats for 10 non-system databases. Without this limit it is too -- easy to abuse the s… |
| 4 | [-38285319880090563](./explain--38285319880090563.txt) | 59 | 1.66 | 98.16 | 98.16 | 59 | SELECT pg_database_size(datname) AS db_size, datid FROM pg_stat_database WHERE datname IN ( SELECT … |
| 5 | [7589785149105743262](./explain-7589785149105743262.txt) | 57 | 1.64 | 93.39 | 93.39 | 28774 | select "kiosks"."id", "kiosks"."kiosk_id", "kiosks"."outlet_code", "kiosks"."hardware_serial_number… |
| 6 | [2416558306535109381](./explain-2416558306535109381.txt) | 3986 | 0.02 | 88.39 | 88.39 | 3986 | select "id", "expires_at", "token", "created_at", "updated_at", "ip_address", "user_agent", "user_i… |
| 7 | [-2734344730570548385](./explain--2734344730570548385.txt) | 4015 | 0.02 | 87.71 | 87.71 | 4015 | select "id", "name", "email", "email_verified", "image", "created_at", "updated_at", "role", "banne… |
| 8 | [4033131363921143169](./explain-4033131363921143169.txt) | 1007 | 0.09 | 87.53 | 87.53 | 1007 | select count(*) from pg_stat_replication where application_name != $1 |
| 9 | [517372453386758448](./explain-517372453386758448.txt) | 1007 | 0.08 | 76.33 | 76.33 | 1007 | select count(*) from pg_stat_activity where backend_type = $1 |
| 10 | [-5070390565979994163](./explain--5070390565979994163.txt) | 33 | 1.60 | 52.87 | 52.87 | 1980 | -- NOTE: This is the "internal" / "machine-readable" version. This outputs the -- working set size … |
