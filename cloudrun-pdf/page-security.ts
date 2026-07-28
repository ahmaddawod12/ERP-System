import type { HTTPRequest, Page } from 'puppeteer';

function mayLoad(url: string): boolean {
  if (url === 'about:blank') return true;
  return /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/i.test(url);
}

/**
 * PDF HTML is self-contained. Disable JavaScript and block every external,
 * local-file, socket, blob and non-image data request before any untrusted
 * document data is set.
 */
export async function hardenPdfPage(page: Page): Promise<void> {
  await page.setJavaScriptEnabled(false);
  await page.setBypassCSP(false);
  await page.setRequestInterception(true);
  page.on('request', (request: HTTPRequest) => {
    if (mayLoad(request.url())) {
      void request.continue().catch(() => undefined);
      return;
    }
    void request.abort('blockedbyclient').catch(() => undefined);
  });
}
