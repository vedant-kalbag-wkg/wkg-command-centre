// Phase 7 UAT push config — sources DATABASE_URL from .env.uat instead of
// .env.local so drizzle-kit push lands on the Neon UAT branch, not prod.
// Delete this file once Phase 7 ships.
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.uat" });

const dbUrl = (process.env.DATABASE_URL ?? "").replace(
  /([?&])sslmode=(require|prefer|verify-ca)(\b)/,
  "$1sslmode=verify-full$3",
);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: dbUrl },
});
