import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAssignedJobCompletionOutboxPayload,
  buildFinishedJobOutboxPayload,
  describeFinishedJobAttachment,
} from '../modules/jobs/lib/finished-job-outbox-model.ts';
import {
  detectJobAttachmentMimeType,
  requireJobAttachmentMimeType,
} from '../lib/outbox/image-content.ts';

test('finished-job form data maps to the canonical API payload', () => {
  const payload = buildFinishedJobOutboxPayload({
    title: '  Compressor service  ',
    description: 'Replaced the contactor',
    location: '  Haifa  ',
    clientId: 42,
    assigneeMemberNo: '7',
    timeFrom: '08:15',
    timeTo: '09:30',
    signingPerson: '  Dana  ',
    travelDistance: '12.5',
    parts: [
      { id: 18, quantity: 24, usedQuantity: 2 },
      { partId: '19', quantity: 1 },
    ],
  });

  assert.deepEqual(payload, {
    title: 'Compressor service',
    description: 'Replaced the contactor',
    location: 'Haifa',
    clientId: '42',
    assigneeMemberNo: 7,
    status: 'finished',
    timeFrom: '08:15',
    timeTo: '09:30',
    signingPerson: 'Dana',
    travelDistance: 12.5,
    partsUsed: [
      { partId: 18, quantity: 2 },
      { partId: 19, quantity: 1 },
    ],
  });
});

test('finished-job payload rejects stale non-numeric inventory identifiers', () => {
  assert.throws(() => buildFinishedJobOutboxPayload({
    title: 'Repair',
    description: 'Repair details',
    location: 'Site',
    timeFrom: '08:00',
    timeTo: '09:00',
    signingPerson: 'Client',
    parts: [{ id: 'legacy-name', usedQuantity: 1 }],
  }));
});

test('assigned-job completion keeps the opaque version outside the public outbox payload', () => {
  const payload = buildAssignedJobCompletionOutboxPayload({
    jobId: '11111111-1111-4111-8111-111111111111',
    entityVersion: 'opaque-version-7',
    timeFrom: '08:15',
    timeTo: '09:30',
    signingPerson: '  Dana  ',
    travelDistance: '12.5',
    parts: [{ id: 18, usedQuantity: 2 }],
  });

  assert.deepEqual(payload, {
    jobId: '11111111-1111-4111-8111-111111111111',
    timeFrom: '08:15',
    timeTo: '09:30',
    signingPerson: 'Dana',
    travelDistance: 12.5,
    partsUsed: [{ partId: 18, quantity: 2 }],
  });
  assert.ok(!('entityVersion' in payload));
});

test('attachment metadata is deterministic and limited to supported image MIME types', () => {
  assert.deepEqual(
    describeFinishedJobAttachment(
      'file:///tmp/photo-without-an-extension',
      'photo',
      'image/heic',
      1,
    ),
    {
      sourceUri: 'file:///tmp/photo-without-an-extension',
      kind: 'photo',
      fileName: 'photo-02.heic',
      mimeType: 'image/heic',
    },
  );
  assert.deepEqual(
    describeFinishedJobAttachment(
      'data:image/png;base64,AAAA',
      'signature',
      'image/png',
    ),
    {
      sourceUri: 'data:image/png;base64,AAAA',
      kind: 'signature',
      fileName: 'signature.png',
      mimeType: 'image/png',
    },
  );
  assert.throws(() => describeFinishedJobAttachment(
    { storagePath: 'companies/1/jobs/1/old.jpg' },
    'photo',
    'image/jpeg',
  ));
});

test('attachment MIME is detected from bytes instead of file names or defaults', () => {
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0);
  const webp = Uint8Array.of(
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0,
    0x57, 0x45, 0x42, 0x50,
  );
  const heic = Uint8Array.of(
    0, 0, 0, 24,
    0x66, 0x74, 0x79, 0x70,
    0x68, 0x65, 0x69, 0x63,
  );

  assert.equal(detectJobAttachmentMimeType(png), 'image/png');
  assert.equal(detectJobAttachmentMimeType(jpeg), 'image/jpeg');
  assert.equal(detectJobAttachmentMimeType(webp), 'image/webp');
  assert.equal(detectJobAttachmentMimeType(heic), 'image/heic');
  assert.equal(detectJobAttachmentMimeType(Uint8Array.of(1, 2, 3)), null);
  assert.throws(() => requireJobAttachmentMimeType(png, 'image/jpeg'));
  assert.throws(() => requireJobAttachmentMimeType(Uint8Array.of(1, 2, 3)));
});
