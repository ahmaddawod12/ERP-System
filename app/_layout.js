import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from '../contexts/LanguageContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { AlertProvider } from '../contexts/AlertContext';
import { CacheProvider } from '../contexts/CacheContext';
import { HeaderProvider } from '../contexts/HeaderContext';
import { ErrorBoundary } from '../components/ErrorBoundary';

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <LanguageProvider>
            <CacheProvider>
              <AlertProvider>
                <HeaderProvider>
                  <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="Login" />
              <Stack.Screen name="BusinessReg" />
              <Stack.Screen name="ManagerHomepage" />
              <Stack.Screen name="WorkerHomepage" />
              <Stack.Screen name="UserHomepage" />
              <Stack.Screen name="BasicHomepage" />
              <Stack.Screen name="WorkersMonitor" />
              <Stack.Screen name="WorkersUsers" />
              <Stack.Screen name="JobMonitor" />
              <Stack.Screen name="ManageJobs" />
              <Stack.Screen name="CreateJob" />
              <Stack.Screen name="Userjob" />
              <Stack.Screen name="Workerjob" />
              <Stack.Screen name="inventory" />
              <Stack.Screen name="CompanyInventory" />
              <Stack.Screen name="GeneralDocuments" />
              <Stack.Screen name="CreateDocument" />
              <Stack.Screen name="GenerateTaxInvoice" />
              <Stack.Screen name="DocumentHistory" />
              <Stack.Screen name="ViewCertification" />
              <Stack.Screen name="Settings" />
              <Stack.Screen name="FillJob" />
              <Stack.Screen name="EditJob" />
              <Stack.Screen name="Permission" />
              <Stack.Screen name="SupportChat" />
              <Stack.Screen name="DevInbox" />
              <Stack.Screen name="ClientBook" />
              </Stack>
                </HeaderProvider>
              </AlertProvider>
            </CacheProvider>
          </LanguageProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
