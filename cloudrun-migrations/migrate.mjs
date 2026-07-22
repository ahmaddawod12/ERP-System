import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const connectionString = String(process.env.DATABASE_URL || "").trim();
if (!connectionString) throw new Error("DATABASE_URL is required");

const sslMode = String(process.env.DATABASE_SSL_MODE || "require").trim().toLowerCase();
if (!new Set(["disable", "require"]).has(sslMode)) {
  throw new Error("DATABASE_SSL_MODE must be disable or require");
}

const rejectUnauthorized = String(
  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || "true",
).trim().toLowerCase() !== "false";
const ca = String(process.env.DATABASE_SSL_CA || "").trim().replaceAll("\\n", "\n");
const configuredMax = Number(process.env.DATABASE_MAX_CONNECTIONS || 2);
const max = Number.isInteger(configuredMax) && configuredMax >= 1 && configuredMax <= 5
  ? configuredMax
  : 2;

const pool = new pg.Pool({
  connectionString,
  max,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  ssl: sslMode === "disable"
    ? false
    : {
        rejectUnauthorized,
        ...(ca ? { ca } : {}),
      },
});

try {
  const database = drizzle(pool);
  const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));
  await migrate(database, { migrationsFolder });
  process.stdout.write("Database migrations completed successfully.\n");
} finally {
  await pool.end();
}
