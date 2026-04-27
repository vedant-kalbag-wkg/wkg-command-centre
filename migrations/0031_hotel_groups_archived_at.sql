-- Hotel-group `archived_at` column per audit Resolved Decision D5 (tasks/todo.md),
-- PR-6 Part C.
--
-- Background: the Monday import historically created hotel_group rows whose
-- `name` is a comma-separated list of constituent groups (e.g.
-- "Marriott Group, Splendid Hospitality Group") to encode joint-venture (JV)
-- ownership. Per D5 the right model is to keep hotel_groups N:N (legitimate
-- JV cases exist) but rewrite the 34 comma-encoded JV rows into proper
-- multi-memberships and archive the redundant JV row.
--
-- This migration only adds the `archived_at` column hotel_groups currently
-- lacks. The data rewrite is performed by
-- scripts/split-jv-hotel-groups.ts (one-shot, idempotent) — kept out of the
-- migration because it depends on prod-shaped data and on auto-creating any
-- missing standalone constituent groups.

ALTER TABLE "hotel_groups" ADD COLUMN "archived_at" TIMESTAMP WITH TIME ZONE;
