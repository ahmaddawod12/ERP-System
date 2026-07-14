import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from '../contexts/LanguageContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { AlertProvider } from '../contexts/AlertContext';
import { CacheProvider } from '../contexts/CacheContext';
import { HeaderProvider } from '../contexts/HeaderContext';
import { ErrorBoundary } from '../components/layout/ErrorBoundary';
import { SessionProvider } from '../contexts/SessionContext';
import { TenantProvider } from '../contexts/TenantContext';
import { QueryProvider } from '../contexts/QueryProvider';
import { OutboxProvider } from '../contexts/OutboxContext';
import { NotificationProvider } from '../contexts/NotificationContext';
import { RouteAccessGate } from '../components/routing/RouteAccessGate';

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <SessionProvider>
          <TenantProvider>
            <QueryProvider>
              <OutboxProvider>
                <NotificationProvider>
                  <ThemeProvider>
                    <LanguageProvider>
                      <CacheProvider>
                        <AlertProvider>
                          <HeaderProvider>
                            <RouteAccessGate>
                              <Stack screenOptions={{ headerShown: false }} />
                            </RouteAccessGate>
                          </HeaderProvider>
                        </AlertProvider>
                      </CacheProvider>
                    </LanguageProvider>
                  </ThemeProvider>
                </NotificationProvider>
              </OutboxProvider>
            </QueryProvider>
          </TenantProvider>
        </SessionProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
