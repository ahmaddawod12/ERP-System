import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const protectedPaths = [
  "packages/contracts",
  "packages/api-contracts",
  "cloudrun-api/src",
  "cloudrun-tax/src",
  "cloudrun-email/src",
  "website/src",
  "website/tests",
  "phone_app/components",
  "phone_app/contexts",
  "phone_app/tests",
  "phone_app/lib",
];
const monitoredModulePath = "phone_app/modules";

const extensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);
const protectedViolations = [];
const moduleNoCheckPaths = [];
const allowedModuleNoCheck = new Set([]);

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function hasTsNoCheckDirective(line) {
  return /^\s*(?:\/\/|\/\*)\s*@ts-nocheck\b/.test(line);
}

function walk(targetPath, options = { collectProtectedViolations: false, collectModuleNoCheck: false }) {
  const fullPath = path.join(repoRoot, targetPath);
  const stats = statSync(fullPath);
  const normalizedTargetPath = normalizePath(targetPath);

  if (stats.isDirectory()) {
    for (const entry of readdirSync(fullPath, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".next")) continue;
      walk(path.join(targetPath, entry.name), options);
    }
    return;
  }

  if (!extensions.has(path.extname(normalizedTargetPath))) {
    return;
  }

  const contents = readFileSync(fullPath, "utf8");
  const lines = contents.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (hasTsNoCheckDirective(line)) {
      if (options.collectProtectedViolations) {
        protectedViolations.push(`${normalizedTargetPath}:${index + 1}`);
      }
      if (options.collectModuleNoCheck && normalizedTargetPath.startsWith("phone_app/modules/")) {
        moduleNoCheckPaths.push(normalizedTargetPath);
      }
    }
  });
}

for (const targetPath of protectedPaths) {
  walk(targetPath, { collectProtectedViolations: true, collectModuleNoCheck: false });
}

walk(monitoredModulePath, { collectProtectedViolations: false, collectModuleNoCheck: true });

if (protectedViolations.length > 0) {
  console.error("Found @ts-nocheck in protected paths:");
  protectedViolations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

const disallowedModuleNoCheck = [...new Set(moduleNoCheckPaths)]
  .filter((entry) => !allowedModuleNoCheck.has(entry))
  .sort();

if (disallowedModuleNoCheck.length > 0) {
  console.error("Found new @ts-nocheck directives under phone_app/modules:");
  disallowedModuleNoCheck.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("No @ts-nocheck directives found in protected paths.");
