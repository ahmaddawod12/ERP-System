import { HttpsError } from 'firebase-functions/v2/https';
import { getCompanyBusinessInfoInSql } from './sql-company-profile';
import {
  allocateCompanyDocumentNumberInSql,
  getCompanyDocumentCounterValueInSql,
} from './sql-company-counters';
import {
  createDocumentInSql,
  deleteDocumentInSql,
  getDocumentInSql,
} from './sql-documents';

const {
  DOC_SUFFIX,
  VAT_RATE,
} = require('./shared');

function coerceTrimmedString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function coerceOptionalString(value) {
  const trimmed = coerceTrimmedString(value);
  return trimmed || null;
}

function getClientVatNumber(client: any = {}) {
  const candidates = [
    client.clientVatNumber,
    client.customerVatNumber,
    client.vatNumber,
    client.vat_number,
  ];
  for (const candidate of candidates) {
    const normalized = coerceTrimmedString(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function buildCompanyDataFromBusinessInfo(businessInfo: any, companyId: string) {
  return {
    name: businessInfo?.he_name || businessInfo?.en_name || companyId,
    email: businessInfo?.business_email || '',
    phone: businessInfo?.business_phone || '',
    address: businessInfo?.address || '',
    vatNumber: businessInfo?.vat_number || '',
  };
}

function buildSqlDocumentRecord({ documentType, documentId, documentNumber, completeDocumentData, uid, createdAt }) {
  const client = completeDocumentData?.client || {};
  const confirmationNumber = coerceOptionalString(completeDocumentData?.taxAuthorityConfirmationNumber);

  return {
    type: documentType,
    documentType,
    documentId,
    documentNumber,
    cname: coerceOptionalString(client.name),
    cphone: coerceOptionalString(client.phone),
    clientCity: coerceOptionalString(client.city),
    clientVatNumber: coerceOptionalString(getClientVatNumber(client)),
    cid: coerceOptionalString(client.clientId || client.id),
    date: coerceOptionalString(completeDocumentData?.date),
    items: Array.isArray(completeDocumentData?.items) ? completeDocumentData.items : [],
    language: coerceTrimmedString(completeDocumentData?.language) || 'he',
    notes: coerceOptionalString(completeDocumentData?.notes),
    createdByUid: uid,
    createdAt: createdAt || new Date().toISOString(),
    jobsData: Array.isArray(completeDocumentData?.jobsData) ? completeDocumentData.jobsData : null,
    priceProposalId: coerceOptionalString(completeDocumentData?.priceProposalId),
    totalBeforeVat: Number(completeDocumentData?.totals?.totalBeforeVat || 0),
    vatAmount: Number(completeDocumentData?.totals?.vatAmount || 0),
    totalWithVat: Number(completeDocumentData?.totals?.totalWithVat || 0),
    paymentMethod: coerceOptionalString(completeDocumentData?.paymentMethod),
    paymentInfo: completeDocumentData?.paymentInfo ?? null,
    invoiceReference: coerceOptionalString(completeDocumentData?.invoiceReference),
    confirmationNumber,
    taxAuthorityConfirmationNumber: confirmationNumber,
    documentData: completeDocumentData,
    storagePath: null,
  };
}

function createSqlDocumentWorkflow(deps: any = {}) {
  const loadBusinessInfo = deps.getCompanyBusinessInfoInSql || getCompanyBusinessInfoInSql;
  const loadDocumentCounter = deps.getCompanyDocumentCounterValueInSql || getCompanyDocumentCounterValueInSql;
  const allocateDocumentNumber = deps.allocateCompanyDocumentNumberInSql || allocateCompanyDocumentNumberInSql;
  const createDocumentRecord = deps.createDocumentInSql || createDocumentInSql;
  const getDocumentRecord = deps.getDocumentInSql || getDocumentInSql;
  const deleteDocumentRecord = deps.deleteDocumentInSql || deleteDocumentInSql;

  return {
    async getPreviewContext(input: { companyId: string; documentType: number }) {
      const [businessInfo, previewDocumentNumber] = await Promise.all([
        loadBusinessInfo(input.companyId),
        loadDocumentCounter(input.companyId, input.documentType),
      ]);

      if (!businessInfo) {
        throw new HttpsError('failed-precondition', 'Business information not found. Please complete business registration.');
      }

      return {
        businessInfo,
        previewDocumentNumber,
        companyData: buildCompanyDataFromBusinessInfo(businessInfo, input.companyId),
      };
    },

    async getGenerateBusinessContext(companyId: string) {
      const businessInfo = await loadBusinessInfo(companyId);
      if (!businessInfo) {
        throw new HttpsError('failed-precondition', 'Business information not found. Please complete business registration.');
      }
      return {
        businessInfo,
        companyData: buildCompanyDataFromBusinessInfo(businessInfo, companyId),
      };
    },

    async prepareExistingDocumentForGeneration(input: {
      companyId: string;
      providedDocumentId: string;
      companyData: any;
    }) {
      const documentDocId = coerceTrimmedString(input.providedDocumentId);
      const existingDocumentData = await getDocumentRecord(input.companyId, documentDocId);
      if (!existingDocumentData) {
        throw new HttpsError('not-found', `Document ${documentDocId} not found`);
      }

      const documentId = coerceTrimmedString(input.providedDocumentId);
      return {
        documentId,
        documentNumber: existingDocumentData.documentNumber,
        existingDocumentData,
        completeDocumentData: {
          ...(existingDocumentData.documentData || {}),
          client: existingDocumentData.documentData?.client || {
            name: existingDocumentData.cname || existingDocumentData.clientName,
            phone: existingDocumentData.cphone || existingDocumentData.clientPhone || '',
            city: existingDocumentData.clientCity || '',
            clientVatNumber: existingDocumentData.clientVatNumber || '',
            clientId: existingDocumentData.cid || existingDocumentData.clientId || '',
          },
          items: Array.isArray(existingDocumentData.items)
            ? existingDocumentData.items
            : (Array.isArray(existingDocumentData.documentData?.items) ? existingDocumentData.documentData.items : []),
          company: input.companyData,
          language: existingDocumentData.language || existingDocumentData.documentData?.language || 'he',
          date: existingDocumentData.date || existingDocumentData.documentData?.date,
          notes: existingDocumentData.notes || existingDocumentData.documentData?.notes || null,
          jobsData: existingDocumentData.jobsData || existingDocumentData.documentData?.jobsData || null,
          priceProposalId: existingDocumentData.priceProposalId || existingDocumentData.documentData?.priceProposalId || null,
          taxAuthorityConfirmationNumber: existingDocumentData.taxAuthorityConfirmationNumber || existingDocumentData.confirmationNumber || null,
          totals: {
            totalBeforeVat: existingDocumentData.totalBeforeVat,
            vatAmount: existingDocumentData.vatAmount,
            totalWithVat: existingDocumentData.totalWithVat,
          },
        },
      };
    },

    async createPendingGeneratedDocument(input: {
      companyId: string;
      documentType: number;
      uid: string;
      requestDocumentData: any;
      companyData: any;
      createdAt?: string;
    }) {
      const documentNumber = await allocateDocumentNumber(input.companyId, input.documentType);
      const documentId = `${DOC_SUFFIX[input.documentType]}${documentNumber}-${input.companyId}`;

      let totalBeforeVat = 0;
      const items = Array.isArray(input.requestDocumentData?.items) ? input.requestDocumentData.items : [];
      items.forEach((item) => {
        totalBeforeVat += (item.quantity || 1) * (item.price || 0);
      });
      const vatAmount = totalBeforeVat * VAT_RATE;
      const totalWithVat = totalBeforeVat + vatAmount;

      const completeDocumentData = {
        client: input.requestDocumentData?.client,
        items,
        company: input.companyData,
        language: input.requestDocumentData?.language || 'he',
        date: input.requestDocumentData?.date || new Date().toISOString().slice(0, 10),
        notes: input.requestDocumentData?.notes || null,
        totals: {
          totalBeforeVat: Math.round(totalBeforeVat * 100) / 100,
          vatAmount: Math.round(vatAmount * 100) / 100,
          totalWithVat: Math.round(totalWithVat * 100) / 100,
        },
      };

      await createDocumentRecord({
        companyId: input.companyId,
        documentId,
        documentType: input.documentType,
        documentNumber,
        createdByUserId: input.uid,
        generationStatus: 'pending',
        createOnly: true,
        record: buildSqlDocumentRecord({
          documentType: input.documentType,
          documentId,
          documentNumber,
          completeDocumentData,
          uid: input.uid,
          createdAt: input.createdAt || new Date().toISOString(),
        }),
      });

      return {
        documentId,
        documentNumber,
        completeDocumentData,
      };
    },

    async deleteDocument(input: { companyId: string; documentId: string }) {
      return deleteDocumentRecord(input);
    },

    async getDocumentForDownload(input: { companyId: string; documentId: string }) {
      const documentRecord = await getDocumentRecord(input.companyId, input.documentId);
      if (!documentRecord) {
        throw new HttpsError('not-found', 'Document not found');
      }
      return documentRecord;
    },
  };
}

const sqlDocumentWorkflow = createSqlDocumentWorkflow();

export {
  buildCompanyDataFromBusinessInfo,
  buildSqlDocumentRecord,
  createSqlDocumentWorkflow,
  sqlDocumentWorkflow,
};
