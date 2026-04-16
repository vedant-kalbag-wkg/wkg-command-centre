import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function test() {
  // Try transaction mode (port 6543)
  const url = process.env.DATABASE_URL!.replace(":5432/", ":6543/");
  console.log("Testing URL:", url.replace(/:[^:@]+@/, ":***@"));

  const sql = postgres(url, { max: 2 });
  try {
    const result = await sql`SELECT 1 as test`;
    console.log("Transaction mode works:", result);
  } catch (err) {
    console.error("Transaction mode failed:", err);
  }
  await sql.end();
}

test().catch(console.error);
