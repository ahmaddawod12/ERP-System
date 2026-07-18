/**
 * useDocumentTask Hook
 * 
 * Publishes non-tax document tasks through the Cloud API and polls for
 * completion. Tax invoice previews remain on the dedicated tax workflow.
 * 
 * @example
 * ```javascript
 * const { publishPreview, publishGenerate, taskStatus, error, reset } = useDocumentTask({
 *   onPreviewComplete: (url) => console.log('Preview ready:', url),
 *   onGenerateComplete: (url, docId) => console.log('PDF ready:', url),
 *   onError: (error) => console.error('Failed:', error),
 * });
 * 
 * // Publish a preview task
 * const taskId = await publishPreview({
 *   documentType: 10,
 *   companyId: 17,
 *   documentData: { client, items, language, date }
 * });
 * 
 * // Or resume an already accepted task after a retry or restart.
 * listenToTask('existing-task-id');
 * 
 * // taskStatus will update automatically
 * // - pending: Task submitted
 * // - queued: Task published to Pub/Sub
 * // - completed: PDF ready (previewURL or downloadURL available)
 * // - failed: Error occurred (check error state)
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { DocumentTask } from '@smart-job/api-contracts';
import { randomUUID } from 'expo-crypto';
import { functions, httpsCallable } from '../firebase';
import { useSession } from '../contexts/SessionContext';
import { useTenant } from '../contexts/TenantContext';
import { ApiClientError } from '../lib/api/client';
import { StableDocumentActionKeys } from '../modules/documents/lib/document-action-keys';
import { buildDocumentTaskAttempt } from '../modules/documents/lib/document-task-attempt';
import {
  clearDocumentTaskAttempt,
  persistDocumentTaskAttempt,
  readDocumentTaskAttempt,
} from '../modules/documents/lib/document-task-persistence';
import {
  buildDocumentGenerateRequest,
  buildDocumentPreviewRequest,
  isTaxDocumentType,
  normalizeDocumentCompanyId,
  type DocumentTaskParams,
} from '../modules/documents/lib/document-mutation-model';
import {
  createDocumentGenerationTask,
  createDocumentPreviewTask,
  fetchDocumentTask,
} from '../modules/documents/lib/documents-api';
import { logger } from '../utils/logger';
import { getNextDocumentTaskPollIntervalMs } from './document-task-poll';

const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type TaskStatus = DocumentTask['status'] | null;
type TaskType = 'preview' | 'generate' | null;
type TaskData = DocumentTask;

export interface UseDocumentTaskOptions {
  onPreviewComplete?: (url: string) => void;
  onGenerateComplete?: (url: string | null, docId?: string) => void;
  onError?: (error: string) => void;
}

export interface UseDocumentTaskResult {
  publishPreview: (params: DocumentTaskParams) => Promise<string>;
  publishGenerate: (params: DocumentTaskParams) => Promise<string>;
  listenToTask: (taskId: string, type?: 'preview' | 'generate', companyId?: string | number) => void;
  reset: () => void;
  taskId: string | null;
  taskType: TaskType;
  taskStatus: TaskStatus;
  taskData: TaskData | null;
  error: string | null;
  isLoading: boolean;
  previewURL: string | null;
  downloadURL: string | null;
  documentId: string | null;
  pdfSize: number | null;
  isCompleted: boolean;
  isFailed: boolean;
  isPending: boolean;
}

export function useDocumentTask(options: UseDocumentTaskOptions = {}): UseDocumentTaskResult {
  const { onPreviewComplete, onGenerateComplete, onError } = options;
  const { user } = useSession();
  const { workspace } = useTenant();
  
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>(null);
  const [taskData, setTaskData] = useState<TaskData | null>(null);
  const [taskType, setTaskType] = useState<TaskType>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef<UseDocumentTaskOptions>({ onPreviewComplete, onGenerateComplete, onError });
  const [actionKeys] = useState(() => new StableDocumentActionKeys(() => randomUUID()));

  // Update callbacks ref when they change
  useEffect(() => {
    callbacksRef.current = { onPreviewComplete, onGenerateComplete, onError };
  }, [onPreviewComplete, onGenerateComplete, onError]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  /**
   * Start listening to a task document
   * Can be called directly when an accepted task ID is already available.
   * 
   * @param {string} newTaskId - Task ID to listen to
   * @param {string} [type] - Task type ('preview' or 'generate') for callbacks
   */
  const listenToTask = useCallback((newTaskId: string, type: 'preview' | 'generate' = 'generate', companyId?: string | number) => {
    // Clean up previous listener
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setTaskId(newTaskId);
    setTaskType(type);
    setTaskStatus('pending');
    setError(null);
    setTaskData(null);
    setIsLoading(true);

    // Set up timeout
    timeoutRef.current = setTimeout(() => {
      const errorMsg = 'Task processing is still pending. Retry the same action to resume this task.';
      setError(errorMsg);
      setIsLoading(false);
      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(errorMsg);
      }
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    }, TASK_TIMEOUT_MS);

    const uid = user?.id ?? '';
    const resolvedCompanyId = Number(companyId ?? workspace?.companyId ?? 0);
    if (!uid || !Number.isSafeInteger(resolvedCompanyId) || resolvedCompanyId <= 0) {
      clearTimeout(timeoutRef.current ?? undefined);
      timeoutRef.current = null;
      const errorMsg = 'A signed-in user and company are required to read the document task.';
      setError(errorMsg);
      setTaskStatus('failed');
      setIsLoading(false);
      callbacksRef.current.onError?.(errorMsg);
      return;
    }

    const action = `${type}:${resolvedCompanyId}`;
    const reconcileTerminalAttempt = () => {
      const persisted = readDocumentTaskAttempt(uid, resolvedCompanyId, type);
      if (persisted?.accepted?.taskId !== newTaskId) return;
      clearDocumentTaskAttempt(uid, resolvedCompanyId, type);
      actionKeys.complete(action, persisted.idempotencyKey);
    };

    // Poll the versioned Cloud API for an accepted preview or generation task.
    let stopped = false;
    unsubscribeRef.current = () => { stopped = true; };
    let consecutiveInFlightPolls = 0;

    const poll = async () => {
      if (stopped) return;
      try {
        const data = await fetchDocumentTask({
          uid,
          companyId: resolvedCompanyId,
          taskId: newTaskId,
        });

        if (stopped) return;

        if (data) {
          setTaskStatus(data.status);
          setTaskData(data);

          if (data.status === 'completed') {
            clearTimeout(timeoutRef.current ?? undefined);
            setIsLoading(false);
            stopped = true;
            unsubscribeRef.current = null;
            reconcileTerminalAttempt();

            if (data.taskType === 'preview' || type === 'preview') {
              if (callbacksRef.current.onPreviewComplete && data.previewURL) {
                callbacksRef.current.onPreviewComplete(data.previewURL);
              }
            } else {
              if (callbacksRef.current.onGenerateComplete) {
                callbacksRef.current.onGenerateComplete(data.downloadURL || null, data.documentId ?? undefined);
              }
            }
            return;
          } else if (data.status === 'failed') {
            clearTimeout(timeoutRef.current ?? undefined);
            const errorMsg = data.error || 'Task failed';
            setError(errorMsg);
            setIsLoading(false);
            stopped = true;
            unsubscribeRef.current = null;
            reconcileTerminalAttempt();

            if (callbacksRef.current.onError) {
              callbacksRef.current.onError(errorMsg);
            }
            return;
          }

          if (data.status === 'pending' || data.status === 'queued' || data.status === 'processing') {
            consecutiveInFlightPolls += 1;
          }
        }
      } catch (err) {
        logger.warn('Error polling document task status:', err);
        if (err instanceof ApiClientError && !err.retryable) {
          clearTimeout(timeoutRef.current ?? undefined);
          const errorMsg = err.message || 'Task status is unavailable';
          setError(errorMsg);
          setTaskStatus('failed');
          setIsLoading(false);
          stopped = true;
          unsubscribeRef.current = null;
          callbacksRef.current.onError?.(errorMsg);
          return;
        }
      }

      // Still in progress — schedule next poll
      if (!stopped) {
        setTimeout(poll, getNextDocumentTaskPollIntervalMs(consecutiveInFlightPolls));
      }
    };

    poll();
  }, [actionKeys, user?.id, workspace?.companyId]);

  useEffect(() => {
    actionKeys.reset();
    const uid = user?.id ?? '';
    const companyId = Number(workspace?.companyId ?? 0);
    if (!uid || !Number.isSafeInteger(companyId) || companyId <= 0) return;

    const attempts = (['preview', 'generate'] as const)
      .map((action) => readDocumentTaskAttempt(uid, companyId, action))
      .filter((attempt) => attempt !== null);
    for (const attempt of attempts) {
      actionKeys.restore(
        `${attempt.action}:${companyId}`,
        attempt.fingerprint,
        attempt.idempotencyKey,
      );
    }
    const latestAccepted = attempts
      .filter((attempt) => attempt.accepted !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (latestAccepted?.accepted) {
      listenToTask(latestAccepted.accepted.taskId, latestAccepted.action, companyId);
    }
  }, [actionKeys, listenToTask, user?.id, workspace?.companyId]);

  const publishPreview = useCallback(async (params: DocumentTaskParams): Promise<string> => {
    try {
      setIsLoading(true);
      setError(null);

      // Tax previews stay with the dedicated tax-authority flow. Generic
      // document preview traffic must never send type 305 to the Cloud API.
      if (isTaxDocumentType(params.documentType)) {
        const publishPreviewTask = httpsCallable(functions, 'publishPreviewTask');
        const result = await publishPreviewTask(params) as {
          data: { success?: boolean; taskId?: string; error?: string };
        };
        if (!result.data.success || !result.data.taskId) {
          throw new Error(result.data.error || 'Failed to publish preview task');
        }
        listenToTask(result.data.taskId, 'preview', params.companyId);
        return result.data.taskId;
      }

      const uid = user?.id ?? '';
      if (!uid) throw new Error('Authentication is required to preview documents');
      const companyId = normalizeDocumentCompanyId(params.companyId);
      const request = buildDocumentPreviewRequest(params);
      const fingerprint = JSON.stringify(request);
      const action = `preview:${companyId}`;
      const persisted = readDocumentTaskAttempt(uid, companyId, 'preview');
      if (persisted && persisted.fingerprint !== fingerprint) {
        throw new Error(
          'Another preview is awaiting reconciliation. Resume or discard it before changing the request.',
        );
      }
      if (persisted) {
        actionKeys.restore(action, persisted.fingerprint, persisted.idempotencyKey);
      }
      const idempotencyKey = actionKeys.keyFor(action, fingerprint);
      persistDocumentTaskAttempt(buildDocumentTaskAttempt({
        uid,
        companyId,
        action: 'preview',
        fingerprint,
        idempotencyKey,
        accepted: persisted?.accepted,
      }));
      if (persisted?.accepted) {
        listenToTask(persisted.accepted.taskId, 'preview', companyId);
        return persisted.accepted.taskId;
      }
      const accepted = await createDocumentPreviewTask({
        uid,
        companyId,
        request,
        idempotencyKey,
      });
      persistDocumentTaskAttempt(buildDocumentTaskAttempt({
        uid,
        companyId,
        action: 'preview',
        fingerprint,
        idempotencyKey,
        accepted,
      }));
      listenToTask(accepted.taskId, 'preview', companyId);
      return accepted.taskId;
    } catch (err) {
      logger.error('Error publishing preview task:', err);
      const errorMsg = (err as Error).message || 'Failed to publish preview task';
      setError(errorMsg);
      setIsLoading(false);

      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(errorMsg);
      }

      throw err;
    }
  }, [actionKeys, listenToTask, user?.id]);

  const publishGenerate = useCallback(async (params: DocumentTaskParams): Promise<string> => {
    try {
      setIsLoading(true);
      setError(null);

      const uid = user?.id ?? '';
      if (!uid) throw new Error('Authentication is required to create documents');
      const companyId = normalizeDocumentCompanyId(params.companyId);
      const request = buildDocumentGenerateRequest(params);
      const fingerprint = JSON.stringify(request);
      const action = `generate:${companyId}`;
      const persisted = readDocumentTaskAttempt(uid, companyId, 'generate');
      if (persisted && persisted.fingerprint !== fingerprint) {
        throw new Error(
          'Another document is awaiting reconciliation. Resume or discard it before changing the request.',
        );
      }
      if (persisted) {
        actionKeys.restore(action, persisted.fingerprint, persisted.idempotencyKey);
      }
      const idempotencyKey = actionKeys.keyFor(action, fingerprint);
      persistDocumentTaskAttempt(buildDocumentTaskAttempt({
        uid,
        companyId,
        action: 'generate',
        fingerprint,
        idempotencyKey,
        accepted: persisted?.accepted,
      }));
      if (persisted?.accepted) {
        listenToTask(persisted.accepted.taskId, 'generate', companyId);
        return persisted.accepted.taskId;
      }
      const accepted = await createDocumentGenerationTask({
        uid,
        companyId,
        request,
        idempotencyKey,
      });
      persistDocumentTaskAttempt(buildDocumentTaskAttempt({
        uid,
        companyId,
        action: 'generate',
        fingerprint,
        idempotencyKey,
        accepted,
      }));
      listenToTask(accepted.taskId, 'generate', companyId);
      return accepted.taskId;
    } catch (err) {
      logger.error('Error publishing generate task:', err);
      const errorMsg = (err as Error).message || 'Failed to publish generate task';
      setError(errorMsg);
      setIsLoading(false);

      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(errorMsg);
      }

      throw err;
    }
  }, [actionKeys, listenToTask, user?.id]);

  /**
   * Reset the hook state
   */
  const reset = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const uid = user?.id ?? '';
    const companyId = Number(workspace?.companyId ?? 0);
    if (uid && Number.isSafeInteger(companyId) && companyId > 0) {
      clearDocumentTaskAttempt(uid, companyId, 'preview');
      clearDocumentTaskAttempt(uid, companyId, 'generate');
    }
    actionKeys.reset();
    setTaskId(null);
    setTaskType(null);
    setTaskStatus(null);
    setTaskData(null);
    setError(null);
    setIsLoading(false);
  }, [actionKeys, user?.id, workspace?.companyId]);

  return {
    // Methods
    publishPreview,
    publishGenerate,
    listenToTask, // Export listenToTask for direct use with existing task IDs
    reset,
    
    // State
    taskId,
    taskType,
    taskStatus,
    taskData,
    error,
    isLoading,
    
    // Convenience getters
    previewURL: taskData?.previewURL || null,
    downloadURL: taskData?.downloadURL || null,
    documentId: taskData?.documentId || null,
    pdfSize: taskData?.pdfSize ?? null,
    isCompleted: taskStatus === 'completed',
    isFailed: taskStatus === 'failed',
    isPending: taskStatus === 'pending' || taskStatus === 'queued' || taskStatus === 'processing',
  };
}

export default useDocumentTask;
