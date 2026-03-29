/**
 * useDocumentTask Hook
 * 
 * Custom hook for publishing document tasks and listening for completion.
 * Uses Pub/Sub + Cloud Run architecture for scalable PDF generation.
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
 *   documentType: 'priceProposal',
 *   companyId: 'mycompany',
 *   documentData: { client, items, language, date }
 * });
 * 
 * // Or listen to an existing task (e.g., from getInvoiceApproval)
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
import { functions, db, doc, onSnapshot, httpsCallable } from '../firebase';

const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type TaskStatus = 'pending' | 'queued' | 'published' | 'completed' | 'failed' | null;
type TaskType = 'preview' | 'generate' | null;

interface TaskData {
  status?: string;
  taskType?: string;
  previewURL?: string;
  downloadURL?: string;
  documentId?: string;
  pdfSize?: number;
  error?: string;
  [key: string]: any;
}

export interface UseDocumentTaskOptions {
  onPreviewComplete?: (url: string) => void;
  onGenerateComplete?: (url: string | null, docId?: string) => void;
  onError?: (error: string) => void;
}

export interface UseDocumentTaskResult {
  publishPreview: (params: DocumentTaskParams) => Promise<string>;
  publishGenerate: (params: DocumentTaskParams) => Promise<string>;
  listenToTask: (taskId: string, type?: 'preview' | 'generate') => void;
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

interface DocumentTaskParams {
  documentType: string;
  companyId: string;
  documentData?: Record<string, any>;
  documentId?: string;
}

export function useDocumentTask(options: UseDocumentTaskOptions = {}): UseDocumentTaskResult {
  const { onPreviewComplete, onGenerateComplete, onError } = options;
  
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>(null);
  const [taskData, setTaskData] = useState<TaskData | null>(null);
  const [taskType, setTaskType] = useState<TaskType>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef<UseDocumentTaskOptions>({ onPreviewComplete, onGenerateComplete, onError });

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
   * Can be called directly if you already have a task ID (e.g., from getInvoiceApproval)
   * 
   * @param {string} newTaskId - Task ID to listen to
   * @param {string} [type] - Task type ('preview' or 'generate') for callbacks
   */
  const listenToTask = useCallback((newTaskId: string, type: 'preview' | 'generate' = 'generate') => {
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
      const errorMsg = 'Task timed out. Please try again.';
      setError(errorMsg);
      setTaskStatus('failed');
      setIsLoading(false);
      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(errorMsg);
      }
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    }, TASK_TIMEOUT_MS);

    // Listen to task document - React Native Firebase modular API
    const taskRef = doc(db, 'documentTasks', newTaskId);
    unsubscribeRef.current = onSnapshot(taskRef, (snapshot: any) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as TaskData;
        setTaskStatus(data.status as TaskStatus);
        setTaskData(data);

        if (data.status === 'completed') {
          // Task completed successfully
          console.log('📄 Task completed:', {
            taskId: newTaskId,
            taskType: data.taskType,
            type,
            hasDownloadURL: !!data.downloadURL,
            hasPreviewURL: !!data.previewURL,
            hasCallback: type === 'preview' ? !!callbacksRef.current.onPreviewComplete : !!callbacksRef.current.onGenerateComplete
          });
          
          clearTimeout(timeoutRef.current ?? undefined);
          setIsLoading(false);
          
          // Call appropriate callback based on task type
          if (data.taskType === 'preview' || type === 'preview') {
            if (callbacksRef.current.onPreviewComplete && data.previewURL) {
              console.log('✅ Calling onPreviewComplete callback');
              callbacksRef.current.onPreviewComplete(data.previewURL);
            } else {
              console.warn('⚠️ Preview callback not called:', {
                hasCallback: !!callbacksRef.current.onPreviewComplete,
                hasPreviewURL: !!data.previewURL
              });
            }
          } else {
            if (callbacksRef.current.onGenerateComplete) {
              if (data.downloadURL) {
                console.log('✅ Calling onGenerateComplete callback with URL:', data.downloadURL);
                callbacksRef.current.onGenerateComplete(data.downloadURL, data.documentId);
              } else {
                console.warn('⚠️ Task completed but no downloadURL - calling callback anyway');
                // Call callback even without URL to clear loading state
                callbacksRef.current.onGenerateComplete(null, data.documentId);
              }
            } else {
              console.warn('⚠️ onGenerateComplete callback not available');
            }
          }
          
          if (unsubscribeRef.current) {
            unsubscribeRef.current();
            unsubscribeRef.current = null;
          }
        } else if (data.status === 'failed') {
          // Task failed
          clearTimeout(timeoutRef.current ?? undefined);
          const errorMsg = data.error || 'Task failed';
          setError(errorMsg);
          setIsLoading(false);
          
          if (callbacksRef.current.onError) {
            callbacksRef.current.onError(errorMsg);
          }
          
          if (unsubscribeRef.current) {
            unsubscribeRef.current();
            unsubscribeRef.current = null;
          }
        }
      }
    }, (err) => {
      console.error('Error listening to task:', err);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      const errorMsg = 'Failed to track task status';
      setError(errorMsg);
      setIsLoading(false);
      
      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(errorMsg);
      }

      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    });
  }, []);

  const publishPreview = useCallback(async (params: DocumentTaskParams): Promise<string> => {
    try {
      setIsLoading(true);
      setError(null);
      
      // React Native Firebase functions - modular API
      const publishPreviewTask = httpsCallable(functions, 'publishPreviewTask');
      const result = await publishPreviewTask(params) as { data: { success?: boolean; taskId?: string; error?: string } };
      
      if (result.data.success && result.data.taskId) {
        listenToTask(result.data.taskId, 'preview');
        return result.data.taskId;
      } else {
        throw new Error(result.data.error || 'Failed to publish preview task');
      }
    } catch (err) {
      console.error('Error publishing preview task:', err);
      const errorMsg = (err as Error).message || 'Failed to publish preview task';
      setError(errorMsg);
      setIsLoading(false);
      
      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(errorMsg);
      }
      
      throw err;
    }
  }, [listenToTask]);

  const publishGenerate = useCallback(async (params: DocumentTaskParams): Promise<string> => {
    try {
      setIsLoading(true);
      setError(null);
      
      // React Native Firebase functions - modular API
      const publishGenerateTask = httpsCallable(functions, 'publishGenerateTask');
      const result = await publishGenerateTask(params) as { data: { success?: boolean; taskId?: string; error?: string } };
      
      if (result.data.success && result.data.taskId) {
        listenToTask(result.data.taskId, 'generate');
        return result.data.taskId;
      } else {
        throw new Error(result.data.error || 'Failed to publish generate task');
      }
    } catch (err) {
      console.error('Error publishing generate task:', err);
      const errorMsg = (err as Error).message || 'Failed to publish generate task';
      setError(errorMsg);
      setIsLoading(false);
      
      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(errorMsg);
      }
      
      throw err;
    }
  }, [listenToTask]);

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
    pdfSize: taskData?.pdfSize || null,
    isCompleted: taskStatus === 'completed',
    isFailed: taskStatus === 'failed',
    isPending: taskStatus === 'pending' || taskStatus === 'queued' || taskStatus === 'published',
  };
}

export default useDocumentTask;
