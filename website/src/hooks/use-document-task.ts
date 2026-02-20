"use client";

/**
 * useDocumentTask Hook (Web SDK port)
 *
 * Mirrors the phone app's useDocumentTask hook.
 * Uses Firebase Web SDK httpsCallable + onSnapshot to:
 *   - publish preview / generate tasks via Cloud Functions (Pub/Sub)
 *   - listen on documentTasks/{taskId} for completion
 *   - call getInvoiceApproval on me-west1 for tax invoices
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions, middleEastFunctions } from "@/lib/firebase/client";

const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface DocumentTaskCallbacks {
  onPreviewComplete?: (url: string) => void;
  onGenerateComplete?: (url: string | null, docId: string | null) => void;
  onError?: (error: string) => void;
}

export interface PublishParams {
  documentType: string;
  companyId: string;
  documentData?: Record<string, unknown>;
  documentId?: string;
}

export interface InvoiceApprovalParams {
  companyId: string;
  type: number;
  documentData: Record<string, unknown>;
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
  const callbacksRef = useRef({ onPreviewComplete, onGenerateComplete, onError });

  // Keep callbacks ref current
  useEffect(() => {
    callbacksRef.current = { onPreviewComplete, onGenerateComplete, onError };
  }, [onPreviewComplete, onGenerateComplete, onError]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  /**
   * Listen to a documentTasks/{taskId} document for status changes.
   * Can be called directly (e.g. after getInvoiceApproval returns a taskId).
   */
  const listenToTask = useCallback(
    (newTaskId: string, type: "preview" | "generate" = "generate") => {
      // Clean up previous
      unsubscribeRef.current?.();
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
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
      }, TASK_TIMEOUT_MS);

      // Firestore listener
      const taskRef = doc(db, "documentTasks", newTaskId);
      unsubscribeRef.current = onSnapshot(
        taskRef,
        (snapshot) => {
          if (!snapshot.exists()) return;
          const data = snapshot.data() as TaskData;
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
            unsubscribeRef.current?.();
            unsubscribeRef.current = null;
          } else if (data.status === "failed") {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            const msg = data.error || "Task failed";
            setError(msg);
            setIsLoading(false);
            callbacksRef.current.onError?.(msg);
            unsubscribeRef.current?.();
            unsubscribeRef.current = null;
          }
        },
        (err) => {
          console.error("Error listening to task:", err);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          const msg = "Failed to track task status";
          setError(msg);
          setIsLoading(false);
          callbacksRef.current.onError?.(msg);
          unsubscribeRef.current?.();
          unsubscribeRef.current = null;
        },
      );
    },
    [],
  );

  /** Publish a preview task → publishPreviewTask (us-central1) */
  const publishPreview = useCallback(
    async (params: PublishParams): Promise<string> => {
      setIsLoading(true);
      setError(null);
      try {
        const callable = httpsCallable<PublishParams, { success: boolean; taskId: string; error?: string }>(
          functions,
          "publishPreviewTask",
        );
        const result = await callable(params);
        if (result.data.success && result.data.taskId) {
          listenToTask(result.data.taskId, "preview");
          return result.data.taskId;
        }
        throw new Error(result.data.error || "Failed to publish preview task");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to publish preview task";
        setError(msg);
        setIsLoading(false);
        callbacksRef.current.onError?.(msg);
        throw err;
      }
    },
    [listenToTask],
  );

  /** Publish a generate task → publishGenerateTask (us-central1) */
  const publishGenerate = useCallback(
    async (params: PublishParams): Promise<string> => {
      setIsLoading(true);
      setError(null);
      try {
        const callable = httpsCallable<
          PublishParams,
          { success: boolean; taskId: string; documentId?: string; error?: string }
        >(functions, "publishGenerateTask");
        const result = await callable(params);
        if (result.data.success && result.data.taskId) {
          listenToTask(result.data.taskId, "generate");
          return result.data.taskId;
        }
        throw new Error(result.data.error || "Failed to publish generate task");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to publish generate task";
        setError(msg);
        setIsLoading(false);
        callbacksRef.current.onError?.(msg);
        throw err;
      }
    },
    [listenToTask],
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
        const callable = httpsCallable<
          InvoiceApprovalParams,
          {
            success: boolean;
            documentId?: string;
            pdfTaskId?: string;
            confirmation_number?: string;
            error?: string;
          }
        >(middleEastFunctions, "getInvoiceApproval");
        const result = await callable(params);

        if (result.data.success) {
          // Listen for the PDF generation task
          if (result.data.pdfTaskId) {
            listenToTask(result.data.pdfTaskId, "generate");
          }
          return result.data;
        }
        throw new Error(result.data.error || "Invoice approval failed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Invoice approval failed";
        setError(msg);
        setIsLoading(false);
        callbacksRef.current.onError?.(msg);
        throw err;
      }
    },
    [listenToTask],
  );

  /** Reset all state and clean up listeners */
  const reset = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
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
  }, []);

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
