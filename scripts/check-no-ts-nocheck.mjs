import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const protectedPaths = [
  "packages/contracts",
  "website/src",
  "website/tests",
  "phone_app/components",
  "phone_app/contexts",
  "phone_app/tests",
  "phone_app/firebase.ts",
];
const monitoredModulePath = "phone_app/modules";

const extensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);
const protectedViolations = [];
const moduleNoCheckPaths = [];
const allowedModuleNoCheck = new Set([
  "phone_app/modules/settings/screens/Settings.tsx",
  "phone_app/modules/clients/screens/ClientBook.tsx",
  "phone_app/modules/support/screens/SupportChat.tsx",
  "phone_app/modules/shared/withGate.tsx",
  "phone_app/modules/workers/screens/WorkersUsers.tsx",
  "phone_app/modules/support/screens/DevInbox.tsx",
  "phone_app/modules/shared/NotAvailableScreen.tsx",
  "phone_app/modules/home/screens/WorkerHomepage.tsx",
  "phone_app/modules/workers/screens/WorkersMonitor.tsx",
  "phone_app/modules/jobs/screens/JobMonitor.tsx",
  "phone_app/modules/documents/screens/ViewDocument.tsx",
  "phone_app/modules/jobs/screens/CreateJob.tsx",
  "phone_app/modules/home/screens/UserHomepage.tsx",
  "phone_app/modules/jobs/screens/EditJob.tsx",
  "phone_app/modules/jobs/screens/ManageJobs.tsx",
  "phone_app/modules/auth/screens/Login.tsx",
  "phone_app/modules/documents/components/TaxInvoiceJobList.tsx",
  "phone_app/modules/inventory/screens/WorkerInventory.tsx",
  "phone_app/modules/home/screens/ManagerHomepage.tsx",
  "phone_app/modules/inventory/screens/UserInventory.tsx",
  "phone_app/modules/documents/screens/GeneralDocuments.tsx",
  "phone_app/modules/documents/components/TaxInvoiceFormModal.tsx",
  "phone_app/modules/home/screens/BasicHomepage.tsx",
  "phone_app/modules/inventory/screens/CompanyInventory.tsx",
  "phone_app/modules/documents/screens/GenerateTaxInvoice.tsx",
  "phone_app/modules/documents/index.ts",
  "phone_app/modules/inventory/index.ts",
  "phone_app/modules/shared/index.ts",
  "phone_app/modules/support/lib/support-message-store.ts",
]);

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
