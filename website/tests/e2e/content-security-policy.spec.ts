import { expect, test } from "@playwright/test";

function nonceFrom(policy: string | null): string {
  const match = policy?.match(/'nonce-([^']+)'/);
  if (!match?.[1]) throw new Error("Sensitive response omitted its CSP nonce");
  return match[1];
}

test.describe("sensitive-route CSP", () => {
  test("uses a unique response nonce and applies it to rendered scripts", async ({
    page,
    request,
  }) => {
    const first = await request.get("/login");
    const second = await request.get("/login");
    const firstNonce = nonceFrom(
      first.headers()["content-security-policy"] ?? null,
    );
    const secondNonce = nonceFrom(
      second.headers()["content-security-policy"] ?? null,
    );
    expect(secondNonce).not.toBe(firstNonce);

    const response = await page.goto("/login");
    const pageNonce = nonceFrom(
      response?.headers()["content-security-policy"] ?? null,
    );
    const nonces = await page.locator("script[nonce]").evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).nonce),
    );
    expect(nonces.length).toBeGreaterThan(0);
    expect(nonces.every((nonce) => nonce === pageNonce)).toBe(true);
  });

  test("blocks an unnonced inline script in the server response", async ({
    context,
    page,
  }) => {
    await context.route("**/login", async (route) => {
      if (route.request().resourceType() !== "document") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = (await response.text()).replace(
        "</head>",
        "<script>window.__smartJobUnnoncedScriptExecuted = true</script></head>",
      );
      const headers = { ...response.headers() };
      delete headers["content-length"];
      await route.fulfill({ response, headers, body });
    });
    await page.goto("/login");
    const executed = await page.evaluate(
      () =>
        (window as typeof window & Record<string, unknown>)
          .__smartJobUnnoncedScriptExecuted === true,
    );
    expect(executed).toBe(false);
  });
});
