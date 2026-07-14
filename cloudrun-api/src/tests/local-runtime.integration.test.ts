import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

import {
  createApiRequestAuthenticator,
  type ApiRequestAuthenticator,
  type SupabaseJwtVerifier,
  type SupabaseUserClient,
  type SupabaseWebAuthClient,
} from "../auth/index.js";
import { buildApp } from "../app.js";
import { createApiDatabaseRuntime } from "../database/runtime.js";
import { readCompanyBootstrap } from "../bootstrap/repository.js";
import { encodeEntityVersion } from "../entities/version.js";
import { loadConfig } from "../config.js";
import { AppError } from "../http/errors.js";
import { registerJobCompletionRoutes } from "../routes/job-completion.js";
import { registerViewerRoutes } from "../routes/viewer.js";
import { registerWorkspaceRoutes } from "../routes/workspaces.js";
import { resolveTenantContext } from "../tenancy/context.js";
import { listWorkspaceSummaries } from "../workspaces/repository.js";
import { createWebSessionCrypto } from "../web-sessions/crypto.js";
import {
  createWebSessionService,
  type WebSessionService,
} from "../web-sessions/service.js";

const adminDatabaseUrl = String(
  process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "",
).trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The runtime-login integration test only runs against a loopback database",
  );
  return url;
}

async function setRuntimePassword(client: Client, password: string | null): Promise<void> {
  if (password === null) {
    await client.query("ALTER ROLE smart_job_api PASSWORD NULL");
    return;
  }

  const formatted = await client.query<{ command: string }>(
    "SELECT format('ALTER ROLE smart_job_api PASSWORD %L', $1::text) AS command",
    [password],
  );
  const command = formatted.rows[0]?.command;
  assert.ok(command);
  await client.query(command);
}

function testAccessToken(userId: string, sessionId: string, expiresAt: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "ES256", typ: "JWT" })}.${encode({
    sub: userId,
    session_id: sessionId,
    exp: expiresAt,
  })}.test-signature`;
}

if (adminDatabaseUrl.length === 0) {
  test("runtime role login, reads, and idempotent job completion", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for local runtime integration",
  }, () => undefined);
} else {
  test("runtime role login, reads, and idempotent job completion", { timeout: 30_000 }, async () => {
    const adminUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: adminUrl.href, ssl: false });
    const password = randomBytes(32).toString("base64url");
    const userId = randomUUID();
    const companyId = randomUUID();
    const membershipId = randomUUID();
    const jobId = randomUUID();
    const opaqueJobId = randomUUID();
    const publicCompanyId = 7_000_000_000 + randomInt(1_000_000);
    const idempotencyKey = `runtime-complete-${randomUUID()}`;
    let database: ReturnType<typeof createApiDatabaseRuntime> | undefined;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      await setRuntimePassword(admin, password);
      await admin.query(
        `INSERT INTO public.app_users (id, email, display_name)
         VALUES ($1, $2, 'Runtime login fixture')`,
        [userId, `runtime-${userId}@example.invalid`],
      );
      await admin.query(
        `INSERT INTO public.companies (
           id, public_company_id, account_type, status, created_by_user_id
         ) VALUES ($1, $2, 'business', 'active', $3)`,
        [companyId, publicCompanyId, userId],
      );
      await admin.query(
        `INSERT INTO public.company_profiles (company_id, he_name)
         VALUES ($1, 'Runtime Workspace')`,
        [companyId],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (company_id, tier, enabled_modules)
         VALUES ($1, 'Team', '{"documents":false,"inventory":true}'::jsonb)`,
        [companyId],
      );
      await admin.query(
        `INSERT INTO public.company_memberships (
           id, company_id, user_id, member_no, role, status, display_name
         ) VALUES ($1, $2, $3, 1, 'manager', 'active', 'Runtime manager')`,
        [membershipId, companyId, userId],
      );
      await admin.query(
        `INSERT INTO public.company_sync_state (
           company_id, jobs_version, documents_version, clients_version,
           workers_version, company_inventory_version
         ) VALUES ($1, 1, 2, 3, 4, 5)`,
        [companyId],
      );
      await admin.query(
        `INSERT INTO public.jobs (
           id, company_id, job_no, status, title,
           assigned_membership_id, created_by_membership_id
         ) VALUES ($1, $2, 1, 'pending', 'Runtime completion fixture', $3, $3)`,
        [jobId, companyId, membershipId],
      );

      const runtimeUrl = new URL(adminUrl.href);
      runtimeUrl.username = "smart_job_api";
      runtimeUrl.password = password;
      database = createApiDatabaseRuntime({
        config: {
          connectionString: runtimeUrl.href,
          ssl: false,
          maxConnections: 2,
          idleTimeoutMillis: 1_000,
          connectionTimeoutMillis: 5_000,
        },
      });

      const workspaces = await database.withTransaction(
        { userId },
        (transaction) => listWorkspaceSummaries(transaction, userId),
      );
      assert.deepEqual(workspaces, [{
        companyId: publicCompanyId,
        name: "Runtime Workspace",
        accountType: "business",
        role: "manager",
        memberNo: 1,
        enabledModules: [
          "clients",
          "companyinventory",
          "inventory",
          "solojob",
          "team",
          "teaminventory",
        ],
      }]);

      const bootstrap = await database.withTransaction(
        { userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            userId,
            publicCompanyId,
          );
          assert.equal(tenant.internalCompanyId, companyId);
          return readCompanyBootstrap(
            transaction,
            tenant.internalCompanyId,
            tenant.workspace,
          );
        },
      );
      assert.deepEqual(bootstrap.syncState, {
        jobsVersion: 1,
        documentsVersion: 2,
        clientsVersion: 3,
        workersVersion: 4,
        companyInventoryVersion: 5,
        updatedAt: bootstrap.syncState.updatedAt,
      });
      assert.deepEqual(bootstrap.counts, {
        jobs: 1,
        clients: 0,
        inventoryParts: 0,
        documents: 0,
        pendingDocumentTasks: 0,
      });

      await admin.query(
        `UPDATE public.company_subscriptions
         SET enabled_modules = enabled_modules || '{"solojob":false}'::jsonb
         WHERE company_id = $1`,
        [companyId],
      );
      const disabledBootstrap = await database.withTransaction(
        { userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            userId,
            publicCompanyId,
          );
          return readCompanyBootstrap(
            transaction,
            tenant.internalCompanyId,
            tenant.workspace,
          );
        },
      );
      assert.equal(disabledBootstrap.counts.jobs, 0);

      const jwtVerifier: SupabaseJwtVerifier = {
        issuer: "http://127.0.0.1:55321/auth/v1",
        audiences: ["authenticated"],
        async verifyAuthorizationHeader() {
          throw new Error("The route authenticates the parsed access token directly");
        },
        async verifyAccessToken(token) {
          assert.equal(token, "header.payload.signature");
          return { userId, expiresAt: 4_102_444_800 };
        },
      };
      app = await buildApp({ config: loadConfig({}), logger: false });
      let webSessionResolver: Pick<WebSessionService, "authenticateSession"> | undefined;
      let currentSessionResolver: Pick<WebSessionService, "currentSession"> | undefined;
      let supabaseUserResolver: SupabaseUserClient | undefined;
      const domainAuthenticator: ApiRequestAuthenticator = createApiRequestAuthenticator({
        jwtVerifier,
        webSessions: {
          async authenticateSession(token) {
            if (webSessionResolver === undefined) {
              throw new Error("Opaque authentication was used before session setup");
            }
            return webSessionResolver.authenticateSession(token);
          },
        },
      });
      registerJobCompletionRoutes(app, {
        database,
        authenticator: domainAuthenticator,
        supabaseUsers: {
          async getUser(token) {
            assert.equal(token, "header.payload.signature");
            return {
              userId,
              email: `runtime-${userId}@example.invalid`,
              emailVerified: true,
            };
          },
        },
      });
      registerWorkspaceRoutes(app, { database, authenticator: domainAuthenticator });
      registerViewerRoutes(app, {
        database,
        authenticator: domainAuthenticator,
        supabaseUsers: {
          async getUser(token) {
            if (supabaseUserResolver === undefined) {
              throw new Error("Viewer Auth lookup was used before session setup");
            }
            return supabaseUserResolver.getUser(token);
          },
        },
        webSessions: {
          async currentSession(token) {
            if (currentSessionResolver === undefined) {
              throw new Error("Current session was used before session setup");
            }
            return currentSessionResolver.currentSession(token);
          },
        },
      });

      const completionRequest = {
        method: "POST" as const,
        url: `/api/v1/companies/${publicCompanyId}/jobs/${jobId}/complete`,
        headers: {
          authorization: "Bearer header.payload.signature",
          "idempotency-key": idempotencyKey,
          "content-type": "application/json",
        },
        payload: {
          entityVersion: encodeEntityVersion(1),
          timeFrom: "08:00",
          timeTo: "09:30",
          signingPerson: "Runtime signer",
          travelDistance: 12.5,
        },
      };

      const disabledCompletion = await app.inject(completionRequest);
      assert.equal(disabledCompletion.statusCode, 403, disabledCompletion.body);
      assert.equal(disabledCompletion.json().error.code, "JOB_COMPLETION_FORBIDDEN");

      await admin.query(
        `UPDATE public.company_subscriptions
         SET enabled_modules = enabled_modules - 'solojob'
         WHERE company_id = $1`,
        [companyId],
      );

      const firstCompletion = await app.inject(completionRequest);
      assert.equal(firstCompletion.statusCode, 200, firstCompletion.body);
      const firstBody = firstCompletion.json();
      assert.equal(firstBody.ok, true);
      assert.deepEqual(firstBody.data, {
        jobId,
        jobNo: 1,
        status: "finished",
        entityVersion: encodeEntityVersion(2),
        finishedAt: firstBody.data.finishedAt,
        updatedAt: firstBody.data.updatedAt,
      });
      assert.equal(firstBody.data.finishedAt, firstBody.data.updatedAt);

      const replayedCompletion = await app.inject(completionRequest);
      assert.equal(replayedCompletion.statusCode, 200, replayedCompletion.body);
      assert.deepEqual(replayedCompletion.json().data, firstBody.data);

      const reusedKey = await app.inject({
        ...completionRequest,
        payload: { ...completionRequest.payload, timeTo: "10:00" },
      });
      assert.equal(reusedKey.statusCode, 409, reusedKey.body);
      assert.equal(reusedKey.json().error.code, "IDEMPOTENCY_KEY_REUSED");

      const persisted = await admin.query<{
        status: string;
        entity_version: string;
        accepted_by_user_id: string;
        accepted_at: Date;
        finished_at: Date;
        meta: Record<string, unknown>;
        jobs_version: string;
        idempotency_rows: string;
        completed_idempotency_rows: string;
      }>(
        `SELECT
           job.status::text,
           job.entity_version::text,
           job.accepted_by_user_id,
           job.accepted_at,
           job.finished_at,
           job.meta,
           sync.jobs_version::text,
           count(idempotency.id)::text AS idempotency_rows,
           count(idempotency.id) FILTER (
             WHERE idempotency.completed_at IS NOT NULL
               AND idempotency.response_status = 200
           )::text AS completed_idempotency_rows
         FROM public.jobs job
         INNER JOIN public.company_sync_state sync
           ON sync.company_id = job.company_id
         LEFT JOIN private.api_idempotency idempotency
           ON idempotency.user_id = $1
          AND idempotency.company_id = job.company_id
          AND idempotency.operation = 'job.complete_assigned'
         WHERE job.id = $2
         GROUP BY
           job.status,
           job.entity_version,
           job.accepted_by_user_id,
           job.accepted_at,
           job.finished_at,
           job.meta,
           sync.jobs_version`,
        [userId, jobId],
      );
      assert.deepEqual(persisted.rows[0], {
        status: "finished",
        entity_version: "2",
        accepted_by_user_id: userId,
        accepted_at: persisted.rows[0]?.accepted_at,
        finished_at: persisted.rows[0]?.finished_at,
        meta: {
          timeFrom: "08:00",
          timeTo: "09:30",
          signingPerson: "Runtime signer",
          travelDistance: 12.5,
        },
        jobs_version: "2",
        idempotency_rows: "1",
        completed_idempotency_rows: "1",
      });
      assert.ok(persisted.rows[0]?.accepted_at instanceof Date);
      assert.deepEqual(
        persisted.rows[0]?.accepted_at,
        persisted.rows[0]?.finished_at,
      );

      const webAuthSessionId = randomUUID();
      const webNow = new Date();
      const initialExpiresAt = Math.floor(webNow.getTime() / 1_000) + 30;
      const refreshedExpiresAt = Math.floor(webNow.getTime() / 1_000) + 3_600;
      const initialAccessToken = testAccessToken(userId, webAuthSessionId, initialExpiresAt);
      const refreshedAccessToken = testAccessToken(userId, webAuthSessionId, refreshedExpiresAt);
      let refreshCalls = 0;
      let signOutCalls = 0;
      let userLookupCalls = 0;
      const webJwtVerifier: SupabaseJwtVerifier = {
        issuer: "http://127.0.0.1:55321/auth/v1",
        audiences: ["authenticated"],
        async verifyAuthorizationHeader() {
          throw new Error("not used");
        },
        async verifyAccessToken(token) {
          if (token === initialAccessToken) {
            return { userId, expiresAt: initialExpiresAt };
          }
          assert.equal(token, refreshedAccessToken);
          return { userId, expiresAt: refreshedExpiresAt };
        },
      };
      const supabaseUsers: SupabaseUserClient = {
        async getUser(token) {
          userLookupCalls += 1;
          assert.equal(token, refreshedAccessToken);
          return {
            userId,
            email: `runtime-${userId}@example.invalid`,
            emailVerified: true,
          };
        },
      };
      const supabaseWebAuth: SupabaseWebAuthClient = {
        async signInWithPassword(email, passwordValue) {
          assert.equal(email, `runtime-${userId}@example.invalid`);
          assert.equal(passwordValue, "local-password");
          return {
            accessToken: initialAccessToken,
            refreshToken: "initial-refresh-token",
            expiresAt: initialExpiresAt,
            user: { userId, email, emailVerified: true },
          };
        },
        async refreshSession(refreshToken) {
          assert.equal(refreshToken, "initial-refresh-token");
          refreshCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            accessToken: refreshedAccessToken,
            refreshToken: "rotated-refresh-token",
            expiresAt: refreshedExpiresAt,
            user: {
              userId,
              email: `runtime-${userId}@example.invalid`,
              emailVerified: true,
            },
          };
        },
        async signOut(token) {
          assert.equal(token, refreshedAccessToken);
          signOutCalls += 1;
        },
      };
      const webSessionCrypto = createWebSessionCrypto({
        key: Buffer.alloc(32, 23),
        keyVersion: "integration-v1",
      });
      const webSessions = createWebSessionService({
        database,
        jwtVerifier: webJwtVerifier,
        supabaseUsers,
        supabaseWebAuth,
        crypto: webSessionCrypto,
        now: () => new Date(webNow),
      });
      webSessionResolver = webSessions;
      currentSessionResolver = webSessions;
      supabaseUserResolver = supabaseUsers;

      const createdWebSession = await webSessions.createSession(
        `runtime-${userId}@example.invalid`,
        "local-password",
      );
      assert.equal(createdWebSession.viewer.uid, userId);
      assert.equal(createdWebSession.viewer.workspaces[0]?.companyId, publicCompanyId);
      const [authenticatedSession, firstCurrent, secondCurrent] = await Promise.all([
        webSessions.authenticateSession(createdWebSession.sessionToken),
        webSessions.currentSession(createdWebSession.sessionToken),
        webSessions.currentSession(createdWebSession.sessionToken),
      ]);
      assert.deepEqual(authenticatedSession, {
        userId,
        absoluteExpiresAt: new Date(createdWebSession.absoluteExpiresAt),
      });
      assert.deepEqual(Object.keys(authenticatedSession).sort(), [
        "absoluteExpiresAt",
        "userId",
      ]);
      assert.deepEqual(secondCurrent, firstCurrent);
      assert.equal(refreshCalls, 1, "the row lock must single-flight refresh-token rotation");
      assert.equal(
        userLookupCalls,
        2,
        "internal authentication must not make an Auth-user network lookup",
      );

      const opaqueWorkspace = await app.inject({
        method: "GET",
        url: "/api/v1/workspaces",
        headers: {
          authorization: `SmartJobSession ${createdWebSession.sessionToken}`,
        },
      });
      assert.equal(opaqueWorkspace.statusCode, 200, opaqueWorkspace.body);
      assert.equal(opaqueWorkspace.json().data[0]?.companyId, publicCompanyId);

      const bearerWorkspace = await app.inject({
        method: "GET",
        url: "/api/v1/workspaces",
        headers: { authorization: "Bearer header.payload.signature" },
      });
      assert.equal(bearerWorkspace.statusCode, 200, bearerWorkspace.body);
      assert.deepEqual(bearerWorkspace.json().data, opaqueWorkspace.json().data);
      assert.equal(userLookupCalls, 2);

      const opaqueViewer = await app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: {
          authorization: `SmartJobSession ${createdWebSession.sessionToken}`,
        },
      });
      assert.equal(opaqueViewer.statusCode, 200, opaqueViewer.body);
      assert.equal(opaqueViewer.json().data.uid, userId);
      assert.equal(opaqueViewer.json().data.emailVerified, true);
      assert.equal(userLookupCalls, 3, "/me must load authoritative verified email state");

      await admin.query(
        `INSERT INTO public.jobs (
           id, company_id, job_no, status, title,
           assigned_membership_id, created_by_membership_id
         ) VALUES ($1, $2, 2, 'pending', 'Opaque completion fixture', $3, $3)`,
        [opaqueJobId, companyId, membershipId],
      );
      const opaqueCompletion = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/jobs/${opaqueJobId}/complete`,
        headers: {
          authorization: `SmartJobSession ${createdWebSession.sessionToken}`,
          "idempotency-key": `opaque-complete-${randomUUID()}`,
          "content-type": "application/json",
        },
        payload: {
          entityVersion: encodeEntityVersion(1),
          signingPerson: "Opaque signer",
        },
      });
      assert.equal(opaqueCompletion.statusCode, 200, opaqueCompletion.body);
      assert.deepEqual(opaqueCompletion.json().data, {
        jobId: opaqueJobId,
        jobNo: 2,
        status: "finished",
        entityVersion: encodeEntityVersion(2),
        finishedAt: opaqueCompletion.json().data.finishedAt,
        updatedAt: opaqueCompletion.json().data.updatedAt,
      });

      const ambiguousAuthorization = await app.inject({
        method: "GET",
        url: "/api/v1/workspaces",
        headers: {
          authorization:
            `Bearer header.payload.signature, SmartJobSession ${createdWebSession.sessionToken}`,
        },
      });
      assert.equal(ambiguousAuthorization.statusCode, 401, ambiguousAuthorization.body);
      assert.equal(ambiguousAuthorization.json().error.code, "AUTHORIZATION_INVALID");

      const expiredWebSession = await webSessions.createSession(
        `runtime-${userId}@example.invalid`,
        "local-password",
      );
      await admin.query(
        `UPDATE private.web_sessions
         SET created_at = $2::timestamptz,
             absolute_expires_at = $3::timestamptz
         WHERE session_token_hash = $1::bytea`,
        [
          webSessionCrypto.hashToken(expiredWebSession.sessionToken),
          new Date(webNow.getTime() - (13 * 60 * 60 * 1_000)),
          new Date(webNow.getTime() - (60 * 60 * 1_000)),
        ],
      );
      const expiredWorkspace = await app.inject({
        method: "GET",
        url: "/api/v1/workspaces",
        headers: {
          authorization: `SmartJobSession ${expiredWebSession.sessionToken}`,
        },
      });
      assert.equal(expiredWorkspace.statusCode, 401, expiredWorkspace.body);
      assert.equal(expiredWorkspace.json().error.code, "WEB_SESSION_INVALID");

      await assert.rejects(
        webSessions.revokeSession(createdWebSession.sessionToken, "C".repeat(43)),
        (error: unknown) => error instanceof AppError && error.code === "CSRF_INVALID",
      );
      await webSessions.revokeSession(
        createdWebSession.sessionToken,
        createdWebSession.csrfToken,
      );
      assert.equal(signOutCalls, 1);
      const revokedWorkspace = await app.inject({
        method: "GET",
        url: "/api/v1/workspaces",
        headers: {
          authorization: `SmartJobSession ${createdWebSession.sessionToken}`,
        },
      });
      assert.equal(revokedWorkspace.statusCode, 401, revokedWorkspace.body);
      assert.equal(revokedWorkspace.json().error.code, "WEB_SESSION_INVALID");
      await assert.rejects(
        webSessions.currentSession(createdWebSession.sessionToken),
        (error: unknown) => error instanceof AppError && error.code === "WEB_SESSION_INVALID",
      );

      const storedWebSession = await admin.query<{
        encryption_key_version: string;
        token_hash_length: number;
        csrf_hash_length: number;
        revoked: boolean;
        ciphertext_base64: string;
      }>(
        `SELECT
           encryption_key_version,
           octet_length(session_token_hash)::integer AS token_hash_length,
           octet_length(csrf_token_hash)::integer AS csrf_hash_length,
           revoked_at IS NOT NULL AS revoked,
           encode(credentials_ciphertext, 'base64') AS ciphertext_base64
         FROM private.web_sessions
         WHERE session_token_hash = $1::bytea`,
        [webSessionCrypto.hashToken(createdWebSession.sessionToken)],
      );
      assert.deepEqual(storedWebSession.rows[0], {
        encryption_key_version: "integration-v1",
        token_hash_length: 32,
        csrf_hash_length: 32,
        revoked: true,
        ciphertext_base64: storedWebSession.rows[0]?.ciphertext_base64,
      });
      assert.doesNotMatch(
        storedWebSession.rows[0]?.ciphertext_base64 ?? "",
        /initial|rotated|access|refresh/i,
      );
    } finally {
      await app?.close().catch(() => undefined);
      await database?.close().catch(() => undefined);
      await admin.query("DELETE FROM private.web_sessions WHERE user_id = $1", [userId])
        .catch(() => undefined);
      await admin.query("DELETE FROM public.companies WHERE id = $1", [companyId])
        .catch(() => undefined);
      await admin.query("DELETE FROM public.app_users WHERE id = $1", [userId])
        .catch(() => undefined);
      await setRuntimePassword(admin, null).catch(() => undefined);
      await admin.end();
    }
  });
}
