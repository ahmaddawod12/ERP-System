export function createCompanyLogoFetcher(options: {
  storage: any;
  bucketName: string;
  maxLogoSize: number;
  cacheTtlMs?: number;
  maxCacheSize?: number;
}) {
  const logoCache = new Map();
  const cacheTtlMs = options.cacheTtlMs ?? 10 * 60 * 1000;
  const maxCacheSize = options.maxCacheSize ?? 100;

  function evictLogoCacheIfNeeded() {
    if (logoCache.size <= maxCacheSize) return;
    const sorted = [...logoCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    const toRemove = sorted.slice(0, sorted.length - maxCacheSize);
    for (const [key] of toRemove) logoCache.delete(key);
  }

  return async function fetchCompanyLogo(companyId, taskId, taskType) {
    if (!companyId) return null;

    const cached = logoCache.get(companyId);
    if (cached && (Date.now() - cached.fetchedAt) < cacheTtlMs) {
      console.log(`[${taskType}:${taskId}] Logo served from cache for ${companyId}`);
      return cached.dataUrl;
    }

    try {
      const bucket = options.storage.bucket(options.bucketName);
      const logoPath = `companies/${companyId}/logo.png`;
      const logoFile = bucket.file(logoPath);
      const [exists] = await logoFile.exists();

      if (!exists) {
        console.log(`[${taskType}:${taskId}] No logo found at ${logoPath}`);
        logoCache.set(companyId, { dataUrl: null, fetchedAt: Date.now() });
        return null;
      }

      const [metadata] = await logoFile.getMetadata();
      const fileSize = parseInt(String(metadata.size), 10) || 0;
      if (fileSize > options.maxLogoSize) {
        console.warn(`[${taskType}:${taskId}] Logo too large (${fileSize} bytes, max ${options.maxLogoSize}). Skipping.`);
        logoCache.set(companyId, { dataUrl: null, fetchedAt: Date.now() });
        return null;
      }

      const [logoBuffer] = await logoFile.download();
      const base64Logo = logoBuffer.toString('base64');
      const dataUrl = `data:image/png;base64,${base64Logo}`;
      console.log(`[${taskType}:${taskId}] Logo converted to base64 (${logoBuffer.length} bytes) from ${logoPath}`);

      logoCache.set(companyId, { dataUrl, fetchedAt: Date.now() });
      evictLogoCacheIfNeeded();
      return dataUrl;
    } catch (logoError) {
      console.warn(`[${taskType}:${taskId}] Error fetching logo:`, logoError.message);
      return null;
    }
  };
}

