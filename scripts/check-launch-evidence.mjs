#!/usr/bin/env node

import { readFileSync } from "node:fs";

const expectedSha = String(process.env.RELEASE_SHA || "").trim();
const stage = String(process.env.RELEASE_STAGE || "approved").trim();
const sourcePath = process.argv[2];
const rawEvidence = String(process.env.LAUNCH_EVIDENCE_JSON || "").trim()
  || (sourcePath ? readFileSync(sourcePath, "utf8") : "");

const shaPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const stages = new Set(["candidate", "10", "50", "100", "approved"]);
const imageNames = [
  "website",
  "api",
  "tax",
  "pdf",
  "email",
  "archiver",
  "backup",
  "migration",
];
const preReleaseGates = [
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
];
const rolloutGates = [
  "cloud_run_10",
  "cloud_run_50",
  "cloud_run_100",
  "native_10_24h",
  "native_50_48h",
  "native_100",
];

function fail(message) {
  process.stderr.write(`[launch-evidence] ${message}\n`);
  process.exitCode = 1;
}

if (!rawEvidence) {
  throw new Error("Launch evidence is required through LAUNCH_EVIDENCE_JSON or a JSON file path.");
}
if (!shaPattern.test(expectedSha)) {
  throw new Error("RELEASE_SHA must be the exact lowercase 40-character release commit.");
}
if (!stages.has(stage)) throw new Error(`Unsupported RELEASE_STAGE ${stage}.`);

let evidence;
try {
  evidence = JSON.parse(rawEvidence);
} catch {
  throw new Error("Launch evidence must be valid JSON.");
}

if (evidence.schemaVersion !== 1) fail("schemaVersion must be 1");
if (evidence.environment !== "production") fail("environment must be production");
if (evidence.releaseSha !== expectedSha) fail("releaseSha does not match the exact selected release SHA");

for (const imageName of imageNames) {
  if (!digestPattern.test(String(evidence.imageDigests?.[imageName] || ""))) {
    fail(`imageDigests.${imageName} must be an immutable sha256 digest`);
  }
}

const gates = new Map();
for (const gate of Array.isArray(evidence.gates) ? evidence.gates : []) {
  if (!gate || typeof gate.id !== "string") {
    fail("every gate must have a string id");
    continue;
  }
  if (gates.has(gate.id)) fail(`duplicate gate ${gate.id}`);
  gates.set(gate.id, gate);
}

const requiredForStage = [
  ...preReleaseGates,
  ...(stage === "50" || stage === "100" || stage === "approved" ? ["cloud_run_10"] : []),
  ...(stage === "100" || stage === "approved" ? ["cloud_run_50"] : []),
  ...(stage === "approved" ? ["cloud_run_100", "native_10_24h", "native_50_48h", "native_100"] : []),
];

for (const gateId of requiredForStage) {
  const gate = gates.get(gateId);
  if (!gate) {
    fail(`missing required gate ${gateId}`);
    continue;
  }
  if (gate.status !== "PASS") fail(`${gateId} must be PASS`);
  if (!String(gate.owner || "").trim()) fail(`${gateId} requires an owner`);
  if (!String(gate.evidence || "").trim()) fail(`${gateId} requires an evidence reference`);
  if (!Number.isFinite(Date.parse(String(gate.completedAt || "")))) {
    fail(`${gateId} requires an ISO completedAt timestamp`);
  } else {
    const completedAt = Date.parse(gate.completedAt);
    const ageMs = Date.now() - completedAt;
    if (ageMs < 0 || ageMs > 30 * 24 * 60 * 60 * 1000) {
      fail(`${gateId} evidence must be current within 30 days and not future-dated`);
    }
  }
}

const restore = gates.get("pitr_and_backup_restore")?.measurements;
const rpoMinutes = Number(restore?.rpoMinutes);
const rtoMinutes = Number(restore?.rtoMinutes);
if (
  !Number.isFinite(rpoMinutes)
  || !Number.isFinite(rtoMinutes)
  || rpoMinutes < 0
  || rtoMinutes <= 0
  || rpoMinutes > 15
  || rtoMinutes > 240
) {
  fail("restore evidence must prove RPO <= 15 minutes and RTO <= 240 minutes");
}
if (!(Number(gates.get("staging_soak")?.measurements?.days) >= 7)) {
  fail("staging_soak must record at least seven consecutive days");
}
if (gates.get("tax_disabled")?.measurements?.mode !== "disabled") {
  fail("tax_disabled must record mode=disabled");
}

const approval = evidence.approval || {};
if (!String(approval.owner || "").trim()) fail("approval requires an owner");
if (!String(approval.evidence || "").trim()) fail("approval requires an evidence reference");
if (stage === "approved") {
  if (approval.status !== "APPROVED") fail("final launch approval status must be APPROVED");
  for (const gateId of rolloutGates) {
    if (gates.get(gateId)?.status !== "PASS") fail(`${gateId} must be PASS before final approval`);
  }
} else if (approval.status !== "READY") {
  fail("deployment-stage approval status must be READY");
}

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write(
  `Production launch evidence passed for ${expectedSha} at stage ${stage} (${requiredForStage.length} gates).\n`,
);
