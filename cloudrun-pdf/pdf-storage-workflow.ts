import type { CompanyFileStorage, StoredPdfResult } from './company-file-storage';

type PersistPdfOptions<TSignedUrlName extends string, TFinalizeResult> = {
  storage: CompanyFileStorage;
  objectPath: string;
  bytes: Buffer;
  metadata?: Record<string, string>;
  signedUrlExpiries: Record<TSignedUrlName, number>;
  finalize: (signedUrls: Record<TSignedUrlName, string>, stored: StoredPdfResult) => Promise<TFinalizeResult>;
};

export async function persistPdfBeforeFinalize<
  TSignedUrlName extends string,
  TFinalizeResult,
>(options: PersistPdfOptions<TSignedUrlName, TFinalizeResult>): Promise<{
  stored: StoredPdfResult;
  signedUrls: Record<TSignedUrlName, string>;
  finalizeResult: TFinalizeResult;
}> {
  const stored = await options.storage.storePdfCreateOnly(
    options.objectPath,
    options.bytes,
    options.metadata,
  );

  const signedEntries = await Promise.all(
    Object.entries(options.signedUrlExpiries).map(async ([name, expiry]) => [
      name,
      await options.storage.createSignedDownloadUrl(options.objectPath, Number(expiry)),
    ] as const),
  );
  const signedUrls = Object.fromEntries(signedEntries) as Record<TSignedUrlName, string>;
  const finalizeResult = await options.finalize(signedUrls, stored);
  return { stored, signedUrls, finalizeResult };
}
