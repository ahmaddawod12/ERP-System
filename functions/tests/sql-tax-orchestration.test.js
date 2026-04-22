const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSqlTaxWorkflow,
} = require('../src/sql-tax-orchestration');

test('tax workflow validates linked SQL jobs before invoice submission', async () => {
  const workflow = createSqlTaxWorkflow({
    getJobInSql: async (_companyId, jobId) => ({
      id: jobId,
      status: 'finished',
      isCert: false,
      wid: '12',
    }),
  });

  await assert.doesNotReject(() => workflow.validateLinkedJobs({
    companyId: '42',
    linkedJobIds: ['100', '101'],
    role: 'user',
    callerWid: '12',
  }));

  await assert.rejects(() => workflow.validateLinkedJobs({
    companyId: '42',
    linkedJobIds: ['100'],
    role: 'user',
    callerWid: '999',
  }), /cannot invoice linked job/i);
});

test('tax workflow refreshes expired SQL tokens through the SQL persistence helper', async () => {
  const finalized = [];
  const workflow = createSqlTaxWorkflow({
    finalizeTaxAuthorityTokenRefreshInSql: async (input) => {
      finalized.push(input);
      return {
        accessToken: input.accessToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshToken: input.refreshToken,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt,
        skipped: false,
      };
    },
  });

  const result = await workflow.refreshTokenIfNeeded({
    companyId: '42',
    tokenData: {
      accessToken: 'old-token',
      accessTokenExpiresAt: Date.now() - 60_000,
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt: Date.now() + 60_000,
    },
    observedAccessTokenExpiresAt: 123,
    refreshTokens: async () => ({
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      accessTokenExpiresAt: 999_000,
      refreshTokenExpiresAt: 1_999_000,
    }),
  });

  assert.equal(result.accessToken, 'new-token');
  assert.equal(result.refreshToken, 'new-refresh');
  assert.equal(result.refreshed, true);
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].companyId, '42');
  assert.equal(finalized[0].observedAccessTokenExpiresAt, 123);
});

test('tax workflow finalizes approved SQL invoices by updating document, sync, reservation, and idempotency state', async () => {
  const calls = {
    createDocument: [],
    bumpSync: [],
    reservation: [],
    idempotency: [],
  };

  const workflow = createSqlTaxWorkflow({
    createDocumentInSql: async (input) => {
      calls.createDocument.push(input);
      return { success: true };
    },
    bumpCompanySyncStateInSql: async (companyId, fields) => {
      calls.bumpSync.push({ companyId, fields });
    },
    updateTaxInvoiceReservationInSql: async (input) => {
      calls.reservation.push(input);
    },
    updateTaxInvoiceIdempotencyInSql: async (input) => {
      calls.idempotency.push(input);
    },
  });

  await workflow.finalizeApprovedInvoice({
    companyId: '42',
    uid: 'user-1',
    documentId: 'TI1-42',
    documentNumber: 1,
    linkedJobIds: ['9'],
    normalizedPriceProposalId: 'PP5-42',
    documentData: { totals: { totalWithVat: 118 } },
    confirmationNumber: 'CONF-1',
    responseStatus: 200,
    reservationRef: { reservationId: 'reservation-1' },
    idempotencyRef: { companyId: '42', idempotencyHash: 'idem-1' },
  });

  assert.equal(calls.createDocument.length, 1);
  assert.equal(calls.createDocument[0].markLinkedJobsCertified, true);
  assert.equal(calls.createDocument[0].markSourcePriceProposalUsed, true);
  assert.deepEqual(calls.bumpSync[0], {
    companyId: '42',
    fields: ['documentsVersion', 'jobsVersion'],
  });
  assert.equal(calls.reservation[0].reservationId, 'reservation-1');
  assert.equal(calls.idempotency[0].idempotencyHash, 'idem-1');
  assert.equal(calls.idempotency[0].status, 'approved');
});

test('tax workflow proxies SQL oauth lifecycle helpers', async () => {
  const observed = [];
  const workflow = createSqlTaxWorkflow({
    createTaxOauthSessionInSql: async (input) => {
      observed.push(['create', input]);
      return { ok: true };
    },
    consumeTaxOauthSessionInSql: async (input) => {
      observed.push(['consume', input]);
      return { ok: true };
    },
    finalizeTaxOauthCallbackInSql: async (input) => {
      observed.push(['finalize', input]);
      return { ok: true };
    },
  });

  await workflow.startOauthSession({ authId: 'a1' });
  await workflow.consumeOauthSession({ authId: 'a1' });
  await workflow.finalizeOauthCallback({ callbackId: 'cb1' });

  assert.deepEqual(observed.map(([kind]) => kind), ['create', 'consume', 'finalize']);
});
