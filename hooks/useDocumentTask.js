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
 *   companyName: 'mycompany',
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
import { useCache } from '../contexts/CacheContext';

const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * @param {Object} options
 * @param {Function} [options.onPreviewComplete] - Callback when preview is ready (url)
 * @param {Function} [options.onGenerateComplete] - Callback when document is generated (url, docId)
 * @param {Function} [options.onError] - Callback when task fails (error)
 */
export function useDocumentTask(options = {}) {
  const { onPreviewComplete, onGenerateComplete, onError } = options;
  const { profile: cachedProfile } = useCache();
  
  const [taskId, setTaskId] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);
  const [taskData, setTaskData] = useState(null);
  const [taskType, setTaskType] = useState(null); // 'preview' or 'generate'
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const unsubscribeRef = useRef(null);
  const timeoutRef = useRef(null);
  const callbacksRef = useRef({ onPreviewComplete, onGenerateComplete, onError });

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
  const listenToTask = useCallback((newTaskId, type = 'generate') => {
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
    unsubscribeRef.current = onSnapshot(taskRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setTaskStatus(data.status);
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
          
          clearTimeout(timeoutRef.current);
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
          clearTimeout(timeoutRef.current);
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
      const errorMsg = 'Failed to track task status';
      setError(errorMsg);
      setIsLoading(false);
      
      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(errorMsg);
      }
    });
  }, []);

  /**
   * Publish a preview task
   * 
   * @param {Object} params
   * @param {string} params.documentType - 'taxInvoice', 'priceProposal', 'refund', 'returnCertificate'
   * @param {string} params.companyName - Company name for storage
   * @param {Object} params.documentData - Document data (client, items, etc.)
   * @returns {Promise<string>} Task ID
   */
  const publishPreview = useCallback(async (params) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Add cached profile to reduce Firestore reads
      // businessInfo is NOT sent - Cloud Functions fetch it directly from Firestore for security
      const requestParams = {
        ...params,
        userProfile: cachedProfile || undefined, // Include cached profile for role detection
      };
      
      // React Native Firebase functions - modular API
      const publishPreviewTask = httpsCallable(functions, 'publishPreviewTask');
      const result = await publishPreviewTask(requestParams);
      
      if (result.data.success && result.data.taskId) {
        listenToTask(result.data.taskId, 'preview');
        return result.data.taskId;
      } else {
        throw new Error(result.data.error || 'Failed to publish preview task');
      }
    } catch (err) {
      console.error('Error publishing preview task:', err);
      const errorMsg = err.message || 'Failed to publish preview task';
      setError(errorMsg);
      setIsLoading(false);
      
      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(errorMsg);
      }
      
      throw err;
    }
  }, [listenToTask,  cachedProfile]);

  /**
   * Publish a generate task
   * 
   * @param {Object} params
   * @param {string} params.documentType - 'taxInvoice', 'priceProposal', 'refund', 'returnCertificate'
   * @param {string} params.companyName - Company name for storage
   * @param {Object} [params.documentData] - Document data (for non-taxInvoice)
   * @param {string} [params.documentId] - Document ID (for taxInvoice)
   * @returns {Promise<string>} Task ID
   */
  const publishGenerate = useCallback(async (params) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Add cached profile to reduce Firestore reads
      // businessInfo is NOT sent - Cloud Functions fetch it directly from Firestore for security
      const requestParams = {
        ...params,
        userProfile: cachedProfile || undefined, // Include cached profile for role detection
      };
      
      // React Native Firebase functions - modular API
      const publishGenerateTask = httpsCallable(functions, 'publishGenerateTask');
      const result = await publishGenerateTask(requestParams);
      
      if (result.data.success && result.data.taskId) {
        listenToTask(result.data.taskId, 'generate');
        return result.data.taskId;
      } else {
        throw new Error(result.data.error || 'Failed to publish generate task');
      }
    } catch (err) {
      console.error('Error publishing generate task:', err);
      const errorMsg = err.message || 'Failed to publish generate task';
      setError(errorMsg);
      setIsLoading(false);
      
      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(errorMsg);
      }
      
      throw err;
    }
  }, [listenToTask, cachedProfile]);

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
