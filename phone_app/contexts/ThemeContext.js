import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

const THEME_KEY = 'app_theme';
const themeStorage = createMMKV({ id: 'smart-job-preferences' });

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
      const savedTheme = themeStorage.getString(THEME_KEY);
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

  const setTheme = (isDark) => {
    try {
      themeStorage.set(THEME_KEY, isDark ? 'dark' : 'light');
      setIsDarkModeState(!!isDark);
    } catch (error) {
      console.error('Error saving theme preference:', error);
    }
  };

  const toggleTheme = () => {
    setTheme(!isDarkMode);
  };

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
