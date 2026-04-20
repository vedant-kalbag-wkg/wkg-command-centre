import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

// Normalize sslmode=require|prefer|verify-ca to verify-full. pg currently
// aliases these modes to verify-full, but pg v9 / pg-connection-string v3
// will adopt standard libpq semantics (weaker guarantees). Pin verify-full
// explicitly to preserve current strict behaviour and silence the migrate-
// time deprecation warning.
const dbUrl = (process.env.DATABASE_URL ?? "").replace(
  /([?&])sslmode=(require|prefer|verify-ca)(\b)/,
  "$1sslmode=verify-full$3",
);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
