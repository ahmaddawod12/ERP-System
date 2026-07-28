import { fetchDocumentDownloadAccess } from './documents-api';

export async function getDocumentDownloadUrl(
  uid: string,
  companyId: number,
  documentId: string,
): Promise<string> {
  const access = await fetchDocumentDownloadAccess({ uid, companyId, documentId });
  return access.downloadURL;
}
