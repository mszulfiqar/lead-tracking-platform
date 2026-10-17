import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
}

// Reuse a single pool across Next.js development hot reloads to avoid
// exhausting PostgreSQL connections.
const globalForDb = globalThis as unknown as { __appDbPool?: Pool };

export const pool = globalForDb.__appDbPool ?? new Pool({ connectionString });
if (process.env.NODE_ENV !== "production") {
  globalForDb.__appDbPool = pool;
}

export const db = drizzle(pool, { schema });
