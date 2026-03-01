/**
 * Language Context Provider for Smart-Job App
 * Manages language state globally to avoid prop drilling.
 * Uses MMKV for fast synchronous persistence (migrated from AsyncStorage).
 */

import React, { createContext, useContext, useState } from 'react';
import { storage } from './CacheContext';

const LANGUAGE_KEY = 'app_language';

const LanguageContext = createContext();

export const useLanguageContext = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguageContext must be used within LanguageProvider');
  }
  return context;
};

export const LanguageProvider = ({ children }) => {
  // MMKV reads are synchronous — no loading state needed
  const [language, setLanguageState] = useState(() => {
    try {
      return storage.getString(LANGUAGE_KEY) || 'en';
    } catch {
      return 'en';
    }
  });

  const setLanguage = (newLanguage) => {
    try {
      storage.set(LANGUAGE_KEY, newLanguage);
    } catch (error) {
      console.error('Error saving language preference:', error);
    }
    setLanguageState(newLanguage);
  };

  const toggleLanguage = () => {
    const newLang = language === 'en' ? 'he' : language === 'he' ? 'ar' : 'en';
    setLanguage(newLang);
  };

  const value = {
    language,
    setLanguage,
    toggleLanguage,
    isLoading: false,
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};
