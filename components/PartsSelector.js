import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Platform,
} from 'react-native';

const PartsSelector = ({
  inventory,
  selectedParts,
  searchQuery,
  onSearchChange,
  onAddPart,
  onRemovePart,
  onQuantityChange,
  translations,
  isDarkMode,
}) => {
  console.log('PartsSelector rendering:', {
    inventoryCount: inventory.length,
    selectedPartsCount: selectedParts.length,
    searchQuery
  });

  const filteredParts = inventory.filter(part =>
    part.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  console.log('Filtered parts count:', filteredParts.length);

  const renderPartItem = ({ item: part }) => {
    const selectedPart = selectedParts.find(p => p.id === part.id);
    const isSelected = !!selectedPart;

    return (
      <View style={[styles.partItem, isDarkMode && styles.partItemDark]}>
        <View style={styles.partInfo}>
          <Text style={[styles.partItemName, isDarkMode && styles.textDark]}>
            {part.name}
          </Text>
          <Text style={[styles.partItemAvailable, isDarkMode && styles.textSecondaryDark]}>
            {translations.available}: {part.quantity}
          </Text>
        </View>

        {isSelected ? (
          <View style={styles.partQuantityRow}>
            <TextInput
              style={[styles.quantityInput, isDarkMode && styles.quantityInputDark]}
              value={String(selectedPart.usedQuantity)}
              onChangeText={(text) => onQuantityChange(part.id, text)}
              keyboardType="numeric"
              placeholder="Qty"
              placeholderTextColor={isDarkMode ? '#9ca3af' : '#6b7280'}
            />
            <TouchableOpacity
              style={styles.removePartButton}
              onPress={() => onRemovePart(part.id)}
            >
              <Text style={styles.removePartText}>{translations.remove}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addPartButton}
            onPress={() => onAddPart(part)}
          >
            <Text style={styles.addPartText}>+</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <TextInput
        style={[styles.searchInput, isDarkMode && styles.searchInputDark]}
        placeholder={translations.searchParts || "Search parts..."}
        placeholderTextColor={isDarkMode ? '#9ca3af' : '#6b7280'}
        value={searchQuery}
        onChangeText={onSearchChange}
      />

      {filteredParts.length === 0 ? (
        <Text style={[styles.emptyText, isDarkMode && styles.textSecondaryDark]}>
          {translations.noParts}
        </Text>
      ) : (
        <FlatList
          data={filteredParts}
          renderItem={renderPartItem}
          keyExtractor={(item) => String(item.id)}
          extraData={selectedParts}
          style={styles.partsList}
          contentContainerStyle={styles.partsListContent}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={21}
          removeClippedSubviews={false}
          nestedScrollEnabled={true}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  searchInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    color: '#1f2937',
    backgroundColor: '#ffffff',
  },
  searchInputDark: {
    borderColor: '#4b5563',
    backgroundColor: '#374151',
    color: '#f9fafb',
  },
  partsList: {
    flex: 1,
  },
  partsListContent: {
    paddingBottom: 20,
  },
  partItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    minHeight: 80,
  },
  partItemDark: {
    borderBottomColor: '#4b5563',
    backgroundColor: '#1f2937',
  },
  partInfo: {
    flex: 1,
    marginRight: 12,
  },
  partItemName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 6,
  },
  partItemAvailable: {
    fontSize: 16,
    color: '#6b7280',
  },
  textDark: {
    color: '#f9fafb',
  },
  textSecondaryDark: {
    color: '#9ca3af',
  },
  partQuantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quantityInput: {
    borderWidth: 2,
    borderColor: '#00ACC1',
    borderRadius: 10,
    padding: 14,
    width: 80,
    height: 50,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    backgroundColor: '#ffffff',
    color: '#1f2937',
  },
  quantityInputDark: {
    borderColor: '#00ACC1',
    backgroundColor: '#374151',
    color: '#f9fafb',
  },
  removePartButton: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    height: 50,
    justifyContent: 'center',
  },
  removePartText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  addPartButton: {
    backgroundColor: '#10b981',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPartText: {
    color: 'white',
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 36,
  },
  emptyText: {
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 16,
    marginTop: 40,
  },
});

export default PartsSelector;
