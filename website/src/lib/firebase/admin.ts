import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { ServiceAccount } from "firebase-admin";

function resolveServiceAccount(): ServiceAccount | null {
  if (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) {
    const raw = JSON.parse(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) as ServiceAccount;
    if (raw.privateKey) {
      raw.privateKey = raw.privateKey.replace(/\\n/g, "\n");
    }
    return raw;
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
  return process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_ADMIN_PROJECT_ID || "demo-smart-job";
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

