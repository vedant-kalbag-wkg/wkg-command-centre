/**
 * scripts/seed-test-users-direct.ts
 *
 * Temporary UAT seeding script — bypasses auth.api.signUpEmail() (blocked by
 * disableSignUp: true) and inserts directly using auth.$context.password.hash().
 * Pattern mirrors reset-admin-password.ts.
 *
 * Only for use against test/preview DBs. Safety gates same as seed-test-users.ts.
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
    throw new Error(
      `Refusing to run: DATABASE_URL contains prod hint (${PROD_HINTS.join(",")})`,
    );
  }

  const ctx = await auth.$context;

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
    // Check if user already exists
    let existing = await db
      .select()
      .from(user)
      .where(eq(user.email, f.email))
      .limit(1);

    let userId: string;

    if (existing.length === 0) {
      // Generate a random id (Better Auth uses nanoid-style text ids)
      const { nanoid } = await import("nanoid");
      userId = nanoid();
      const now = new Date();

      // Insert user row directly
      await db.insert(user).values({
        id: userId,
        email: f.email,
        name: f.name,
        emailVerified: false,
        role: f.role,
        createdAt: now,
        updatedAt: now,
      });

      // Hash password using Better Auth's internal hasher
      const hash = await ctx.password.hash(f.password);
      const accountId = nanoid();

      // Insert credential account row
      await db.insert(account).values({
        id: accountId,
        accountId: f.email,
        providerId: "credential",
        userId,
        password: hash,
        createdAt: now,
        updatedAt: now,
      });

      console.log(`Created ${f.email} (userId=${userId}, role=${f.role})`);
    } else {
      userId = existing[0].id;

      // Ensure role is correct
      await db.update(user).set({ role: f.role }).where(eq(user.id, userId));

      // Check if credential account exists
      const acct = await db
        .select()
        .from(account)
        .where(
          and(
            eq(account.userId, userId),
            eq(account.providerId, "credential"),
          ),
        )
        .limit(1);

      if (acct.length === 0) {
        // Create credential account for existing user
        const hash = await ctx.password.hash(f.password);
        const { nanoid } = await import("nanoid");
        const accountId = nanoid();
        await db.insert(account).values({
          id: accountId,
          accountId: f.email,
          providerId: "credential",
          userId,
          password: hash,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log(
          `Added credential account for existing ${f.email} (role=${f.role})`,
        );
      } else {
        // Update password to ensure it matches expected
        const hash = await ctx.password.hash(f.password);
        await db
          .update(account)
          .set({ password: hash, updatedAt: new Date() })
          .where(eq(account.id, acct[0].id));
        console.log(
          `Updated existing ${f.email} (userId=${userId}, role=${f.role})`,
        );
      }
    }
  }

  console.log("Test users seeded.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
