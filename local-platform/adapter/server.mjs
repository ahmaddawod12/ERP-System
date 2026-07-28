import { createLocalPlatformAdapter, loadAdapterConfig } from "./app.mjs";

const config = loadAdapterConfig();
const adapter = await createLocalPlatformAdapter(config);

await adapter.initialize();
adapter.server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({
    severity: "INFO",
    message: "local platform adapter listening",
    port: config.port,
  }));
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ severity: "INFO", message: "local platform adapter stopping", signal }));
  const forced = setTimeout(() => process.exit(1), 10_000);
  forced.unref();
  try {
    await adapter.close();
  } finally {
    clearTimeout(forced);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
