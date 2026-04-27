-- Phase 4.10 — Cohort name uniqueness per creator.
--
-- A cohort name only needs to be unique within the namespace its owner can
-- see. listCohorts already filters by created_by for non-admins, so two
-- different users may both own a "Q1 Promo" cohort without ambiguity. The
-- failure mode this guards against is a single user creating two cohorts
-- with the same name and then having no way to tell them apart in the UI
-- selector.
--
-- The CREATE UNIQUE INDEX is idempotent (`IF NOT EXISTS`); the underlying
-- table is empty on every known environment as of 2026-04-27, so applying
-- this migration to a populated environment in the future would only fail
-- if pre-existing duplicates had snuck in — desired behaviour.

CREATE UNIQUE INDEX IF NOT EXISTS "experiment_cohorts_created_by_name_unique"
  ON "experiment_cohorts" ("created_by", "name");
