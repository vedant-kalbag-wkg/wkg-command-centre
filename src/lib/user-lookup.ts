import { db } from "@/db";
import { user } from "@/db/schema";
import { sql, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import crypto from "crypto";

/**
 * Resolve a POC name to a system user ID.
 * Matches by case-insensitive name. If no match, auto-creates a user.
 */
export async function resolveOrCreateUserByName(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("POC name is empty");

  // Case-insensitive name match
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`LOWER(${user.name}) = LOWER(${trimmed})`)
    .limit(1);

  if (existing) return existing.id;

  // Auto-create user with placeholder email
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const shortId = crypto.randomUUID().slice(0, 8);
  const placeholderEmail = `poc-${slug}-${shortId}@placeholder.local`;

  const created = await auth.api.createUser({
    body: {
      name: trimmed,
      email: placeholderEmail,
      password: crypto.randomUUID(),
      role: "user", // Better Auth only accepts "user" | "admin" at creation
    },
  });

  // Set role to "member" via direct DB update (setRole requires request headers)
  const userId = created.user.id;
  await db.update(user).set({ role: "member" }).where(eq(user.id, userId));

  return userId;
}
