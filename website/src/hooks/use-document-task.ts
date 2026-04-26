"use client";

/**
 * useDocumentTask Hook (Web SDK port)
 *
 * Mirrors the phone app's useDocumentTask hook.
 * Uses server proxy callables plus adaptive polling against readModelV1 to:
 *   - publish preview / generate tasks via Cloud Functions (Pub/Sub)
 *   - poll document task state until completion through backend read-model APIs
 *   - call getInvoiceApproval on me-west1 for tax invoices
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAuthedJsonHeaders } from "@/lib/firebase/client-auth";
import { getNextDocumentTaskPollIntervalMs } from "@/lib/document-task-poll";

const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface DocumentTaskCallbacks {
  onPreviewComplete?: (url: string) => void;
  onGenerateComplete?: (url: string | null, docId: string | null) => void;
  onError?: (error: string) => void;
}

export interface PublishParams {
  documentType: number;
  companyId: string;
  documentData?: Record<string, unknown>;
  documentId?: string;
}

export interface InvoiceApprovalParams {
  companyId: string;
  type: number;
  client: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  company?: Record<string, unknown>;
  language?: string;
  date?: string;
  notes?: string;
  jobData?: Record<string, unknown>;
  jobsData?: Array<Record<string, unknown>>;
  priceProposalId?: string;
  idempotencyKey: string;
}

export interface TaskData {
  status?: string;
  taskType?: string;
  previewURL?: string;
  downloadURL?: string;
  documentId?: string;
  pdfSize?: number;
  error?: string;
  [key: string]: unknown;
}

type CallableResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { message?: string };
};

export function useDocumentTask(options: DocumentTaskCallbacks = {}) {
  const { onPreviewComplete, onGenerateComplete, onError } = options;

  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [taskData, setTaskData] = useState<TaskData | null>(null);
  const [taskType, setTaskType] = useState<"preview" | "generate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const unsubscribeRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onPreviewComplete, onGenerateComplete, onError });

  // Keep callbacks ref current
  useEffect(() => {
    callbacksRef.current = { onPreviewComplete, onGenerateComplete, onError };
  }, [onPreviewComplete, onGenerateComplete, onError]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const fetchTaskState = useCallback(async (taskIdToRead: string) => {
    const response = await fetch("/api/read-model", {
      method: "POST",
      headers: await buildAuthedJsonHeaders(),
      body: JSON.stringify({ kind: "documentTask", taskId: taskIdToRead }),
    });
    const payload = await response.json() as { ok: boolean; data?: TaskData | null; error?: { message?: string } };
    if (!response.ok || !payload.ok) {
      throw new Error(payload?.error?.message || "Failed to read task status");
    }
    return payload.data ?? null;
  }, []);

  const callServerCallable = useCallback(async <T>(operation: string, payload: unknown) => {
    const response = await fetch("/api/callable", {
      method: "POST",
      headers: await buildAuthedJsonHeaders(),
      body: JSON.stringify({ operation, payload }),
    });
    const body = await response.json() as CallableResponse<T>;
    if (!response.ok || !body.ok || !body.data) {
      throw new Error(body?.error?.message || `${operation} failed`);
    }
    return body.data;
  }, []);

  /**
   * Listen to a documentTasks/{taskId} document for status changes.
   * Can be called directly (e.g. after getInvoiceApproval returns a taskId).
   */
  const listenToTask = useCallback(
    (newTaskId: string, type: "preview" | "generate" = "generate") => {
      // Clean up previous
      stopPolling();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      setTaskId(newTaskId);
      setTaskType(type);
      setTaskStatus("pending");
      setError(null);
      setTaskData(null);
      setIsLoading(true);

      // Timeout
      timeoutRef.current = setTimeout(() => {
        const msg = "Task timed out. Please try again.";
        setError(msg);
        setTaskStatus("failed");
        setIsLoading(false);
        callbacksRef.current.onError?.(msg);
        stopPolling();
      }, TASK_TIMEOUT_MS);

      const handleTaskState = (data: TaskData | null) => {
          if (!data) return;
          setTaskStatus(data.status ?? null);
          setTaskData(data);

          if (data.status === "completed") {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            setIsLoading(false);

            if (data.taskType === "preview" || type === "preview") {
              if (callbacksRef.current.onPreviewComplete && data.previewURL) {
                callbacksRef.current.onPreviewComplete(data.previewURL);
              }
            } else {
              callbacksRef.current.onGenerateComplete?.(
                data.downloadURL ?? null,
                data.documentId ?? null,
              );
            }
            stopPolling();
          } else if (data.status === "failed") {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            const msg = data.error || "Task failed";
            setError(msg);
            setIsLoading(false);
            callbacksRef.current.onError?.(msg);
            stopPolling();
          }
      };

      let consecutiveInFlightPolls = 0;

      const pollOnce = async () => {
        try {
          const data = await fetchTaskState(newTaskId);
          handleTaskState(data);

          const status = String(data?.status || '').trim().toLowerCase();
          if (status === 'pending' || status === 'queued' || status === 'processing' || status === 'published') {
            consecutiveInFlightPolls += 1;
            pollTimeoutRef.current = setTimeout(() => {
              void pollOnce();
            }, getNextDocumentTaskPollIntervalMs(consecutiveInFlightPolls));
          }
        } catch (err) {
          console.error("Error polling task:", err);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          const msg = "Failed to track task status";
          setError(msg);
          setIsLoading(false);
          callbacksRef.current.onError?.(msg);
          stopPolling();
        }
      };

      void pollOnce();
    },
    [fetchTaskState, stopPolling],
  );

  /** Publish a preview task → publishPreviewTask (us-central1) */
  const publishPreview = useCallback(
    async (params: PublishParams): Promise<string> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await callServerCallable<{ success: boolean; taskId: string; error?: string }>(
          "publishPreviewTask",
          params,
        );
        if (result.success && result.taskId) {
          listenToTask(result.taskId, "preview");
          return result.taskId;
        }
        throw new Error(result.error || "Failed to publish preview task");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to publish preview task";
        setError(msg);
        setIsLoading(false);
        callbacksRef.current.onError?.(msg);
        throw err;
      }
    },
    [callServerCallable, listenToTask],
  );

  /** Publish a generate task → publishGenerateTask (us-central1) */
  const publishGenerate = useCallback(
    async (params: PublishParams): Promise<string> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await callServerCallable<
          { success: boolean; taskId: string; documentId?: string; error?: string }
        >(
          "publishGenerateTask",
          params,
        );
        if (result.success && result.taskId) {
          listenToTask(result.taskId, "generate");
          return result.taskId;
        }
        throw new Error(result.error || "Failed to publish generate task");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to publish generate task";
        setError(msg);
        setIsLoading(false);
        callbacksRef.current.onError?.(msg);
        throw err;
      }
    },
    [callServerCallable, listenToTask],
  );

  /**
   * Call getInvoiceApproval (me-west1) for Tax Invoice (type 305).
   * Returns approval data and starts listening for the PDF task.
   */
  const getInvoiceApproval = useCallback(
    async (params: InvoiceApprovalParams) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await callServerCallable<
          {
            success: boolean;
            documentId?: string;
            documentNumber?: number;
            pdfTaskId?: string;
            confirmationNumber?: string;
            error?: string;
          }
        >(
          "getInvoiceApproval",
          params,
        );

        if (result.success) {
          // Listen for the PDF generation task
          if (result.pdfTaskId) {
            listenToTask(result.pdfTaskId, "generate");
          }
          return result;
        }
        throw new Error(result.error || "Invoice approval failed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Invoice approval failed";
        setError(msg);
        setIsLoading(false);
        callbacksRef.current.onError?.(msg);
        throw err;
      }
    },
    [callServerCallable, listenToTask],
  );

  /** Reset all state and clean up listeners */
  const reset = useCallback(() => {
    stopPolling();
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setTaskId(null);
    setTaskType(null);
    setTaskStatus(null);
    setTaskData(null);
    setError(null);
    setIsLoading(false);
  }, [stopPolling]);

  return {
    // Methods
    publishPreview,
    publishGenerate,
    getInvoiceApproval,
    listenToTask,
    reset,

    // State
    taskId,
    taskType,
    taskStatus,
    taskData,
    error,
    isLoading,

    // Convenience
    previewURL: taskData?.previewURL ?? null,
    downloadURL: taskData?.downloadURL ?? null,
    documentId: taskData?.documentId ?? null,
    pdfSize: taskData?.pdfSize ?? null,
    isCompleted: taskStatus === "completed",
    isFailed: taskStatus === "failed",
    isPending:
      taskStatus === "pending" ||
      taskStatus === "queued" ||
      taskStatus === "published",
  };
}
