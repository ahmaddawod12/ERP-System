"use client";

import { auth } from "@/lib/firebase/client";

export async function buildAuthedJsonHeaders() {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = await auth.currentUser?.getIdToken(true);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}
