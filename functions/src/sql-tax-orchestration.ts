import { HttpsError } from 'firebase-functions/v2/https';
import { getJobInSql } from './sql-jobs';
import { bumpCompanySyncStateInSql } from './sql-company-sync';
import { getCompanyBusinessInfoInSql } from './sql-company-profile';
import {
  createDocumentInSql,
  getDocumentInSql,
} from './sql-documents';
import {
  reserveTaxInvoiceSubmissionInSql,
  updateTaxInvoiceIdempotencyInSql,
  updateTaxInvoiceReservationInSql,
} from './sql-tax-bookkeeping';
import {
  consumeTaxOauthSessionInSql,
  createTaxOauthSessionInSql,
  finalizeTaxAuthorityTokenRefreshInSql,
  finalizeTaxOauthCallbackInSql,
  getLatestTaxOauthCallbackInSql,
  getTaxAuthorityTokensInSql,
  upsertTaxAuthorityTokensInSql,
} from './sql-tax-auth';

const { DOC_TYPE } = require('./shared');

function mapReservationFields(fields: any = {}) {
  const payload: any = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined) continue;
    if (value instanceof Date) {
      payload[key] = value.toISOString();
      continue;
    }
    if (value && typeof (value as any).toDate === 'function') {
      payload[key] = (value as any).toDate().toISOString();
      continue;
    }
    if (Array.isArray(value)) {
      payload[key] = value.map((entry) => (entry instanceof Date ? entry.toISOString() : entry));
      continue;
    }
    if (value && typeof value === 'object') {
      const name = value.constructor?.name || '';
      if (name === 'FieldValue') {
        payload[key] = new Date().toISOString();
        continue;
      }
    }
    payload[key] = value;
  }
  return payload;
}

function createSqlTaxWorkflow(deps: any = {}) {
  const loadJob = deps.getJobInSql || getJobInSql;
  const bumpSync = deps.bumpCompanySyncStateInSql || bumpCompanySyncStateInSql;
  const loadBusinessInfo = deps.getCompanyBusinessInfoInSql || getCompanyBusinessInfoInSql;
  const createDocumentRecord = deps.createDocumentInSql || createDocumentInSql;
  const loadDocument = deps.getDocumentInSql || getDocumentInSql;
  const reserveSubmission = deps.reserveTaxInvoiceSubmissionInSql || reserveTaxInvoiceSubmissionInSql;
  const updateIdempotency = deps.updateTaxInvoiceIdempotencyInSql || updateTaxInvoiceIdempotencyInSql;
  const updateReservation = deps.updateTaxInvoiceReservationInSql || updateTaxInvoiceReservationInSql;
  const consumeOauthSession = deps.consumeTaxOauthSessionInSql || consumeTaxOauthSessionInSql;
  const createOauthSession = deps.createTaxOauthSessionInSql || createTaxOauthSessionInSql;
  const finalizeTokenRefresh = deps.finalizeTaxAuthorityTokenRefreshInSql || finalizeTaxAuthorityTokenRefreshInSql;
  const finalizeOauthCallback = deps.finalizeTaxOauthCallbackInSql || finalizeTaxOauthCallbackInSql;
  const getLatestOauthCallback = deps.getLatestTaxOauthCallbackInSql || getLatestTaxOauthCallbackInSql;
  const loadTokens = deps.getTaxAuthorityTokensInSql || getTaxAuthorityTokensInSql;
  const storeTokens = deps.upsertTaxAuthorityTokensInSql || upsertTaxAuthorityTokensInSql;

  return {
    async startOauthSession(input) {
      return createOauthSession(input);
    },

    async getLatestOauthCallback(authId: string) {
      return getLatestOauthCallback(authId);
    },

    async consumeOauthSession(input) {
      return consumeOauthSession(input);
    },

    async storeOauthTokens(input) {
      return storeTokens(input);
    },

    async finalizeOauthCallback(input) {
      return finalizeOauthCallback(input);
    },

    async loadBusinessInfo(companyId: string) {
      const businessInfo = await loadBusinessInfo(companyId);
      if (!businessInfo) {
        throw new HttpsError('not-found', 'Business registration not found. Please register your business first.');
      }
      if (!businessInfo.vat_number) {
        throw new HttpsError('invalid-argument', 'Missing VAT number in business registration.');
      }
      return businessInfo;
    },

    async validateLinkedJobs(input: {
      companyId: string;
      linkedJobIds: string[];
      role: string;
      callerWid?: string | number | null;
    }) {
      const jobRecords = await Promise.all(input.linkedJobIds.map((jobId) => loadJob(input.companyId, jobId)));
      jobRecords.forEach((job, index) => {
        const linkedJobId = input.linkedJobIds[index];
        if (!job) {
          throw new HttpsError('not-found', `Linked job ${linkedJobId} was not found`);
        }
        if (job.status !== 'finished') {
          throw new HttpsError('failed-precondition', `Linked job ${linkedJobId} must be finished before invoicing`);
        }
        if (job.isCert === true) {
          throw new HttpsError('failed-precondition', `Linked job ${linkedJobId} already has a tax invoice`);
        }
        if (input.role !== 'manager' && String(job.wid || '') !== String(input.callerWid || '')) {
          throw new HttpsError('permission-denied', `You cannot invoice linked job ${linkedJobId}`);
        }
      });
      return jobRecords;
    },

    async validatePriceProposal(input: {
      companyId: string;
      proposalId?: string | null;
      uid: string;
      role: string;
    }) {
      if (!input.proposalId) return null;
      const proposal = await loadDocument(input.companyId, input.proposalId);
      if (!proposal) {
        throw new HttpsError('not-found', 'Price proposal not found');
      }
      const proposalType = Number(proposal.documentType ?? proposal.type);
      if (proposalType !== DOC_TYPE.PRICE_PROPOSAL) {
        throw new HttpsError('failed-precondition', 'Only price proposal documents can be marked as used');
      }
      if (proposal.isUsed === true) {
        throw new HttpsError('failed-precondition', 'Price proposal is already used');
      }
      if (input.role !== 'manager' && proposal.createdByUid && proposal.createdByUid !== input.uid) {
        throw new HttpsError('permission-denied', 'You cannot use this price proposal');
      }
      return proposal;
    },

    async reserveSubmission(input) {
      return reserveSubmission(input);
    },

    async loadTokenState(companyId: string) {
      const tokenData = await loadTokens(companyId);
      if (!tokenData || !tokenData.accessToken) {
        throw new HttpsError('failed-precondition', 'No access token found. Please authorize with Tax Authority first.');
      }
      return tokenData;
    },

    async refreshTokenIfNeeded(input: {
      companyId: string;
      tokenData: any;
      observedAccessTokenExpiresAt: number;
      refreshTokens: () => Promise<any>;
    }) {
      const { tokenData } = input;
      const isTokenExpired = Date.now() + (5 * 60 * 1000) >= Number(tokenData.accessTokenExpiresAt || 0);
      if (!isTokenExpired) {
        return {
          accessToken: tokenData.accessToken,
          accessTokenExpiresAt: Number(tokenData.accessTokenExpiresAt || 0),
          refreshToken: tokenData.refreshToken || null,
          refreshTokenExpiresAt: Number(tokenData.refreshTokenExpiresAt || 0),
          refreshed: false,
          skipped: false,
        };
      }

      if (!tokenData.refreshToken) {
        throw new HttpsError('failed-precondition', 'Access token expired and no refresh token available. Please re-authorize with Tax Authority.');
      }

      if (tokenData.refreshTokenExpiresAt && Date.now() > Number(tokenData.refreshTokenExpiresAt)) {
        throw new HttpsError('failed-precondition', 'Refresh token expired. Please re-authorize with Tax Authority.');
      }

      const refreshedTokenData = await input.refreshTokens();
      const now = Date.now();
      const refreshResult = await finalizeTokenRefresh({
        companyId: input.companyId,
        observedAccessTokenExpiresAt: Number(input.observedAccessTokenExpiresAt || tokenData.accessTokenExpiresAt || 0),
        accessToken: refreshedTokenData.accessToken,
        refreshToken: refreshedTokenData.refreshToken || tokenData.refreshToken,
        accessTokenExpiresAt: refreshedTokenData.accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshedTokenData.refreshTokenExpiresAt,
        authorizedAt: new Date(now),
      });

      return {
        accessToken: refreshResult.accessToken,
        accessTokenExpiresAt: Number(refreshResult.accessTokenExpiresAt || refreshedTokenData.accessTokenExpiresAt || 0),
        refreshToken: refreshResult.refreshToken || refreshedTokenData.refreshToken || tokenData.refreshToken || null,
        refreshTokenExpiresAt: Number(refreshResult.refreshTokenExpiresAt || refreshedTokenData.refreshTokenExpiresAt || tokenData.refreshTokenExpiresAt || 0),
        refreshed: refreshResult.skipped !== true,
        skipped: refreshResult.skipped === true,
      };
    },

    async setReservationState(reservationRef, status: string, fields: any = {}) {
      const payload = mapReservationFields(fields);
      let sqlStatus = status;
      if (status === 'rejected_validation') sqlStatus = 'validation_failed';
      if (status === 'submission_failed') sqlStatus = 'submission_failed';

      await updateReservation({
        reservationId: reservationRef.reservationId,
        status: sqlStatus,
        confirmationNumber: fields.confirmationNumber || null,
        payload: {
          ...payload,
          originalStatus: status,
        },
      });
    },

    async setIdempotencyState(idempotencyRef, status: string, fields: any = {}) {
      const hasResult = Object.prototype.hasOwnProperty.call(fields, 'result');
      const resultPayload = hasResult
        ? fields.result
        : (fields.errorMessage ? { errorMessage: String(fields.errorMessage || '').slice(0, 500) } : undefined);

      await updateIdempotency({
        companyId: idempotencyRef.companyId,
        idempotencyHash: idempotencyRef.idempotencyHash,
        status,
        resultPayload,
      });
    },

    async finalizeApprovedInvoice(input: {
      companyId: string;
      uid: string;
      documentId: string;
      documentNumber: number;
      linkedJobIds: string[];
      normalizedPriceProposalId?: string | null;
      documentData: any;
      confirmationNumber?: string | null;
      responseStatus?: number | null;
      reservationRef: { reservationId: string };
      idempotencyRef: { companyId: string; idempotencyHash: string };
    }) {
      await createDocumentRecord({
        companyId: input.companyId,
        documentId: input.documentId,
        documentType: DOC_TYPE.TAX_INVOICE,
        documentNumber: input.documentNumber,
        createdByUserId: input.uid,
        generationStatus: 'pending',
        markLinkedJobsCertified: input.linkedJobIds.length > 0,
        markSourcePriceProposalUsed: Boolean(input.normalizedPriceProposalId),
        sourcePriceProposalId: input.normalizedPriceProposalId || null,
        linkedJobIds: input.linkedJobIds,
        record: input.documentData,
      });

      await bumpSync(input.companyId, input.linkedJobIds.length > 0
        ? ['documentsVersion', 'jobsVersion']
        : ['documentsVersion']);

      await this.setReservationState(input.reservationRef, 'approved', {
        finalizedAt: new Date().toISOString(),
        confirmationNumber: input.confirmationNumber || null,
        taxAuthorityStatus: input.responseStatus ?? null,
      });
      await this.setIdempotencyState(input.idempotencyRef, 'approved', {
        updatedAt: new Date().toISOString(),
      });
    },
  };
}

const sqlTaxWorkflow = createSqlTaxWorkflow();

export {
  createSqlTaxWorkflow,
  sqlTaxWorkflow,
};
