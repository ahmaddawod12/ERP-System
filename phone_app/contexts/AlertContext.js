import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import CustomAlert from '../components/CustomAlert';
import { AppText } from '../components';
import { gradients as themeGradients } from '../theme';

const AlertContext = createContext();

export function AlertProvider({ children }) {
  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    type: 'info',
    title: '',
    message: '',
    buttons: [],
    icon: null,
  });
  const [loadingConfig, setLoadingConfig] = useState({
    visible: false,
    title: '',
    message: '',
  });

  const showAlert = useCallback((config) => {
    // Ensure loading is hidden first to avoid nested modals
    setLoadingConfig({ visible: false, title: '', message: '' });
    
    // Small delay to ensure loading modal is fully dismissed on iOS
    setTimeout(() => {
      setAlertConfig({
        visible: true,
        type: config.type || 'info',
        title: config.title || '',
        message: config.message || '',
        buttons: config.buttons || [],
        icon: config.icon || null,
      });
    }, 100);
  }, []);

  const hideAlert = useCallback(() => {
    setAlertConfig((prev) => ({ ...prev, visible: false }));
  }, []);

  const showLoading = useCallback((title, message) => {
    // Hide any existing alert first
    setAlertConfig({ visible: false, type: 'info', title: '', message: '', buttons: [], icon: null });
    
    setLoadingConfig({
      visible: true,
      title: title || 'Please Wait',
      message: message || 'Processing...',
    });
  }, []);

  const hideLoading = useCallback(() => {
    setLoadingConfig({ visible: false, title: '', message: '' });
  }, []);

  const alert = useMemo(() => ({
    show: showAlert,
    success: (title, message, buttons) => showAlert({ type: 'success', title, message, buttons }),
    error: (title, message, buttons) => showAlert({ type: 'error', title, message, buttons }),
    failed: (title, message, buttons) => showAlert({ type: 'failed', title, message, buttons }),
    waiting: (title, message, buttons) => showAlert({ type: 'waiting', title, message, buttons }),
    info: (title, message, buttons) => showAlert({ type: 'info', title, message, buttons }),
    confirm: (title, message, buttons) => showAlert({ type: 'confirm', title, message, buttons }),
    loading: showLoading,
    hideLoading: hideLoading,
  }), [showAlert, showLoading, hideLoading]);

  return (
    <AlertContext.Provider value={alert}>
      {children}
      
      {/* Main Alert Modal */}
      <CustomAlert
        visible={alertConfig.visible}
        type={alertConfig.type}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        icon={alertConfig.icon}
        onDismiss={hideAlert}
      />
      
      {/* Loading Modal - NO nested CustomAlert, just simple UI */}
      <Modal
        visible={loadingConfig.visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        hardwareAccelerated
      >
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingBox}>
            <LinearGradient
              colors={themeGradients.yellowBox}
              style={styles.loadingGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Ionicons name="hourglass" size={40} color="#FFFFFF" />
              <AppText style={styles.loadingTitle}>{loadingConfig.title}</AppText>
              <AppText style={styles.loadingMessage}>{loadingConfig.message}</AppText>
              <ActivityIndicator size="large" color="#FFFFFF" style={styles.spinner} />
            </LinearGradient>
          </View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingBox: {
    width: '80%',
    maxWidth: 350,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  loadingGradient: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 15,
    textAlign: 'center',
  },
  loadingMessage: {
    fontSize: 15,
    color: '#FFFFFF',
    marginTop: 8,
    textAlign: 'center',
    opacity: 0.95,
  },
  spinner: {
    marginTop: 20,
  },
});

export function useAlert() {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
}
