import { auth } from "@/lib/auth";

async function seed() {
  const email = process.env.ADMIN_EMAIL ?? "admin@weknow.co";
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_PASSWORD env var is required. Set it before running seed.");
  }
  const name = process.env.ADMIN_NAME ?? "Admin User";

  const result = await auth.api.createUser({
    body: { email, password, name, role: "admin" },
  });
  console.log("Seed admin created:", result.user.email);
}

seed().catch(console.error);
