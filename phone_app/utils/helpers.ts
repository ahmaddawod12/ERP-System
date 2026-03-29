/**
 * Utility helper functions for Smart-Job App
 * Centralized common functions to reduce code duplication
 */


/**
 * Format date to localized string
 */
export const formatDate = (date: Date | string, locale: string = 'en-US'): string => {
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
 */
export const formatDateTime = (date: Date | string, locale: string = 'en-US'): string => {
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
 */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Truncate text to specified length
 */
export const truncateText = (text: string | null | undefined, maxLength: number = 50): string => {
  if (!text || text.length <= maxLength) return text || '';
  return text.substring(0, maxLength) + '...';
};

/**
 * Calculate time difference in minutes
 */
export const calculateTimeDifference = (timeFrom: string, timeTo: string): number => {
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
 */
export const formatDuration = (minutes: number): string => {
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
 */
export const debounce = <T extends (...args: unknown[]) => void>(func: T, wait: number = 300): ((...args: Parameters<T>) => void) => {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

/**
 * Deep clone object
 */
export const deepClone = <T>(obj: T): T => {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (error) {
    console.error('Error cloning object:', error);
    return obj;
  }
};

/**
 * Safely parse a JSON string, returning a fallback value on failure.
 * Prevents crashes from malformed navigation params or corrupted storage data.
 */
export const safeJsonParse = <T = unknown>(jsonString: unknown, fallback: T | null = null): T | null => {
  if (!jsonString || typeof jsonString !== 'string') return fallback;
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.error('safeJsonParse: failed to parse JSON:', (error as Error).message);
    return fallback;
  }
};
