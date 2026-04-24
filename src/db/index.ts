import {
  drizzle as drizzlePgJs,
  type PostgresJsDatabase,
} from "drizzle-orm/postgres-js";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import postgres from "postgres";
import * as schema from "./schema";
import { isNeonUrl } from "./is-neon-url";

type Schema = typeof schema;
// Existing call sites are written against the postgres-js Drizzle surface
// (notably `db.execute()` returning a `RowList`-like array). Both drivers
// expose the same Drizzle query/transaction API, so we annotate the unified
// `db` as `PostgresJsDatabase<Schema>` and cast the Neon branch — keeping the
// 55 import sites untouched per the Phase 0 plan.
type Db = PostgresJsDatabase<Schema>;

const connectionString = process.env.DATABASE_URL!;

function createDb(): Db {
  if (isNeonUrl(connectionString)) {
    if (typeof globalThis.WebSocket === "undefined") {
      // Node runtimes without a global WebSocket (local dev on older Node)
      // Lazy-require to avoid bundling `ws` in edge environments.
      const ws = require("ws");
      neonConfig.webSocketConstructor = ws;
    }
    const pool = new NeonPool({ connectionString });
    return drizzleNeon(pool, { schema }) as unknown as Db;
  }

  const client = postgres(connectionString, {
    max: process.env.NODE_ENV === "production" ? 10 : 2,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzlePgJs(client, { schema });
}

export const db = createDb();
