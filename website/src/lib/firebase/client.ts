"use client";

import { initializeApp, getApp, getApps } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

function readRequiredPublicEnv(name: string, fallback: string) {
  const value = process.env[name];
  if (value) return value;

  if (process.env.NODE_ENV === "production") {
    throw new Error(`Missing required public env var: ${name}`);
  }

  return fallback;
}

function parseEmulatorHost(raw: string | undefined) {
  if (!raw) return { host: "127.0.0.1", port: 8080 };
  const [host, portRaw] = raw.split(":");
  const port = Number(portRaw);
  if (!host || !Number.isFinite(port)) {
    return { host: "127.0.0.1", port: 8080 };
  }
  return { host, port };
}

const firebaseConfig = {
  apiKey: readRequiredPublicEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "demo-api-key"),
  authDomain: readRequiredPublicEnv(
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "demo.firebaseapp.com",
  ),
  projectId: readRequiredPublicEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "demo-project"),
  storageBucket: readRequiredPublicEnv(
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    "demo.appspot.com",
  ),
  messagingSenderId: readRequiredPublicEnv(
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "0",
  ),
  appId: readRequiredPublicEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "1:0:web:demo"),
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const isBrowser = typeof window !== "undefined";

export const auth: Auth = isBrowser ? getAuth(app) : ({} as Auth);
export const db: Firestore = isBrowser ? getFirestore(app) : ({} as Firestore);

let emulatorsConnected = false;

if (isBrowser && process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true" && !emulatorsConnected) {
  const emulator = parseEmulatorHost(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, emulator.host, emulator.port);
  emulatorsConnected = true;
}
