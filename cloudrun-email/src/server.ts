import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { EmailDeliveryStore } from "./database.js";
import { createPubSubAuthorizer } from "./pubsub-auth.js";
import { SesDocumentSender } from "./ses.js";
import { checkStorageConfiguration, createDocumentDownloadUrl } from "./storage.js";

const config = loadConfig();
const store = new EmailDeliveryStore(config.database);
const sender = new SesDocumentSender(config.ses);
const app = buildApp({
  config,
  store,
  authorize: createPubSubAuthorizer(config.pubsub),
  signDownload: (objectPath) => createDocumentDownloadUrl(config.storage, objectPath),
  sender,
  checkReadiness: async () => {
    checkStorageConfiguration(config.storage);
    await Promise.all([store.checkReadiness(), sender.checkReadiness()]);
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close()
      .then(() => store.close())
      .finally(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
