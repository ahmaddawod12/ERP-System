import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("the stable package entry point retains its reviewed runtime exports", async () => {
  const packageRoot = path.resolve(process.cwd());
  const expected = JSON.parse(
    fs.readFileSync(
      path.join(packageRoot, "tests", "export-surface.fixture.json"),
      "utf8",
    ),
  ) as string[];
  const module = await import(
    pathToFileURL(path.join(packageRoot, "dist", "index.js")).href
  );

  assert.deepEqual(Object.keys(module).sort(), expected);
});

test("contracts are grouped behind domain entry modules", () => {
  const sourceRoot = path.resolve(process.cwd(), "src");
  const index = fs.readFileSync(path.join(sourceRoot, "index.ts"), "utf8");

  for (const domain of [
    "common",
    "auth-workspaces",
    "jobs",
    "clients",
    "inventory",
    "workers-invitations",
    "documents-tax",
    "archives",
    "support-upgrades",
    "push",
  ]) {
    assert.ok(index.includes(`export * from './${domain}.js';`));
    assert.ok(fs.existsSync(path.join(sourceRoot, `${domain}.ts`)));
  }
});
