import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, borderRadius, typography } from '../theme';

/**
 * ClientSelectorModal - Reusable full-screen modal for selecting clients
 * 
 * @param {boolean} visible - Modal visibility
 * @param {function} onClose - Close callback
 * @param {function} onSelectClient - Callback when client is selected (receives client.name)
 * @param {object} colors - Theme colors
 * @param {object} translations - Localized strings (filterByClient, searchClients, noClients, noSearchResults, clearFilter)
 * @param {array} clients - Array of client objects
 * @param {string} searchQuery - Current search query
 * @param {function} onSearchChange - Search query change callback
 * @param {string} currentFilter - Currently selected client name
 */
export default function ClientSelectorModal({
  visible,
  onClose,
  onSelectClient,
  colors,
  translations,
  clients = [],
  searchQuery = '',
  onSearchChange,
  currentFilter = '',
}) {
  const t = translations || {
    filterByClient: 'Filter by Client',
    searchClients: 'Search clients...',
    noClients: 'No clients found',
    noSearchResults: 'No clients match your search',
    clearFilter: 'Clear Filter',
  };

  const handleClose = () => {
    onSearchChange?.('');
    onClose?.();
  };

  const handleSelectClient = (clientName) => {
    onSelectClient?.(clientName);
    onSearchChange?.('');
    onClose?.();
  };

  const handleClearFilter = () => {
    onSelectClient?.('');
    onSearchChange?.('');
    onClose?.();
  };

  const filteredClients = clients.filter(client => 
    !searchQuery || 
    client.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    client.phone?.includes(searchQuery) ||
    client.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {t.filterByClient}
            </Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          
          {/* Search Input */}
          <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="search" size={20} color={colors.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: colors.textPrimary }]}
              placeholder={t.searchClients}
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={onSearchChange}
              autoFocus={true}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => onSearchChange?.('')}>
                <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Client List */}
          <ScrollView style={styles.clientList}>
            {(() => {
              if (filteredClients.length === 0 && clients.length === 0) {
                return (
                  <View style={styles.emptyState}>
                    <Ionicons name="people-outline" size={64} color={colors.textSecondary} />
                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                      {t.noClients}
                    </Text>
                  </View>
                );
              }
              
              if (filteredClients.length === 0) {
                return (
                  <View style={styles.emptyState}>
                    <Ionicons name="search-outline" size={64} color={colors.textSecondary} />
                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                      {t.noSearchResults}
                    </Text>
                  </View>
                );
              }
              
              return filteredClients.map((client, index) => (
                <TouchableOpacity
                  key={`client-${client.id || 'unknown'}-${index}-${client.name?.substring(0, 3) || 'x'}`}
                  style={[styles.clientItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
                  onPress={() => handleSelectClient(client.name)}
                >
                  <View style={styles.clientItemContent}>
                    <Ionicons name="person-circle-outline" size={40} color={colors.primary} />
                    <View style={styles.clientInfo}>
                      <Text style={[styles.clientName, { color: colors.textPrimary }]}>
                        {client.name}
                      </Text>
                      {client.phone && (
                        <Text style={[styles.clientDetail, { color: colors.textSecondary }]}>
                          <Ionicons name="call" size={12} /> {client.phone}
                        </Text>
                      )}
                      {client.email && (
                        <Text style={[styles.clientDetail, { color: colors.textSecondary }]}>
                          <Ionicons name="mail" size={12} /> {client.email}
                        </Text>
                      )}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              ));
            })()}
          </ScrollView>
          
          {/* Clear Filter Button */}
          <TouchableOpacity
            style={[styles.clearFilterButton, { backgroundColor: colors.error }]}
            onPress={handleClearFilter}
          >
            <Text style={styles.clearFilterButtonText}>{t.clearFilter}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.h2,
    fontWeight: 'bold',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.body,
    paddingVertical: spacing.xs,
  },
  clientList: {
    flex: 1,
    marginBottom: spacing.md,
  },
  clientItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
  },
  clientItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  clientInfo: {
    flex: 1,
  },
  clientName: {
    fontSize: typography.body,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  clientDetail: {
    fontSize: typography.small,
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    fontSize: typography.body,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  clearFilterButton: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  clearFilterButtonText: {
    color: 'white',
    fontSize: typography.body,
    fontWeight: 'bold',
  },
});
