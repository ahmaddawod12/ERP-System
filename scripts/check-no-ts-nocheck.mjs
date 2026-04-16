import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const protectedPaths = [
  "functions/src",
  "functions/tests",
  "packages/contracts",
  "website/src",
  "website/tests",
  "phone_app/components",
  "phone_app/contexts",
  "phone_app/tests",
  "phone_app/firebase.ts",
];

const extensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);
const violations = [];

function walk(targetPath) {
  const fullPath = path.join(repoRoot, targetPath);
  const stats = statSync(fullPath);

  if (stats.isDirectory()) {
    for (const entry of readdirSync(fullPath, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".next")) continue;
      walk(path.join(targetPath, entry.name));
    }
    return;
  }

  if (!extensions.has(path.extname(targetPath))) {
    return;
  }

  const contents = readFileSync(fullPath, "utf8");
  const lines = contents.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes("@ts-nocheck")) {
      violations.push(`${targetPath}:${index + 1}`);
    }
  });
}

for (const targetPath of protectedPaths) {
  walk(targetPath);
}

if (violations.length > 0) {
  console.error("Found @ts-nocheck in protected paths:");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("No @ts-nocheck directives found in protected paths.");
