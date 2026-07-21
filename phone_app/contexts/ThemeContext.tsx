import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import { Appearance } from 'react-native';
import { storage } from './mmkv-storage';
import { logger } from '../utils/logger';
import type { ThemeContextValue, ThemePreference } from '../types';

const THEME_KEY = 'app_theme';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const useThemeContext = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useThemeContext must be used within ThemeProvider');
  return context;
};

function readInitialPreference(): ThemePreference {
  try {
    const savedTheme = storage.getString(THEME_KEY);
    return savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'system'
      ? savedTheme
      : 'system';
  } catch (error) {
    logger.error('Error loading theme preference:', error);
    return 'system';
  }
}

function systemIsDark(): boolean {
  return Appearance.getColorScheme() === 'dark';
}

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(readInitialPreference);
  const [systemDarkMode, setSystemDarkMode] = useState(systemIsDark);

  useEffect(() => {
    if (themePreference !== 'system') return;
    setSystemDarkMode(systemIsDark());
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemDarkMode(colorScheme === 'dark');
    });
    return () => subscription.remove();
  }, [themePreference]);

  const setThemePreference = useCallback((preference: ThemePreference) => {
    try {
      storage.set(THEME_KEY, preference);
      setThemePreferenceState(preference);
      if (preference === 'system') setSystemDarkMode(systemIsDark());
    } catch (error) {
      logger.error('Error saving theme preference:', error);
    }
  }, []);

  const isDarkMode = themePreference === 'system'
    ? systemDarkMode
    : themePreference === 'dark';

  const setTheme = useCallback((isDark: boolean) => {
    setThemePreference(isDark ? 'dark' : 'light');
  }, [setThemePreference]);

  const toggleTheme = useCallback(() => {
    setTheme(!isDarkMode);
  }, [isDarkMode, setTheme]);

  const value: ThemeContextValue = useMemo(() => ({
    isDarkMode,
    themePreference,
    setTheme,
    setThemePreference,
    toggleTheme,
    isLoading: false,
  }), [isDarkMode, setTheme, setThemePreference, themePreference, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
