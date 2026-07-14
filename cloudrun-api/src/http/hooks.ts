import type { FastifyInstance } from "fastify";

function isPrivateApiRequest(url: string): boolean {
  const queryIndex = url.indexOf("?");
  const path = queryIndex === -1 ? url : url.slice(0, queryIndex);
  return path === "/api/v1" || path.startsWith("/api/v1/");
}

export function registerHttpHooks(app: FastifyInstance): void {
  app.addHook("onRequest", (request, reply, done) => {
    reply.header("x-request-id", request.id);

    if (isPrivateApiRequest(request.url)) {
      reply.header("cache-control", "private, no-store");
    }

    done();
  });
}
