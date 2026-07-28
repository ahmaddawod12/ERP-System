import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../migrations/0000_control_baseline.sql", import.meta.url);
const migration = await readFile(migrationUrl, "utf8");

test("control baseline keeps tenant data out and exposes only routing functions", () => {
  for (const required of [
    "CREATE TABLE control.shards",
    "CREATE TABLE control.identities",
    "CREATE TABLE control.companies",
    "CREATE TABLE control.memberships",
    "CREATE TABLE control.provisioning_operations",
    "private.resolve_company_route",
    "private.list_user_workspace_routes",
    "smart_job_control_api",
  ]) {
    assert.match(migration, new RegExp(required.replaceAll(".", "\\.")));
  }

  for (const tenantTable of [
    "jobs",
    "clients",
    "documents",
    "inventory_parts",
    "inventory_movements",
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`CREATE TABLE (?:control\\.)?${tenantTable}\\b`, "i"),
    );
  }
});

test("runtime role receives no direct control-table privileges", () => {
  assert.match(migration, /REVOKE ALL ON ALL TABLES IN SCHEMA control FROM PUBLIC/i);
  assert.doesNotMatch(
    migration,
    /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]{0,100}TO smart_job_control_api/i,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION private\.resolve_company_route\(bigint, uuid\)[\s\S]+TO smart_job_control_api/i,
  );
});

test("connection secrets are referenced, never stored as URLs", () => {
  assert.match(migration, /secret_resource text NOT NULL UNIQUE/);
  assert.doesNotMatch(migration, /database_url|connection_string|password text/i);
});
