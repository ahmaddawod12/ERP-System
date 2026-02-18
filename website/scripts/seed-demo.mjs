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

async function seed() {
  initAdmin();
  const db = getFirestore();

  const companyId = process.env.SEED_COMPANY_ID || "demo-hvac-team";
  const managerUid = process.env.SEED_MANAGER_UID || "demo-manager-uid";
  const workerUid = process.env.SEED_WORKER_UID || "demo-worker-uid";

  await db.collection("companies").doc(companyId).set(
    {
      companyId,
      createdBy: managerUid,
      createdAt: new Date().toISOString(),
    },
    { merge: true },
  );

  await db
    .collection("companies")
    .doc(companyId)
    .collection("business_data")
    .doc("business_info")
    .set(
      {
        name: "Demo HVAC Services",
        number: "HVAC-12345",
        address: "100 Service Avenue",
        phone: "+1-555-0100",
      },
      { merge: true },
    );

  await db.collection("companies").doc(companyId).collection("workers").doc(managerUid).set(
    {
      workerId: managerUid,
      role: "Manager",
      email: "manager@example.com",
      name: "Demo Manager",
      phoneNumber: "+1-555-1000",
      createdAt: new Date().toISOString(),
    },
    { merge: true },
  );

  await db.collection("companies").doc(companyId).collection("workers").doc(workerUid).set(
    {
      workerId: workerUid,
      role: "Worker",
      email: "worker@example.com",
      name: "Demo Worker",
      phoneNumber: "+1-555-2000",
      createdAt: new Date().toISOString(),
    },
    { merge: true },
  );

  await db.collection("users").doc(managerUid).collection("profile").doc("data").set(
    {
      uid: managerUid,
      email: "manager@example.com",
      role: "Manager",
      companyId,
      name: "Demo Manager",
      phoneNumber: "+1-555-1000",
      accountType: "business",
      createdAt: new Date().toISOString(),
    },
    { merge: true },
  );

  await db.collection("users").doc(managerUid).collection("subscription").doc("data").set(
    {
      tier: "Team",
      status: "active",
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  await db.collection("users").doc(workerUid).collection("profile").doc("data").set(
    {
      uid: workerUid,
      email: "worker@example.com",
      role: "Worker",
      companyId,
      name: "Demo Worker",
      phoneNumber: "+1-555-2000",
      accountType: "business",
      createdAt: new Date().toISOString(),
    },
    { merge: true },
  );

  await db.collection("users").doc(workerUid).collection("subscription").doc("data").set(
    {
      tier: "Team",
      status: "active",
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  await db.collection("companies").doc(companyId).collection("counters").doc("clients").set({ lastNumber: 0 }, { merge: true });

  await db.collection("companies").doc(companyId).collection("PendingJobs").doc("demo-job-1").set(
    {
      title: "AC maintenance visit",
      clientName: "Demo Client",
      description: "Inspect rooftop unit and replace filter",
      status: "pending",
      workerId: workerUid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  console.log("Seed complete.");
  console.log(`companyId=${companyId}`);
  console.log(`managerUid=${managerUid}`);
  console.log(`workerUid=${workerUid}`);
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});

