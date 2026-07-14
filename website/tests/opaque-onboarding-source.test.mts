import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const onboardingPage = readFileSync(
  new URL("../src/app/onboarding/page.tsx", import.meta.url),
  "utf8",
);
const onboardingClient = readFileSync(
  new URL("../src/app/onboarding/page-client.tsx", import.meta.url),
  "utf8",
);
const invitationClient = readFileSync(
  new URL("../src/lib/backend/invitation-client.ts", import.meta.url),
  "utf8",
);

test("onboarding resolves the verified opaque session on the server", () => {
  assert.doesNotMatch(onboardingPage, /^\s*["']use client["']/m);
  assert.match(onboardingPage, /requireWebsiteSession\("\/onboarding"\)/);
  assert.match(onboardingPage, /decideWorkspaceEntry\(viewer\.workspaces\)/);
  assert.match(onboardingPage, /<OnboardingClient viewer=\{viewer\}/);
});

test("onboarding mutations use only same-origin BFF endpoints and readable CSRF", () => {
  assert.match(onboardingClient, /readCookie\(document\.cookie, WEB_CSRF_COOKIE\)/);
  assert.match(onboardingClient, /"\/api\/onboarding\/invitation"/);
  assert.match(onboardingClient, /"\/api\/onboarding\/business-registration"/);
  assert.match(onboardingClient, /"Idempotency-Key": idempotencyKey/);
  assert.doesNotMatch(onboardingClient, /PublicLayout|MarketingNav|useAuth/);
  assert.doesNotMatch(
    onboardingClient,
    /buildAuthedJsonHeaders|\/api\/callable|joinCompanyV1|registerBusinessV1|localStorage|sessionStorage|Authorization|access[_-]?token|refresh[_-]?token/i,
  );
});

test("invitation transport stays server-only and uses opaque authorization", () => {
  assert.match(invitationClient, /import "server-only"/);
  assert.match(invitationClient, /InvitationRedemptionResultSchema/);
  assert.match(invitationClient, /Authorization: `SmartJobSession \$\{sessionToken\}`/);
});
