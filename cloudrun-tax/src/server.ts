import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createRuntimeDependencies } from "./runtime.js";

const config = loadConfig();
const dependencies = createRuntimeDependencies(config);
const app = buildApp({ config, dependencies });
let stopping = false;

async function stop(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "shutdown started");

  const forceExit = setTimeout(() => {
    app.log.fatal({ signal }, "graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await app.close();
    clearTimeout(forceExit);
    app.log.info({ signal }, "shutdown complete");
  } catch (error) {
    clearTimeout(forceExit);
    app.log.error({ err: error, signal }, "shutdown failed");
    process.exitCode = 1;
  }
}

process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, "server startup failed");
  process.exitCode = 1;
}
