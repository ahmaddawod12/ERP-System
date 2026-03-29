import React, { useMemo, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { borderRadius, getColors, spacing, typography, type ColorPalette } from '../theme';
import { useThemeContext } from '../contexts/ThemeContext';
import AppIcon from './AppIcon';
import AppText from './AppText';
import type { Client, Language } from '../types';

const getClientLabel = (client: Client | null | undefined): string => client?.name || client?.email || client?.phone || '';

export interface ClientSelectorProps {
  clients?: Client[];
  onSelect?: (client: Client) => void;
  selectedClient?: Client | null;
  onClear?: () => void;
  colors?: ColorPalette;
  language?: Language;
}

export default function ClientSelector({
  clients = [],
  onSelect,
  selectedClient,
  onClear,
  colors,
  language = 'en',
}: ClientSelectorProps) {
  const { isDarkMode } = useThemeContext();
  const palette = colors || getColors(isDarkMode);
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);

  const t =
    language === 'he'
      ? {
          search: 'חפש לקוח',
          clear: 'נקה',
          noResults: 'לא נמצאו לקוחות',
          selected: 'לקוח נבחר',
        }
      : language === 'ar'
        ? {
            search: 'ابحث عن عميل',
            clear: 'مسح',
            noResults: 'لا يوجد عملاء',
            selected: 'العميل المحدد',
          }
        : {
            search: 'Search client',
            clear: 'Clear',
            noResults: 'No clients found',
            selected: 'Selected client',
          };

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return clients
      .filter((client) => {
        const name = String(client?.name || '').toLowerCase();
        const phone = String(client?.phone || '').toLowerCase();
        const email = String(client?.email || '').toLowerCase();
        return name.includes(normalized) || phone.includes(normalized) || email.includes(normalized);
      })
      .slice(0, 6);
  }, [clients, query]);

  return (
    <View style={styles.container}>
      <View style={[styles.inputWrap, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <AppIcon name="search-outline" size={18} color={palette.textLight} />
        <TextInput
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            setShowResults(true);
          }}
          onFocus={() => setShowResults(true)}
          placeholder={t.search}
          placeholderTextColor={palette.textLight}
          style={[styles.input, { color: palette.textPrimary }]}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {(query || selectedClient) && (
          <TouchableOpacity
            onPress={() => {
              setQuery('');
              setShowResults(false);
              onClear?.();
            }}
            style={styles.clearButton}
          >
            <AppText variant="caption" color={palette.secondary}>
              {t.clear}
            </AppText>
          </TouchableOpacity>
        )}
      </View>

      {selectedClient ? (
        <View style={[styles.selectedPill, { backgroundColor: `${palette.secondary}20`, borderColor: `${palette.secondary}50` }]}>
          <AppIcon name="checkmark-circle" size={16} color={palette.secondary} />
          <AppText variant="caption" color={palette.secondary}>
            {t.selected}: {getClientLabel(selectedClient)}
          </AppText>
        </View>
      ) : null}

      {showResults && query.trim().length > 0 ? (
        <View style={[styles.results, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {filtered.length === 0 ? (
            <AppText variant="caption" color={palette.textLight} style={styles.noResults}>
              {t.noResults}
            </AppText>
          ) : (
            filtered.map((client) => (
              <TouchableOpacity
                key={client.id || `${client.name}-${client.phone || client.email}`}
                style={[styles.resultItem, { borderBottomColor: palette.borderLight }]}
                onPress={() => {
                  onSelect?.(client);
                  setQuery(getClientLabel(client));
                  setShowResults(false);
                }}
              >
                <AppText variant="bodyStrong">{client.name || '-'}</AppText>
                {client.phone ? (
                  <AppText variant="caption" color={palette.textSecondary}>
                    {client.phone}
                  </AppText>
                ) : null}
              </TouchableOpacity>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  inputWrap: {
    borderWidth: 1.3,
    borderRadius: borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: typography.base,
    paddingVertical: spacing.sm,
  },
  clearButton: {
    paddingVertical: spacing.xs,
    paddingLeft: spacing.xs,
  },
  selectedPill: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderRadius: borderRadius.pill,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  results: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  resultItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth + 0.4,
    gap: spacing.xs,
  },
  noResults: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
});
