-- Rename is_booking_fee → is_weknow_fee per audit decision D10 (tasks/todo.md).
--
-- The flag was originally introduced for NetSuite code 9991 (Booking Fee) only,
-- but D1 + D10 establish that "WKG-collected fee" is the real semantic — it
-- spans 9991 (Booking Fee) AND 9992 (Cash Handling Fee). The rename makes the
-- column name match the intent and lets buildIsFeeCondition()/buildNonFeeCondition()
-- collapse to a single-column predicate (no more OR-with-netsuite_code).
--
-- The backfill catches rows that imported under the old parser logic
-- (productName=='Booking Fee' equality) — historically ~2,040 Cash Handling Fee
-- rows (NetSuite 9992) sit at is_weknow_fee=false and need flipping.

ALTER TABLE "sales_records"
  RENAME COLUMN "is_booking_fee" TO "is_weknow_fee";
--> statement-breakpoint

UPDATE "sales_records"
  SET "is_weknow_fee" = true
  WHERE "netsuite_code" IN ('9991', '9992')
    AND "is_weknow_fee" = false;
