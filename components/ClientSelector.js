/**
 * ClientSelector.js - Embeddable client search/select component
 * 
 * Designed to sit INSIDE a parent card/section (no outer container).
 * Shows a search bar + dropdown results. When a client is selected,
 * shows a selected badge. Manual fields are rendered by the parent form.
 * New clients are auto-saved on form submit (handled by parent forms).
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Keyboard,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing, borderRadius, typography } from '../theme';

/**
 * ClientSelector Component (embeddable — no outer card)
 * 
 * @param {Object} props
 * @param {Array} props.clients - Array of client objects from cache
 * @param {Function} props.onSelect - Callback when a client is selected: (client) => void
 * @param {Object|null} props.selectedClient - Currently selected client (or null)
 * @param {Function} props.onClear - Callback to clear selection
 * @param {Object} props.colors - Theme colors
 * @param {string} props.language - Current language (en/he/ar)
 */
export default function ClientSelector({
  clients = [],
  onSelect,
  selectedClient = null,
  onClear,
  colors,
  language = 'en',
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const t = language === 'en' ? {
    searchClients: 'Search existing clients...',
    noClients: 'No clients found',
    tapToChange: 'Tap to change',
    selected: 'Selected',
  } : language === 'he' ? {
    searchClients: 'חפש לקוחות קיימים...',
    noClients: 'לא נמצאו לקוחות',
    tapToChange: 'לחץ לשינוי',
    selected: 'נבחר',
  } : {
    searchClients: 'ابحث عن عملاء حاليين...',
    noClients: 'لم يتم العثور على عملاء',
    tapToChange: 'اضغط للتغيير',
    selected: 'تم الاختيار',
  };

  // Filter clients by search query (only show results when user types)
  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return clients.filter(client =>
      (client.name && client.name.toLowerCase().includes(q)) ||
      (client.phone && client.phone.toLowerCase().includes(q)) ||
      (client.email && client.email.toLowerCase().includes(q)) ||
      (client.id && client.id.toString().includes(q))
    );
  }, [clients, searchQuery]);

  const handleSelectClient = (client) => {
    Keyboard.dismiss();
    setSearchQuery('');
    if (onSelect) onSelect(client);
  };

  const handleClearSelection = () => {
    if (onClear) onClear();
  };

  // If a client is selected, show the selected client badge
  if (selectedClient) {
    return (
      <TouchableOpacity
        style={[styles.selectedClientCard, { 
          backgroundColor: colors.backgroundLight, 
          borderColor: colors.secondary 
        }]}
        onPress={handleClearSelection}
        activeOpacity={0.7}
      >
        <View style={[styles.selectedIconContainer, { backgroundColor: colors.secondary + '20' }]}>
          <MaterialCommunityIcons name="account-circle" size={36} color={colors.secondary} />
        </View>
        <View style={styles.selectedClientInfo}>
          <Text style={[styles.selectedClientName, { color: colors.textPrimary }]}>
            {selectedClient.name}
          </Text>
          {selectedClient.phone ? (
            <Text style={[styles.selectedClientDetail, { color: colors.textSecondary }]}>
              📞 {selectedClient.phone}
            </Text>
          ) : null}
          {selectedClient.email ? (
            <Text style={[styles.selectedClientDetail, { color: colors.textSecondary }]}>
              ✉️ {selectedClient.email}
            </Text>
          ) : null}
        </View>
        <View style={styles.selectedActions}>
          <Ionicons name="close-circle" size={24} color={colors.error || '#EF4444'} />
          <Text style={[styles.tapToChangeText, { color: colors.textLight }]}>
            {t.tapToChange}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  // Show search bar + dropdown
  return (
    <View>
      {/* Search Bar */}
      <View style={[styles.searchContainer, { 
        backgroundColor: colors.backgroundLight, 
        borderColor: colors.border 
      }]}>
        <MaterialCommunityIcons name="book-account-outline" size={20} color={colors.secondary} />
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: colors.textPrimary }]}
          placeholder={t.searchClients}
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Client List (only shown when searching) */}
      {filteredClients.length > 0 ? (
        <View style={styles.clientsList}>
          {filteredClients.slice(0, 5).map((client, index) => (
            <TouchableOpacity
              key={`client-selector-${client.id}-${index}`}
              style={[styles.clientCard, { 
                backgroundColor: colors.background, 
                borderColor: colors.border 
              }]}
              onPress={() => handleSelectClient(client)}
              activeOpacity={0.7}
            >
              <View style={[styles.clientIcon, { backgroundColor: colors.secondary + '15' }]}>
                <MaterialCommunityIcons name="account" size={22} color={colors.secondary} />
              </View>
              <View style={styles.clientInfo}>
                <Text style={[styles.clientName, { color: colors.textPrimary }]} numberOfLines={1}>
                  {client.name}
                </Text>
                {client.phone ? (
                  <Text style={[styles.clientDetail, { color: colors.textSecondary }]} numberOfLines={1}>
                    📞 {client.phone}
                  </Text>
                ) : null}
              </View>
              <View style={[styles.clientIdBadge, { backgroundColor: colors.secondary + '15' }]}>
                <Text style={[styles.clientIdText, { color: colors.secondary }]}>#{client.id}</Text>
              </View>
            </TouchableOpacity>
          ))}
          {filteredClients.length > 5 && (
            <Text style={[styles.moreText, { color: colors.textLight }]}>
              +{filteredClients.length - 5} {language === 'en' ? 'more' : language === 'he' ? 'עוד' : 'المزيد'}...
            </Text>
          )}
        </View>
      ) : searchQuery.trim() && clients.length > 0 ? (
        <Text style={[styles.noClientsText, { color: colors.textSecondary }]}>
          {t.noClients}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    height: 44,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.sm,
    paddingVertical: 0,
  },
  
  // Client list
  clientsList: {
    marginBottom: spacing.xs,
  },
  clientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginBottom: spacing.xs,
  },
  clientIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  clientInfo: {
    flex: 1,
  },
  clientName: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  clientDetail: {
    fontSize: typography.xs,
    marginTop: 2,
  },
  clientIdBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  clientIdText: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
  },
  noClientsText: {
    textAlign: 'center',
    fontSize: typography.sm,
    paddingVertical: spacing.xs,
  },
  moreText: {
    textAlign: 'center',
    fontSize: typography.xs,
    paddingVertical: spacing.xs,
  },

  // Selected client badge
  selectedClientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 2,
    marginBottom: spacing.sm,
  },
  selectedIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  selectedClientInfo: {
    flex: 1,
  },
  selectedClientName: {
    fontSize: typography.sm,
    fontWeight: typography.bold,
  },
  selectedClientDetail: {
    fontSize: typography.xs,
    marginTop: 2,
  },
  selectedActions: {
    alignItems: 'center',
    gap: 2,
  },
  tapToChangeText: {
    fontSize: 9,
    fontStyle: 'italic',
  },
});
