import React from 'react';
import { Modal, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { borderRadius, getColors, spacing, typography } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import AppButton from './AppButton';
import AppIcon from './AppIcon';
import AppText from './AppText';

export default function ClientSelectorModal({
  visible,
  onClose,
  onSelectClient,
  colors,
  translations = {},
  clients = [],
  searchQuery = '',
  onSearchChange,
  currentFilter,
}) {
  const { isDarkMode } = useThemeContext();
  const palette = colors || getColors(isDarkMode);

  const t = {
    title: translations.filterByClient || 'Filter by client',
    search: translations.searchClients || 'Search clients',
    noClients: translations.noClients || 'No clients found',
    noResults: translations.noSearchResults || 'No matching clients',
    clear: translations.clearFilter || 'Clear filter',
    close: translations.close || 'Close',
  };

  const normalized = searchQuery.trim().toLowerCase();
  const filteredClients = (clients || []).filter((client) => {
    const name = String(client?.name || '').toLowerCase();
    const phone = String(client?.phone || '').toLowerCase();
    const email = String(client?.email || '').toLowerCase();
    return !normalized || name.includes(normalized) || phone.includes(normalized) || email.includes(normalized);
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <View style={[styles.modalCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.header}>
            <AppText variant="heading">{t.title}</AppText>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <AppIcon name="close" size={18} color={palette.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={[styles.searchWrap, { borderColor: palette.border, backgroundColor: palette.background }]}>
            <AppIcon name="search-outline" size={18} color={palette.textLight} />
            <TextInput
              value={searchQuery}
              onChangeText={onSearchChange}
              placeholder={t.search}
              placeholderTextColor={palette.textLight}
              style={[styles.searchInput, { color: palette.textPrimary }]}
            />
          </View>

          <TouchableOpacity
            onPress={() => {
              onSelectClient?.('');
              onClose?.();
            }}
            style={[styles.clearRow, { borderColor: palette.border }]}
          >
            <AppIcon name="close-circle" size={18} color={palette.textSecondary} />
            <AppText variant="caption" color={palette.textSecondary}>
              {t.clear}
            </AppText>
          </TouchableOpacity>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {filteredClients.length === 0 ? (
              <AppText variant="caption" color={palette.textLight} style={styles.emptyText}>
                {searchQuery ? t.noResults : t.noClients}
              </AppText>
            ) : (
              filteredClients.map((client) => {
                const name = client?.name || '-';
                const selected = currentFilter === name;
                return (
                  <TouchableOpacity
                    key={client.id || `${name}-${client.phone || client.email}`}
                    style={[
                      styles.item,
                      {
                        borderColor: selected ? palette.secondary : palette.border,
                        backgroundColor: selected ? `${palette.secondary}15` : palette.backgroundLight,
                      },
                    ]}
                    onPress={() => {
                      onSelectClient?.(name);
                      onClose?.();
                    }}
                  >
                    <View style={styles.itemMain}>
                      <AppText variant="bodyStrong">{name}</AppText>
                      {client.phone ? (
                        <AppText variant="caption" color={palette.textSecondary}>
                          {client.phone}
                        </AppText>
                      ) : null}
                    </View>
                    {selected ? <AppIcon name="checkmark-circle" size={18} color={palette.secondary} /> : null}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          <AppButton title={t.close} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '82%',
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  searchWrap: {
    borderWidth: 1.2,
    borderRadius: borderRadius.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.base,
    paddingVertical: spacing.sm,
  },
  clearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: spacing.sm,
  },
  item: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemMain: {
    flex: 1,
    gap: spacing.xs,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
