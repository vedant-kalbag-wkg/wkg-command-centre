-- Phase 6 Plan 06-01 (D8 multi-POS site merge) — `merge_proposals` table.
--
-- Persists per-cluster admin decisions made via the
-- `/settings/duplicates/merge-review` UI before the destructive merge runs.
-- The CSV proposal at `tasks/analytics-audit/multi-pos-merge-proposal.csv`
-- enumerates 22 clusters / 29 defunct rows; this table is the source of
-- truth once an admin has reviewed each cluster.
--
-- Decision values:
--   'approved'    — merge defunct → canonical (rewrite FKs, archive defunct)
--   'swapped'     — invert canonical/defunct, then proceed as 'approved'
--   'rejected'    — leave both rows in place; this is not actually a duplicate
--   'address_fix' — neither row is a duplicate; the address on one is wrong
--                   (Phase 5.7 ride-along — `notes` documents the fix)
--
-- `applied_at` is NULL until the bulk-merge primitive (`scripts/multi-pos-merge.ts`)
-- successfully runs against this row; setting it provides idempotency on re-run.
--
-- The (canonical_id, defunct_id) UNIQUE constraint makes save-decision an upsert.
-- Cluster_id is informational only — the canonical pair identifies the row.

CREATE TABLE "merge_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" integer NOT NULL,
	"canonical_id" uuid NOT NULL,
	"defunct_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"notes" text,
	"decided_by" text NOT NULL,
	"decided_by_name" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "merge_proposals_pair_unique" UNIQUE("canonical_id","defunct_id"),
	CONSTRAINT "merge_proposals_decision_check" CHECK ("decision" IN ('approved','swapped','rejected','address_fix'))
);
--> statement-breakpoint

ALTER TABLE "merge_proposals"
	ADD CONSTRAINT "merge_proposals_canonical_id_locations_id_fk"
	FOREIGN KEY ("canonical_id") REFERENCES "locations"("id")
	ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "merge_proposals"
	ADD CONSTRAINT "merge_proposals_defunct_id_locations_id_fk"
	FOREIGN KEY ("defunct_id") REFERENCES "locations"("id")
	ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE INDEX "merge_proposals_cluster_idx" ON "merge_proposals" ("cluster_id");
--> statement-breakpoint

CREATE INDEX "merge_proposals_applied_idx" ON "merge_proposals" ("applied_at");
