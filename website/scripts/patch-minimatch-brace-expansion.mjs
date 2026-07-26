import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const minimatchRoot = resolve(websiteRoot, "node_modules", "minimatch");
const minimatchPackage = JSON.parse(
  readFileSync(resolve(minimatchRoot, "package.json"), "utf8"),
);
const requireFromMinimatch = createRequire(resolve(minimatchRoot, "minimatch.js"));
const bracePackage = JSON.parse(
  readFileSync(requireFromMinimatch.resolve("brace-expansion/package.json"), "utf8"),
);

if (minimatchPackage.version !== "3.1.5" || bracePackage.version !== "5.0.8") {
  throw new Error(
    `Unexpected lint compatibility graph: minimatch ${minimatchPackage.version}, `
      + `brace-expansion ${bracePackage.version}`,
  );
}

const sourcePath = resolve(minimatchRoot, "minimatch.js");
const source = readFileSync(sourcePath, "utf8");
const original = "var expand = require('brace-expansion')";
const replacement = [
  "var braceExpansion = require('brace-expansion')",
  "var expand = typeof braceExpansion === 'function' ? braceExpansion : braceExpansion.expand",
].join("\n");

if (source.includes(replacement)) {
  process.stdout.write("minimatch brace-expansion compatibility patch already applied.\n");
} else {
  const occurrences = source.split(original).length - 1;
  if (occurrences !== 1) {
    throw new Error("The expected minimatch compatibility site was not found exactly once");
  }
  writeFileSync(sourcePath, source.replace(original, replacement), "utf8");
  process.stdout.write("Applied the audited minimatch brace-expansion compatibility patch.\n");
}
