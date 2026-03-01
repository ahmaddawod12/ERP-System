import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Appearance } from 'react-native';
import { storage } from './mmkv-storage';

const THEME_KEY = 'app_theme';

const ThemeContext = createContext();

export const useThemeContext = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeContext must be used within ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkModeState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const savedTheme = storage.getString(THEME_KEY);
      if (savedTheme === 'dark' || savedTheme === 'light') {
        setIsDarkModeState(savedTheme === 'dark');
      } else {
        setIsDarkModeState(Appearance.getColorScheme() === 'dark');
      }
    } catch (error) {
      console.error('Error loading theme preference:', error);
      setIsDarkModeState(Appearance.getColorScheme() === 'dark');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setTheme = useCallback((isDark) => {
    try {
      storage.set(THEME_KEY, isDark ? 'dark' : 'light');
      setIsDarkModeState(!!isDark);
    } catch (error) {
      console.error('Error saving theme preference:', error);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(!isDarkMode);
  }, [isDarkMode, setTheme]);

  const value = useMemo(
    () => ({
      isDarkMode,
      setTheme,
      toggleTheme,
      isLoading,
    }),
    [isDarkMode, isLoading]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
