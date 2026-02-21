import { initializeApp, applicationDefault, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const MAX_BATCH_SIZE = 400;

function initAdmin() {
  if (getApps().length) return getApps()[0];

  if (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) {
    const service = JSON.parse(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON);
    service.private_key = service.private_key?.replace(/\\n/g, "\n");
    return initializeApp({ credential: cert(service), projectId: service.project_id });
  }

  if (
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
    process.env.FIREBASE_ADMIN_PRIVATE_KEY
  ) {
    return initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const companyArg = argv.find((item) => item.startsWith("--company="));
  return {
    dryRun: args.has("--dry-run"),
    cleanupLegacy: args.has("--cleanup-legacy"),
    companyId: companyArg ? companyArg.split("=")[1] : "",
  };
}

function normalizeRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  if (raw === "manager") return "manager";
  if (raw === "worker") return "worker";
  if (raw === "user") return "user";
  if (raw === "basic") return "basic";
  if (raw === "dev") return "dev";
  return "";
}

function sanitizeDocId(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function maybeWorkerUid(workerDocId, data) {
  const fromFields = data?.uid || data?.Uid || data?.workerId || "";
  const candidate = String(fromFields || workerDocId || "").trim();
  return candidate || "";
}

function legacyPartDocId(part, index) {
  const explicit = sanitizeDocId(part?.partId || part?.id);
  if (explicit) return `legacy_${explicit}`;

  const nameSlug = sanitizeDocId(String(part?.name || "").toLowerCase().replace(/\s+/g, "_"));
  if (nameSlug) return `legacy_name_${nameSlug}_${index}`;

  return `legacy_part_${index}`;
}

function partNumberFromLegacy(part, index) {
  const fromPartNumber = Number(part?.partNumber || 0);
  if (Number.isFinite(fromPartNumber) && fromPartNumber > 0) return fromPartNumber;
  const fromId = Number(part?.id || 0);
  if (Number.isFinite(fromId) && fromId > 0) return fromId;
  return index + 1;
}

async function migrateCompanies(params) {
  const { db, dryRun, cleanupLegacy, companyId } = params;
  const nowIso = new Date().toISOString();
  const stats = {
    companiesVisited: 0,
    inventoryPartsWritten: 0,
    workerDocsWritten: 0,
    workerLegacyDocsDeleted: 0,
    workerProfilesWritten: 0,
    skippedWorkersMissingUid: 0,
    skippedCompaniesMissing: 0,
  };

  let batch = db.batch();
  let batchOps = 0;

  async function flushBatch() {
    if (dryRun || batchOps === 0) return;
    await batch.commit();
    batch = db.batch();
    batchOps = 0;
  }

  async function queueSet(ref, data, options) {
    if (dryRun) return;
    batch.set(ref, data, options);
    batchOps += 1;
    if (batchOps >= MAX_BATCH_SIZE) {
      await flushBatch();
    }
  }

  async function queueDelete(ref) {
    if (dryRun) return;
    batch.delete(ref);
    batchOps += 1;
    if (batchOps >= MAX_BATCH_SIZE) {
      await flushBatch();
    }
  }

  const companyRefs = companyId
    ? [db.collection("companies").doc(companyId)]
    : await db.collection("companies").listDocuments();

  for (const companyRef of companyRefs) {
    const companySnap = await companyRef.get();
    if (!companySnap.exists) {
      stats.skippedCompaniesMissing += 1;
      continue;
    }

    const company = companyRef.id;
    stats.companiesVisited += 1;

    // 1) Legacy company inventory -> canonical single-doc model (parts array).
    //    Canonical path: companies/{companyId}/business_data/inventory = { parts: [...], nextId, lastUpdated }
    //    NOTE: This script was previously writing to a subcollection model which contradicts
    //    the canonical app types. It now writes/ensures the single-doc format.
    const legacyInventoryRef = companyRef.collection("business_data").doc("inventory");
    const legacyInventorySnap = await legacyInventoryRef.get();
    const existingData = legacyInventorySnap.data() || {};
    const legacyParts = Array.isArray(existingData.parts)
      ? existingData.parts
      : [];

    if (legacyParts.length > 0) {
      // Ensure parts have proper shape (id, name, active, dateAdded)
      let maxId = 0;
      const normalizedParts = legacyParts.map((part, i) => {
        const partName = String(part.name || "").trim();
        if (!partName) return null;
        const id = typeof part.id === "number" ? part.id : i + 1;
        maxId = Math.max(maxId, id);
        return {
          id,
          name: partName,
          active: part.active !== false,
          quantity: Number(part.quantity || 0),
          lowThreshold: Number(part.lowThreshold || 0),
          dateAdded: part.dateAdded || part.createdAt || nowIso,
        };
      }).filter(Boolean);

      await queueSet(
        legacyInventoryRef,
        {
          parts: normalizedParts,
          nextId: maxId + 1,
          lastUpdated: nowIso,
        },
        { merge: false },
      );
      stats.inventoryPartsWritten += normalizedParts.length;
    }

    // 2) Worker docs -> canonical UID-keyed worker docs + user profiles.
    const workerRefs = await companyRef.collection("workers").listDocuments();
    for (const workerRef of workerRefs) {
      const workerSnap = await workerRef.get();
      if (!workerSnap.exists) continue;

      const workerData = workerSnap.data() || {};
      const workerUid = maybeWorkerUid(workerRef.id, workerData);
      if (!workerUid) {
        stats.skippedWorkersMissingUid += 1;
        continue;
      }

      const canonicalWorkerRef = companyRef.collection("workers").doc(workerUid);
      const resolvedRole = normalizeRole(workerData.role) || "worker";
      const resolvedEmail = String(workerData.email || "").trim().toLowerCase();
      const resolvedName = String(workerData.name || "").trim();
      const resolvedPhone = String(workerData.phoneNumber || "").trim();
      const resolvedWid = Number(workerData.wid ?? workerData.Wid ?? 0) || null;

      await queueSet(
        canonicalWorkerRef,
        {
          workerId: workerUid,
          uid: workerUid,
          Uid: workerUid, // legacy compatibility during rollout
          ...(resolvedWid ? { wid: resolvedWid, Wid: resolvedWid } : {}),
          role: resolvedRole,
          email: resolvedEmail || null,
          name: resolvedName || "",
          phoneNumber: resolvedPhone || "",
          createdAt: workerData.createdAt || nowIso,
          updatedAt: nowIso,
          migratedFrom: workerRef.id === workerUid ? null : workerRef.id,
        },
        { merge: true },
      );
      stats.workerDocsWritten += 1;

      const profileRef = db.collection("users").doc(workerUid).collection("data").doc("profile");
      await queueSet(
        profileRef,
        {
          uid: workerUid,
          workerId: workerUid,
          companyId: company,
          role: resolvedRole,
          accountType: "business",
          email: resolvedEmail || null,
          name: resolvedName || "",
          phoneNumber: resolvedPhone || "",
          updatedAt: nowIso,
        },
        { merge: true },
      );
      stats.workerProfilesWritten += 1;

      if (cleanupLegacy && workerRef.id !== workerUid) {
        await queueDelete(workerRef);
        stats.workerLegacyDocsDeleted += 1;
      }
    }
  }

  await flushBatch();
  return stats;
}

async function main() {
  initAdmin();
  const db = getFirestore();
  const options = parseArgs(process.argv);

  console.log("Running company schema migration...");
  console.log(
    JSON.stringify(
      {
        dryRun: options.dryRun,
        cleanupLegacy: options.cleanupLegacy,
        companyId: options.companyId || null,
      },
      null,
      2,
    ),
  );

  const stats = await migrateCompanies({
    db,
    dryRun: options.dryRun,
    cleanupLegacy: options.cleanupLegacy,
    companyId: options.companyId,
  });

  console.log("");
  console.log("Migration complete.");
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
