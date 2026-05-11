import { functions, httpsCallable } from '../../../firebase';

export async function getDocumentDownloadUrl(companyId: string, documentId: string): Promise<string> {
  const callable = httpsCallable(functions, 'createDocumentDownloadUrlV1');
  const result = await callable({ companyId, documentId }) as {
    data?: { success?: boolean; downloadURL?: string };
  };

  if (!result?.data?.success || !result.data.downloadURL) {
    throw new Error('Document download URL is unavailable');
  }

  return result.data.downloadURL;
}
