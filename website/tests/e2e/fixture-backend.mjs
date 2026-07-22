import { createServer } from "node:http";

const HOST = "127.0.0.1";
const PORT = 4100;
const SESSION_TOKEN = "S".repeat(43);
const CSRF_TOKEN = "C".repeat(43);
const EXPIRES_AT = "2099-01-01T00:00:00.000Z";
const UPDATED_AT = "2026-07-22T00:00:00.000Z";

const workspace = {
  companyId: 101,
  name: "Fixture HVAC",
  accountType: "business",
  role: "manager",
  memberNo: 1,
  enabledModules: ["solojob", "clients", "documents", "inventory", "team"],
};

const viewer = {
  uid: "11111111-1111-4111-8111-111111111111",
  email: "manager@example.test",
  displayName: "Fixture Manager",
  emailVerified: true,
  workspaces: [workspace],
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Cache-Control": "private, no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function success(response, status, data) {
  sendJson(response, status, {
    ok: true,
    data,
    meta: { requestId: crypto.randomUUID() },
  });
}

function failure(response, status, code, message) {
  sendJson(response, status, {
    ok: false,
    error: { code, message, retryable: false },
    meta: { requestId: crypto.randomUUID() },
  });
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function hasSession(request) {
  return request.headers.authorization === `SmartJobSession ${SESSION_TOKEN}`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  if (request.method === "GET" && url.pathname === "/healthz") {
    success(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/auth/web-sessions") {
    const body = await readJson(request);
    if (body?.email !== "manager@example.test" || body?.password !== "fixture-password") {
      failure(response, 401, "AUTH_INVALID", "The supplied credentials are invalid.");
      return;
    }
    success(response, 201, {
      sessionToken: SESSION_TOKEN,
      csrfToken: CSRF_TOKEN,
      absoluteExpiresAt: EXPIRES_AT,
      viewer,
    });
    return;
  }

  if (url.pathname === "/api/v1/auth/web-sessions/current") {
    if (!hasSession(request)) {
      failure(response, 401, "WEB_SESSION_INVALID", "The website session is invalid.");
      return;
    }
    if (request.method === "GET") {
      success(response, 200, { absoluteExpiresAt: EXPIRES_AT, viewer });
      return;
    }
    if (request.method === "DELETE" && request.headers["x-sj-csrf"] === CSRF_TOKEN) {
      success(response, 200, { revoked: true });
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/v1/companies/101/bootstrap") {
    if (!hasSession(request)) {
      failure(response, 401, "WEB_SESSION_INVALID", "The website session is invalid.");
      return;
    }
    success(response, 200, {
      workspace,
      subscription: {
        tier: "Team",
        status: "active",
        enabledModules: workspace.enabledModules,
        expiresAt: null,
        updatedAt: UPDATED_AT,
      },
      syncState: {
        jobsVersion: 0,
        documentsVersion: 0,
        clientsVersion: 0,
        workersVersion: 0,
        companyInventoryVersion: 0,
        updatedAt: UPDATED_AT,
      },
      counts: {
        jobs: 0,
        clients: 0,
        inventoryParts: 0,
        documents: 0,
        pendingDocumentTasks: 0,
      },
      capabilities: { taxSubmissionMode: "disabled" },
    });
    return;
  }

  failure(response, 404, "FIXTURE_ROUTE_NOT_FOUND", "The fixture route does not exist.");
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Smart-Job Playwright backend fixture listening on http://${HOST}:${PORT}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
