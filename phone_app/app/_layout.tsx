import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from '../contexts/LanguageContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { AlertProvider } from '../contexts/AlertContext';
import { CacheProvider } from '../contexts/CacheContext';
import { HeaderProvider } from '../contexts/HeaderContext';
import { ErrorBoundary } from '../components/layout/ErrorBoundary';

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <LanguageProvider>
            <CacheProvider>
              <AlertProvider>
                <HeaderProvider>
                  <Stack screenOptions={{ headerShown: false }} />
                </HeaderProvider>
              </AlertProvider>
            </CacheProvider>
          </LanguageProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
