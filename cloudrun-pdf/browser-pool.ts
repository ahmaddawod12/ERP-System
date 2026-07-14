import puppeteer from 'puppeteer';

function buildRetryableError(code, message) {
  const error: any = new Error(message);
  error.code = code;
  return error;
}

export function isTransientProcessingError(error) {
  if (error?.retryable === true) {
    return true;
  }
  const code = String(error?.code || '').trim().toLowerCase();
  if (code === 'tab_queue_full' || code === 'tab_wait_timeout') {
    return true;
  }
  // PostgreSQL connection failures, serialization/deadlock retries, lock
  // timeouts and admin shutdowns are safe to redeliver through Pub/Sub.
  if (
    code.startsWith('08')
    || code === '40001'
    || code === '40p01'
    || code === '55p03'
    || code === '57014'
    || code.startsWith('57p')
  ) {
    return true;
  }
  const message = String(error?.message || '');
  return message.includes('retry') ||
    message.includes('Protocol error') ||
    message.includes('Navigation timeout') ||
    message.includes('Timeout');
}

export function createBrowserPool(options: {
  maxConcurrentTabs: number;
  maxTabWaiters: number;
  tabWaitTimeoutMs: number;
  executablePath: string;
}) {
  let browserInstance = null;
  let activeTabs = 0;
  let browserGeneration = 0;
  const tabWaiters = [];

  async function getBrowser() {
    if (!browserInstance) {
      console.log('Launching new shared browser instance...');
      browserGeneration++;
      browserInstance = await puppeteer.launch({
        headless: true,
        executablePath: options.executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
        ],
      });

      browserInstance.on('disconnected', () => {
        console.log('Browser disconnected, will create new instance on next request');
        browserInstance = null;
        activeTabs = 0;
        while (tabWaiters.length > 0) {
          const waiter = tabWaiters.shift();
          waiter.reject(new Error('Browser disconnected while waiting for tab'));
        }
      });
    }
    return browserInstance;
  }

  async function acquireTab(taskId, taskType) {
    if (activeTabs < options.maxConcurrentTabs) {
      activeTabs++;
      console.log(`[${taskType}:${taskId}] Tab acquired. Active: ${activeTabs}/${options.maxConcurrentTabs}`);
      return browserGeneration;
    }

    if (tabWaiters.length >= options.maxTabWaiters) {
      throw buildRetryableError(
        'tab_queue_full',
        `retry: browser tab queue full (${tabWaiters.length}/${options.maxTabWaiters})`,
      );
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const idx = tabWaiters.findIndex((waiter) => waiter.taskId === taskId);
        if (idx !== -1) tabWaiters.splice(idx, 1);
        reject(buildRetryableError('tab_wait_timeout', `retry: timeout waiting for available browser tab (${options.tabWaitTimeoutMs}ms)`));
      }, options.tabWaitTimeoutMs);

      tabWaiters.push({
        taskId,
        resolve: () => {
          clearTimeout(timeoutId);
          activeTabs++;
          console.log(`[${taskType}:${taskId}] Tab acquired (from queue). Active: ${activeTabs}/${options.maxConcurrentTabs}`);
          resolve(browserGeneration);
        },
        reject: (err) => {
          clearTimeout(timeoutId);
          reject(err);
        },
      });
      console.log(`[${taskType}:${taskId}] Queued for tab. Active: ${activeTabs}/${options.maxConcurrentTabs}, waiting: ${tabWaiters.length}`);
    });
  }

  function releaseTab(taskId, taskType) {
    if (activeTabs > 0) {
      activeTabs--;
    }
    console.log(`[${taskType}:${taskId}] Tab released. Active: ${activeTabs}/${options.maxConcurrentTabs}`);

    if (tabWaiters.length > 0 && activeTabs < options.maxConcurrentTabs) {
      const next = tabWaiters.shift();
      next.resolve();
    }
  }

  function getStats() {
    let browserConnected = false;
    if (browserInstance) {
      try {
        browserConnected = browserInstance.isConnected();
      } catch (_) {
        browserConnected = false;
      }
    }

    return {
      hasBrowser: !!browserInstance,
      browserConnected,
      activeTabs,
      queuedWaiters: tabWaiters.length,
    };
  }

  function getGeneration() {
    return browserGeneration;
  }

  async function close() {
    while (tabWaiters.length > 0) {
      const waiter = tabWaiters.shift();
      waiter.reject(new Error('Browser pool is closing'));
    }
    if (browserInstance) {
      const instance = browserInstance;
      browserInstance = null;
      activeTabs = 0;
      try {
        await instance.close();
      } catch (closeError) {
        console.warn('Error closing browser instance:', closeError);
      }
    }
  }

  return { getBrowser, acquireTab, releaseTab, getStats, getGeneration, close };
}
