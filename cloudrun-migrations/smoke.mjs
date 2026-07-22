const targets = JSON.parse(process.env.SMOKE_TARGETS || "[]");

if (!Array.isArray(targets) || targets.length === 0 || targets.length > 10) {
  throw new Error("SMOKE_TARGETS must contain between one and ten targets");
}

async function identityToken(audience) {
  const endpoint = new URL(
    "/computeMetadata/v1/instance/service-accounts/default/identity",
    "http://metadata.google.internal",
  );
  endpoint.searchParams.set("audience", audience);
  endpoint.searchParams.set("format", "full");

  const response = await fetch(endpoint, {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`metadata identity request failed (${response.status})`);
  }
  return response.text();
}

for (const [index, target] of targets.entries()) {
  if (
    typeof target !== "object"
    || target === null
    || typeof target.url !== "string"
    || typeof target.audience !== "string"
  ) {
    throw new Error(`smoke target ${index} is invalid`);
  }

  const url = new URL(target.url);
  const audience = new URL(target.audience).origin;
  if (url.protocol !== "https:" || audience !== target.audience) {
    throw new Error(`smoke target ${index} must use exact HTTPS origins`);
  }

  const token = await identityToken(audience);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "smart-job-release-smoke/1.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`smoke target ${index} failed (${response.status})`);
  }
  process.stdout.write(`smoke target ${index + 1}/${targets.length} passed\n`);
}
