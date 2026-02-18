import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { ServiceAccount } from "firebase-admin";

function resolveServiceAccount(): ServiceAccount | null {
  if (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) {
    try {
      const raw = JSON.parse(
        process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON,
      ) as ServiceAccount;
      if (raw.privateKey) {
        raw.privateKey = raw.privateKey.replace(/\\n/g, "\n");
      }
      return raw;
    } catch {
      throw new Error("FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  }

  if (
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
    process.env.FIREBASE_ADMIN_PRIVATE_KEY
  ) {
    return {
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }

  return null;
}

function resolveProjectId() {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_ADMIN_PROJECT_ID;

  if (projectId) {
    return projectId;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing Firebase project id. Set NEXT_PUBLIC_FIREBASE_PROJECT_ID or FIREBASE_ADMIN_PROJECT_ID.",
    );
  }

  return "demo-smart-job";
}

function initAdminApp() {
  if (getApps().length) {
    return getApps()[0];
  }

  const serviceAccount = resolveServiceAccount();

  if (serviceAccount) {
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId ?? resolveProjectId(),
    });
  }

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({
      projectId: resolveProjectId(),
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: resolveProjectId(),
  });
}

export function adminDb() {
  return getFirestore(initAdminApp());
}

export function adminAuth() {
  return getAuth(initAdminApp());
}
