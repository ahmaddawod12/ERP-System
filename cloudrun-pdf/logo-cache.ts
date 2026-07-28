import type { CompanyFileStorage } from './company-file-storage';
import { buildCompanyLogoObjectPath } from './storage-paths';

export function createCompanyLogoFetcher(options: {
  storage: CompanyFileStorage;
  maxLogoSize: number;
  cacheTtlMs?: number;
  maxCacheSize?: number;
}) {
  const logoCache = new Map<string, { dataUrl: string | null; fetchedAt: number }>();
  const cacheTtlMs = options.cacheTtlMs ?? 10 * 60 * 1000;
  const maxCacheSize = options.maxCacheSize ?? 100;

  function evictLogoCacheIfNeeded() {
    if (logoCache.size <= maxCacheSize) return;
    const sorted = [...logoCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    const toRemove = sorted.slice(0, sorted.length - maxCacheSize);
    for (const [key] of toRemove) logoCache.delete(key);
  }

  return async function fetchCompanyLogo(
    companyId: string,
    taskId: string,
    taskType: string,
  ): Promise<string | null> {
    if (!companyId) return null;

    const cached = logoCache.get(companyId);
    if (cached && (Date.now() - cached.fetchedAt) < cacheTtlMs) {
      console.log(`[${taskType}:${taskId}] Logo served from cache for ${companyId}`);
      return cached.dataUrl;
    }

    try {
      const logoPath = buildCompanyLogoObjectPath(companyId);
      const logo = await options.storage.downloadOptionalImage(logoPath, options.maxLogoSize);
      if (!logo) {
        console.log(`[${taskType}:${taskId}] No logo found at ${logoPath}`);
        logoCache.set(companyId, { dataUrl: null, fetchedAt: Date.now() });
        return null;
      }

      const base64Logo = logo.bytes.toString('base64');
      const dataUrl = `data:${logo.contentType};base64,${base64Logo}`;
      console.log(`[${taskType}:${taskId}] Logo converted to base64 (${logo.bytes.length} bytes) from ${logoPath}`);

      logoCache.set(companyId, { dataUrl, fetchedAt: Date.now() });
      evictLogoCacheIfNeeded();
      return dataUrl;
    } catch (logoError) {
      console.warn(
        `[${taskType}:${taskId}] Error fetching logo:`,
        logoError instanceof Error ? logoError.message : 'unknown',
      );
      return null;
    }
  };
}
