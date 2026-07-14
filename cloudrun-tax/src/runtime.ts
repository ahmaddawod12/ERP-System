import type { BuildAppDependencies } from "./app.js";
import { HttpTaxAuthorityClient } from "./authority-client.js";
import { HmacTaxCallbackAuthenticator } from "./callback.js";
import type { ServiceConfig } from "./config.js";
import {
  HttpMainApiCallbackClient,
  MetadataIdentityTokenProvider,
} from "./main-api-client.js";
import type { FetchImplementation } from "./http-client.js";

export function createRuntimeDependencies(
  config: ServiceConfig,
  fetchImplementation: FetchImplementation = globalThis.fetch,
): BuildAppDependencies {
  if (
    config.authority === undefined
    || config.callback === undefined
    || config.mainApi === undefined
  ) {
    return {};
  }

  const identityProvider = new MetadataIdentityTokenProvider(
    config.outboundTimeoutMs,
    fetchImplementation,
  );
  return {
    authorityClient: new HttpTaxAuthorityClient(
      config.authority,
      config.outboundTimeoutMs,
      fetchImplementation,
    ),
    callbackAuthenticator: new HmacTaxCallbackAuthenticator(
      config.callback.hmacSecret,
      config.callback.maxSkewSeconds,
    ),
    callbackClient: new HttpMainApiCallbackClient(
      config.mainApi,
      identityProvider,
      config.outboundTimeoutMs,
      fetchImplementation,
    ),
  };
}
