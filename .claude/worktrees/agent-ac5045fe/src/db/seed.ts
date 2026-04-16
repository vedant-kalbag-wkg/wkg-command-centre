import { auth } from "@/lib/auth";

async function seed() {
  // Create initial admin user for testing
  const result = await auth.api.createUser({
    body: {
      email: "admin@weknow.co",
      password: "Admin123!",
      name: "Admin User",
      role: "admin",
    },
  });
  console.log("Seed admin created:", result.user.email);
}

seed().catch(console.error);
