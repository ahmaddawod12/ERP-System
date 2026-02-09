/**
 * Utility helper functions for Smart-Job App
 * Centralized common functions to reduce code duplication
 */

// Base62 characters for generating short unique IDs
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generate a unique 5-character Base62 ID
 * ~916 million unique combinations (62^5)
 * Uses crypto random for better uniqueness
 * @returns {string} 5-character Base62 ID
 */
export const generateBase62Id = () => {
  let id = '';
  const randomValues = new Uint8Array(5);
  
  // Use crypto.getRandomValues if available, otherwise fallback to Math.random
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < 5; i++) {
      id += BASE62_CHARS[randomValues[i] % 62];
    }
  } else {
    // Fallback for environments without crypto
    for (let i = 0; i < 5; i++) {
      id += BASE62_CHARS[Math.floor(Math.random() * 62)];
    }
  }
  
  return id;
};

/**
 * Generate a unique job ID using Base62
 * Format: 5 character Base62 string
 * @returns {string} Unique job ID
 */
export const generateJobId = () => {
  return generateBase62Id();
};

/**
 * Generate a prefixed pending job ID
 * Format: p_XXXXX (p = pending)
 * @returns {string} Prefixed pending job ID
 */
export const generatePendingJobId = () => {
  return `p_${generateBase62Id()}`;
};

/**
 * Generate a prefixed finished job ID
 * Format: f_XXXXX (f = finished)
 * @returns {string} Prefixed finished job ID
 */
export const generateFinishedJobId = () => {
  return `f_${generateBase62Id()}`;
};

/**
 * Generate a prefixed certification ID
 * Format: c_XXXXX (c = certification)
 * @returns {string} Prefixed certification ID
 */
export const generateCertificationId = () => {
  return `c_${generateBase62Id()}`;
};

/**
 * Get document type from prefixed ID
 * @param {string} docId - Document ID with prefix
 * @returns {'pendingJob'|'finishedJob'|'certification'|'unknown'} Document type
 */
export const getDocTypeFromId = (docId) => {
  if (!docId || typeof docId !== 'string') return 'unknown';
  if (docId.startsWith('p_')) return 'pendingJob';
  if (docId.startsWith('f_')) return 'finishedJob';
  if (docId.startsWith('c_')) return 'certification';
  return 'unknown';
};

/**
 * Convert pending job ID to finished job ID
 * Changes p_ prefix to f_ prefix
 * @param {string} pendingJobId - Pending job ID with p_ prefix
 * @returns {string} Finished job ID with f_ prefix
 */
export const convertToFinishedJobId = (pendingJobId) => {
  if (pendingJobId && pendingJobId.startsWith('p_')) {
    return `f_${pendingJobId.substring(2)}`;
  }
  // If already finished or no prefix, return as is
  return pendingJobId;
};

/**
 * Extract username from email address
 * @param {string} email - Full email address
 * @returns {string} Username portion before @
 */
export const getUsernameFromEmail = (email) => {
  if (!email || typeof email !== 'string') {
    console.warn('Invalid email provided to getUsernameFromEmail:', email);
    return '';
  }
  return email.split('@')[0];
};

/**
 * Format date to localized string
 * @param {Date|string} date - Date object or ISO string
 * @param {string} locale - Locale code (default: 'en-US')
 * @returns {string} Formatted date string
 */
export const formatDate = (date, locale = 'en-US') => {
  try {
    const dateObj = date instanceof Date ? date : new Date(date);
    return dateObj.toLocaleDateString(locale);
  } catch (error) {
    console.error('Error formatting date:', error);
    return '';
  }
};

/**
 * Format date and time to localized string
 * @param {Date|string} date - Date object or ISO string
 * @param {string} locale - Locale code (default: 'en-US')
 * @returns {string} Formatted datetime string
 */
export const formatDateTime = (date, locale = 'en-US') => {
  try {
    const dateObj = date instanceof Date ? date : new Date(date);
    return dateObj.toLocaleString(locale);
  } catch (error) {
    console.error('Error formatting datetime:', error);
    return '';
  }
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email format
 */
export const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Truncate text to specified length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text with ellipsis
 */
export const truncateText = (text, maxLength = 50) => {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

/**
 * Calculate time difference in minutes
 * @param {string} timeFrom - Start time (HH:MM)
 * @param {string} timeTo - End time (HH:MM)
 * @returns {number} Difference in minutes
 */
export const calculateTimeDifference = (timeFrom, timeTo) => {
  try {
    const [fromHours, fromMinutes] = timeFrom.split(':').map(Number);
    const [toHours, toMinutes] = timeTo.split(':').map(Number);
    
    const fromTotalMinutes = fromHours * 60 + fromMinutes;
    const toTotalMinutes = toHours * 60 + toMinutes;
    
    return toTotalMinutes - fromTotalMinutes;
  } catch (error) {
    console.error('Error calculating time difference:', error);
    return 0;
  }
};

/**
 * Format time difference to readable string
 * @param {number} minutes - Time in minutes
 * @returns {string} Formatted time string
 */
export const formatDuration = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}m`;
  } else if (hours > 0) {
    return `${hours}h`;
  } else {
    return `${mins}m`;
  }
};

/**
 * Debounce function for search/input optimization
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export const debounce = (func, wait = 300) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

/**
 * Deep clone object
 * @param {Object} obj - Object to clone
 * @returns {Object} Cloned object
 */
export const deepClone = (obj) => {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (error) {
    console.error('Error cloning object:', error);
    return obj;
  }
};
