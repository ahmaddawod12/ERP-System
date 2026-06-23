import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import { Appearance } from 'react-native';
import { storage } from './mmkv-storage';
import type { ThemeContextValue } from '../types';

const THEME_KEY = 'app_theme';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const useThemeContext = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeContext must be used within ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
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

  const setTheme = useCallback((isDark: boolean) => {
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

  const value: ThemeContextValue = useMemo(
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
