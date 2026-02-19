import { initializeApp, applicationDefault, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

function isReservedTopLevelCollection(id) {
  return [
    "users",
    "companies",
    "upgrade_requests",
    "contact_requests",
    "conversations",
    "documentTasks",
    "document_tasks",
  ].includes(id);
}

async function migrateUserSubcollectionDocs(db) {
  let migrated = 0;
  const userRefs = await db.collection("users").listDocuments();

  for (const userRef of userRefs) {
    const uid = userRef.id;
    const [oldProfile, oldSubscription] = await Promise.all([
      db.collection("users").doc(uid).collection("profile").doc("data").get(),
      db.collection("users").doc(uid).collection("subscription").doc("data").get(),
    ]);

    const batch = db.batch();
    let hasChanges = false;
    let companyIdForSubscription = uid;

    if (oldProfile.exists) {
      const profileData = oldProfile.data() || {};
      companyIdForSubscription = profileData.companyId || uid;
      batch.set(
        db.collection("users").doc(uid).collection("data").doc("profile"),
        profileData,
        { merge: true },
      );
      hasChanges = true;
    }

    if (oldSubscription.exists) {
      if (!oldProfile.exists) {
        const newProfileSnap = await db.collection("users").doc(uid).collection("data").doc("profile").get();
        const newProfileData = newProfileSnap.exists ? newProfileSnap.data() || {} : {};
        companyIdForSubscription = newProfileData.companyId || uid;
      }
      batch.set(
        db.collection("companies").doc(companyIdForSubscription).collection("business_data").doc("subscription"),
        oldSubscription.data(),
        { merge: true },
      );
      hasChanges = true;
    }

    if (hasChanges) {
      await batch.commit();
      migrated += 1;
      console.log(`migrated users/${uid}/profile/data -> users/${uid}/data/profile`);
      if (oldSubscription.exists) {
        console.log(
          `migrated users/${uid}/subscription/data -> companies/${companyIdForSubscription}/business_data/subscription`,
        );
      }
    }
  }

  return migrated;
}

async function migrateLegacyTopLevelUidCollections(db) {
  let migrated = 0;
  const topLevelCollections = await db.listCollections();

  for (const col of topLevelCollections) {
    const uid = col.id;
    if (isReservedTopLevelCollection(uid)) continue;

    const [legacyProfile, legacyCache, legacyInventory, legacySubscription] = await Promise.all([
      col.doc("profile").get(),
      col.doc("cache").get(),
      col.doc("inventory").get(),
      col.doc("subscription").get(),
    ]);

    if (!legacyProfile.exists && !legacyCache.exists && !legacyInventory.exists && !legacySubscription.exists) {
      continue;
    }

    const batch = db.batch();
    let companyIdForSubscription = uid;
    if (legacyProfile.exists) {
      const profileData = legacyProfile.data() || {};
      companyIdForSubscription = profileData.companyId || uid;
      batch.set(
        db.collection("users").doc(uid).collection("data").doc("profile"),
        profileData,
        { merge: true },
      );
    }
    if (legacyCache.exists) {
      batch.set(
        db.collection("users").doc(uid).collection("data").doc("cache"),
        legacyCache.data(),
        { merge: true },
      );
    }
    if (legacySubscription.exists) {
      batch.set(
        db.collection("companies").doc(companyIdForSubscription).collection("business_data").doc("subscription"),
        legacySubscription.data(),
        { merge: true },
      );
    }
    if (legacyInventory.exists) {
      batch.set(
        db.collection("users").doc(uid).collection("data").doc("inventory"),
        legacyInventory.data(),
        { merge: true },
      );
    }

    await batch.commit();
    migrated += 1;
    console.log(`migrated legacy top-level collection '${uid}' -> users/${uid}/data/*`);
  }

  return migrated;
}

async function migrate() {
  initAdmin();
  const db = getFirestore();

  const migratedUserSubcollections = await migrateUserSubcollectionDocs(db);
  const migratedLegacyUidCollections = await migrateLegacyTopLevelUidCollections(db);

  console.log("");
  console.log("Migration complete.");
  console.log(`users/{uid}/profile/data migrated for: ${migratedUserSubcollections} users`);
  console.log(
    "users/{uid}/subscription/data migrated to companies/{companyId}/business_data/subscription when present",
  );
  console.log(`legacy top-level uid collections migrated for: ${migratedLegacyUidCollections} users`);
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
