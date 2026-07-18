const test = require('node:test');
const assert = require('node:assert/strict');

test('document dispatch accepts only an opaque task id', async () => {
  const { DocumentDispatchMessageSchema } = await import('@smart-job/api-contracts');
  assert.deepEqual(DocumentDispatchMessageSchema.parse({ taskId: 'task-1' }), {
    taskId: 'task-1',
  });
  for (const authority of [
    { companyId: 77 },
    { companyId: '77' },
    { uid: 'user-id' },
    { documentId: 'document-id' },
  ]) {
    assert.equal(DocumentDispatchMessageSchema.safeParse({ taskId: 'task-1', ...authority }).success, false);
  }
});
