// Phase 4.10 — typed error thrown from `createCohort` in `./actions.ts`
// when the (created_by, name) UNIQUE index in migration 0035 rejects a
// duplicate. Lives in its own file because Next.js Server Action modules
// (those with `"use server"` at the top) only accept async-function
// exports — a class export trips the build with
// `Export DuplicateCohortNameError doesn't exist in target module`. Keeps
// the `instanceof` check stable for client-side `CohortForm` consumers
// and unit tests.
export class DuplicateCohortNameError extends Error {
  constructor(name: string) {
    super(`You already have a cohort named "${name}". Pick a different name.`);
    this.name = "DuplicateCohortNameError";
  }
}
