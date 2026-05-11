/**
 * POST /generate - Pub/Sub push endpoint for generate tasks
 */
export function registerGenerateRoute(app, deps: {
  verifyPubSubRequest: unknown;
  processGenerateTask: (messageData: unknown) => Promise<unknown>;
  isTransientProcessingError: (error: unknown) => boolean;
}) {
  app.post('/generate', deps.verifyPubSubRequest, async (req, res) => {
  try {
    if (!req.body || !req.body.message || !req.body.message.data) {
      return res.status(200).send('Invalid Pub/Sub message format — not retryable');
    }

    let messageData;
    try {
      messageData = JSON.parse(
        Buffer.from(req.body.message.data, 'base64').toString()
      );
    } catch (parseError) {
      return res.status(200).send('Invalid Pub/Sub message payload — not retryable');
    }
    
    console.log('Received generate task:', messageData.taskId);
    await deps.processGenerateTask(messageData);
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('Generate task error:', error.message);
    // Return 200 for permanent failures to prevent infinite Pub/Sub retries.
    // Only transient errors (browser crash, timeout) should trigger retry via 500.
    const isTransient = deps.isTransientProcessingError(error);
    const status = isTransient ? 500 : 200;
    res.status(status).send(`Error: ${error.message}`);
  }
  });
}
