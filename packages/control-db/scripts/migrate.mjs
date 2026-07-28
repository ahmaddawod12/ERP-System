import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import pg from "pg";

const databaseUrl = String(process.env.CONTROL_DATABASE_URL ?? "").trim();
if (!databaseUrl) {
  throw new Error("CONTROL_DATABASE_URL is required");
}
const parsedDatabaseUrl = new URL(databaseUrl);
if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)) {
  throw new Error("CONTROL_DATABASE_URL must use PostgreSQL");
}
const sslMode = String(process.env.CONTROL_DATABASE_SSL_MODE ?? "require").trim();
if (!["disable", "require"].includes(sslMode)) {
  throw new Error("CONTROL_DATABASE_SSL_MODE must be disable or require");
}
const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
  parsedDatabaseUrl.hostname.toLowerCase(),
);
if (sslMode === "disable" && !loopback) {
  throw new Error("CONTROL_DATABASE_SSL_MODE=disable is allowed only for loopback");
}

const migrationUrl = new URL("../migrations/0000_control_baseline.sql", import.meta.url);
const migration = await readFile(migrationUrl, "utf8");
const pool = new pg.Pool({
  connectionString: databaseUrl,
  application_name: "smart-job-control-migrations",
  max: 1,
  ssl: sslMode === "require" ? { rejectUnauthorized: true } : false,
});

try {
  await pool.query(migration);
} finally {
  await pool.end();
}
