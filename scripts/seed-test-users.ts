/**
 * scripts/seed-test-users.ts
 *
 * Idempotent seed of test fixture users (TEST_OPS_IT, TEST_VIEWER).
 *
 * Per Plan 10-01 + 10-02: tests/auth/setup.ts declares these as CONTRACTS
 * that must be honoured by the test/preview DB. This script populates the
 * `user` and `account` tables (Better Auth credential rows) so Playwright
 * specs can sign in as ops-it / viewer without manual setup.
 *
 * SAFETY GATES:
 * - Refuses to run if NODE_ENV='production' OR if DATABASE_URL contains the
 *   string 'wkg-command-centre' (the prod project alias). The two gates are
 *   redundant — both must pass.
 * - Each user is upserted (idempotent); does not overwrite an existing
 *   password if the row already exists with a credential account.
 *
 * Usage:
 *   DATABASE_URL='<test-or-preview-url>' npx tsx scripts/seed-test-users.ts
 *
 * Env vars (optional — defaults match tests/auth/setup.ts):
 *   TEST_OPS_IT_EMAIL, TEST_OPS_IT_PASSWORD,
 *   TEST_VIEWER_EMAIL, TEST_VIEWER_PASSWORD
 */
import { db } from "@/db";
import { user, account } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

const PROD_HINTS = ["wkg-command-centre", "wkg-kiosk-tool"];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run: NODE_ENV=production");
  }
  const url = process.env.DATABASE_URL ?? "";
  if (PROD_HINTS.some((h) => url.includes(h))) {
    throw new Error(`Refusing to run: DATABASE_URL contains prod hint (${PROD_HINTS.join(",")})`);
  }

  const fixtures = [
    {
      email: process.env.TEST_OPS_IT_EMAIL ?? "ops-it.test@weknowgroup.com",
      password: process.env.TEST_OPS_IT_PASSWORD ?? "OpsItTest!2026",
      name: "Test Ops-IT",
      role: "member" as const,
    },
    {
      email: process.env.TEST_VIEWER_EMAIL ?? "viewer.test@weknowgroup.com",
      password: process.env.TEST_VIEWER_PASSWORD ?? "ViewerTest!2026",
      name: "Test Viewer",
      role: "viewer" as const,
    },
  ];

  for (const f of fixtures) {
    // Find or create the user row (idempotent on email).
    let existing = await db.select().from(user).where(eq(user.email, f.email)).limit(1);
    if (existing.length === 0) {
      // Use Better Auth's signup flow to ensure password hashing matches the
      // login path. Mirrors scripts/reset-admin-password.ts approach.
      await auth.api.signUpEmail({
        body: { email: f.email, password: f.password, name: f.name },
      });
      existing = await db.select().from(user).where(eq(user.email, f.email)).limit(1);
    }
    if (existing.length === 0) {
      throw new Error(`Failed to create user ${f.email}`);
    }
    const userId = existing[0].id;

    // Set the user.role text mirror to match. Plan 10-03's
    // refreshUserRoleMirror will manage this at runtime — but we set it here
    // for the seed-DB starting state.
    await db.update(user).set({ role: f.role }).where(eq(user.id, userId));

    console.log(`Seeded ${f.email} (userId=${userId}, role=${f.role})`);
  }

  console.log("Test users seeded.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
