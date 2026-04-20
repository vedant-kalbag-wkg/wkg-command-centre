/**
 * One-off: reset an existing user's credential-provider password.
 * Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx scripts/reset-admin-password.ts
 *
 * NOT a normal dev-flow script — only used when we need to rotate a password
 * for an account we know exists but don't have credentials for (e.g. restoring
 * access to a prod admin). Logs to stdout and exits.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { user, account } from "@/db/schema";
import { auth } from "@/lib/auth";

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD env vars are required");
  }

  const [u] = await db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (!u) throw new Error(`User not found: ${email}`);

  // better-auth exposes its hasher on the internal context
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);

  const res = await db
    .update(account)
    .set({ password: hash, updatedAt: new Date() })
    .where(and(eq(account.userId, u.id), eq(account.providerId, "credential")))
    .returning({ id: account.id });

  if (res.length === 0) {
    throw new Error(
      `User ${email} has no credential account — cannot set password via this flow`,
    );
  }

  console.log(
    `Password reset for ${u.email} (role=${u.role ?? "?"}, userId=${u.id}, accountId=${res[0].id})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
