import assert from "node:assert/strict";
import test from "node:test";

import { createFirebaseUserClient } from "../auth/firebase-user-client.js";

const INTERNAL_ID = "92c47ef6-0b19-4c8c-a710-14a5df874749";

test("Firebase user lookup returns only server-trusted identity fields", async () => {
  const client = createFirebaseUserClient({
    projectId: "smart-job-test",
    verifier: {
      projectId: "smart-job-test",
      async verifyAccessToken() {
        return {
          userId: INTERNAL_ID,
          providerUserId: "provider-user",
          expiresAt: 2_000_000_000,
        };
      },
      async verifyAuthorizationHeader() {
        throw new Error("unused");
      },
    },
    auth: {
      async getUser(uid) {
        assert.equal(uid, "provider-user");
        return {
          uid,
          email: "USER@EXAMPLE.COM",
          emailVerified: true,
          disabled: false,
        } as never;
      },
    },
  });
  assert.deepEqual(await client.getUser("header.payload.signature"), {
    userId: INTERNAL_ID,
    email: "USER@EXAMPLE.COM",
    emailVerified: true,
  });
});
