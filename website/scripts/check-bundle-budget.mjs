#!/usr/bin/env node

import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextRoot = join(websiteRoot, ".next");
const baselinePath = join(websiteRoot, "bundle-budgets.json");
const absoluteCeilingBytes = 250 * 1024;
const updateBaseline = process.argv.includes("--write-baseline");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function manifestForPage(pageKey) {
  return join(
    nextRoot,
    "server",
    "app",
    `${pageKey.replace(/^\//, "")}_client-reference-manifest.js`,
  );
}

function readClientManifest(path) {
  const source = readFileSync(path, "utf8");
  const assignment = source.indexOf(" = {", source.indexOf("__RSC_MANIFEST["));
  const terminator = source.lastIndexOf(";");
  if (assignment < 0 || terminator < assignment) {
    throw new Error(`Could not parse Next.js client manifest ${path}`);
  }
  return JSON.parse(source.slice(assignment + 3, terminator).trim());
}

function measureRoutes() {
  const routes = readJson(join(nextRoot, "app-path-routes-manifest.json"));
  const sizes = {};
  for (const [pageKey, publicRoute] of Object.entries(routes)) {
    if (!pageKey.endsWith("/page") || publicRoute.startsWith("/_")) continue;
    const manifestPath = manifestForPage(pageKey);
    if (!existsSync(manifestPath)) {
      throw new Error(`Missing client reference manifest for ${publicRoute}: ${manifestPath}`);
    }
    const manifest = readClientManifest(manifestPath);
    const chunks = new Set(Object.values(manifest.entryJSFiles || {}).flat());
    let gzipBytes = 0;
    for (const chunk of chunks) {
      const chunkPath = join(nextRoot, String(chunk).replace(/^\/?_next\//, ""));
      if (!existsSync(chunkPath)) throw new Error(`Missing client chunk ${chunkPath}`);
      gzipBytes += gzipSync(readFileSync(chunkPath)).byteLength;
    }
    sizes[publicRoute] = gzipBytes;
  }
  return Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b)));
}

if (!existsSync(join(nextRoot, "BUILD_ID"))) {
  throw new Error("Run `npm run build` before checking website bundle budgets.");
}

const measured = measureRoutes();
if (updateBaseline) {
  writeFileSync(
    baselinePath,
    `${JSON.stringify({
      schemaVersion: 1,
      units: "gzip-bytes",
      allowedRegressionPercent: 5,
      absoluteCeilingBytes,
      routes: measured,
    }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`Wrote ${Object.keys(measured).length} route baselines to ${baselinePath}\n`);
  process.exit(0);
}

const baseline = readJson(baselinePath);
const failures = [];
for (const [route, gzipBytes] of Object.entries(measured)) {
  const previous = baseline.routes?.[route];
  const relativeBudget = Number.isFinite(previous) ? Math.ceil(previous * 1.05) : absoluteCeilingBytes;
  const budget = Math.min(relativeBudget, absoluteCeilingBytes);
  const status = gzipBytes <= budget ? "PASS" : "FAIL";
  process.stdout.write(
    `${status} ${route}: ${(gzipBytes / 1024).toFixed(1)} KiB / ${(budget / 1024).toFixed(1)} KiB gzip\n`,
  );
  if (gzipBytes > budget) failures.push(`${route} is ${gzipBytes - budget} bytes over budget`);
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`[bundle-budget] ${failure}\n`);
  process.exit(1);
}
process.stdout.write(`All ${Object.keys(measured).length} website route bundle budgets passed.\n`);
