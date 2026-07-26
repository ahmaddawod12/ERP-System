import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = resolve(root, "scripts", "check-launch-evidence.mjs");
const sha = "a".repeat(40);
const gateIds = [
  "terraform",
  "dns_tls_armor",
  "egress_secrets_iam",
  "migrations_and_readiness",
  "signed_images",
  "pitr_and_backup_restore",
  "load_test",
  "staging_soak",
  "website_accessibility",
  "mobile_accessibility",
  "playwright_matrix",
  "maestro_matrix",
  "ses_delivery",
  "tax_disabled",
  "legal_privacy_retention",
  "notification_delivery",
  "cloud_run_10",
  "cloud_run_50",
  "cloud_run_100",
  "native_10_24h",
  "native_50_48h",
  "native_100",
];

function evidence() {
  const completedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    environment: "production",
    releaseSha: sha,
    imageDigests: Object.fromEntries(
      ["website", "api", "tax", "pdf", "email", "archiver", "backup", "migration"]
        .map((name) => [name, `sha256:${"b".repeat(64)}`]),
    ),
    gates: gateIds.map((id) => ({
      id,
      status: "PASS",
      owner: "release-owner",
      evidence: `change-record://${id}`,
      completedAt,
      ...(id === "pitr_and_backup_restore"
        ? { measurements: { rpoMinutes: 12, rtoMinutes: 180 } }
        : {}),
      ...(id === "staging_soak" ? { measurements: { days: 7 } } : {}),
      ...(id === "tax_disabled" ? { measurements: { mode: "disabled" } } : {}),
    })),
    approval: {
      status: "READY",
      owner: "release-approver",
      evidence: "change-record://approval",
    },
  };
}

function run(value, stage = "candidate") {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      RELEASE_SHA: sha,
      RELEASE_STAGE: stage,
      LAUNCH_EVIDENCE_JSON: JSON.stringify(value),
    },
  });
}

test("candidate launch evidence requires exact SHA, owners, digests, and recovery measurements", () => {
  const result = run(evidence());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Production launch evidence passed/);
});

test("launch evidence rejects a different release SHA and missing restore measurements", () => {
  const value = evidence();
  value.releaseSha = "c".repeat(40);
  delete value.gates.find((gate) => gate.id === "pitr_and_backup_restore").measurements;
  const result = run(value);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /releaseSha does not match/);
  assert.match(result.stderr, /restore evidence must prove/);
});

test("final approval requires completed server and native rollout gates", () => {
  const value = evidence();
  value.approval.status = "APPROVED";
  value.gates.find((gate) => gate.id === "native_100").status = "NOT_RUN";
  const result = run(value, "approved");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /native_100 must be PASS/);
});
