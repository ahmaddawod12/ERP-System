/**
 * POST /preview - Pub/Sub push endpoint for preview tasks
 */
import type { Express, RequestHandler } from 'express';

type DocumentDispatchMessage = { readonly taskId: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown preview-task error';
}

export function registerPreviewRoute(app: Express, deps: {
  verifyPubSubRequest: RequestHandler;
  processPreviewTask: (messageData: DocumentDispatchMessage) => Promise<unknown>;
  isTransientProcessingError: (error: unknown) => boolean;
}) {
  app.post('/preview', deps.verifyPubSubRequest, async (req, res) => {
  try {
    if (!req.body || !req.body.message || !req.body.message.data) {
      return res.status(200).send('Invalid Pub/Sub message format — not retryable');
    }

    let messageData;
    try {
      const { DocumentDispatchMessageSchema } = await import('@smart-job/api-contracts');
      messageData = DocumentDispatchMessageSchema.parse(JSON.parse(
        Buffer.from(req.body.message.data, 'base64').toString(),
      ));
    } catch (parseError) {
      return res.status(200).send('Invalid Pub/Sub message payload — not retryable');
    }
    
    console.log('Received preview task:', messageData.taskId);
    await deps.processPreviewTask(messageData);
    res.status(200).send('OK');
    
  } catch (error) {
    const message = errorMessage(error);
    console.error('Preview task error:', message);
    // Return 200 for permanent failures to prevent infinite Pub/Sub retries.
    // Only transient errors (browser crash, timeout) should trigger retry via 500.
    const isTransient = deps.isTransientProcessingError(error);
    const status = isTransient ? 500 : 200;
    res.status(status).send(`Error: ${message}`);
  }
  });
}
