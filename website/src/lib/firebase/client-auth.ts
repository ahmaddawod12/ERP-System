"use client";

import { auth } from "@/lib/firebase/client";

function shouldUseDevUidFallback() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true"
  );
}

export async function buildAuthedJsonHeaders() {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = await auth.currentUser?.getIdToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export function withDevUidFallback<T extends Record<string, unknown>>(
  payload: T,
  uid: string,
) {
  if (!shouldUseDevUidFallback()) {
    return payload;
  }
  return {
    ...payload,
    uid,
  };
}

