import assert from "node:assert/strict";
import test from "node:test";

import { createFirebaseWebAuthClient } from "../auth/firebase-web-auth-client.js";

test("Firebase password sign-in and refresh use bounded server-side REST calls", async () => {
  const requests: string[] = [];
  const client = createFirebaseWebAuthClient({
    apiKey: "test-api-key-123456789012345",
    now: () => 1_000_000,
    fetch: async (input) => {
      requests.push(String(input));
      if (requests.length === 1) {
        return Response.json({
          idToken: "header.payload.signature",
          refreshToken: "refresh-one",
          expiresIn: "3600",
          localId: "provider-user",
        });
      }
      return Response.json({
        id_token: "new-header.payload.signature",
        refresh_token: "refresh-two",
        expires_in: "3600",
        user_id: "provider-user",
      });
    },
  });

  const signedIn = await client.signInWithPassword("user@example.com", "password");
  const refreshed = await client.refreshSession(signedIn.refreshToken);
  assert.equal(signedIn.expiresAt, 4_600);
  assert.equal(refreshed.refreshToken, "refresh-two");
  assert.equal(
    requests[0],
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test-api-key-123456789012345",
  );
  assert.equal(
    requests[1],
    "https://securetoken.googleapis.com/v1/token?key=test-api-key-123456789012345",
  );
});

test("Firebase invalid credentials map to a stable unauthorized error", async () => {
  const client = createFirebaseWebAuthClient({
    apiKey: "test-api-key-123456789012345",
    fetch: async () => Response.json(
      { error: { message: "INVALID_LOGIN_CREDENTIALS" } },
      { status: 400 },
    ),
  });
  await assert.rejects(
    () => client.signInWithPassword("user@example.com", "wrong"),
    (error: unknown) => (
      typeof error === "object"
      && error !== null
      && "statusCode" in error
      && error.statusCode === 401
    ),
  );
});
