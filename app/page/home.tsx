import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Receipt, Group } from '../types/Item';
import { ApiService } from '../../lib/services/api';
import { useCamera } from '../../lib/hooks/useCamera';
import { useRouter } from 'expo-router';

export default function Home() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const { takePhoto } = useCamera();
  const router = useRouter();

  const fetchData = async () => {
    try {
      setIsLoading(true);
      
      const receiptsResponse = await ApiService.getReceipts(selectedGroup?.id);
      setReceipts(receiptsResponse.items);
      
      const groupsResponse = await ApiService.getGroups();
      setGroups(groupsResponse.items);
      
      // Auto-select first group if none selected and groups exist
      if (!selectedGroup && groupsResponse.items.length > 0) {
        setSelectedGroup(groupsResponse.items[0]);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      Alert.alert('Error', `Failed to fetch data: ${errorMessage}. Please try again.`);
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleGroupSelect = async (group: Group) => {
    setSelectedGroup(group);
    setShowDropdown(false);
    
    // Refetch receipts for the selected group
    try {
      setIsLoading(true);
      const receiptsResponse = await ApiService.getReceipts(group.id);
      setReceipts(receiptsResponse.items);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      Alert.alert('Error', `Failed to fetch receipts for group: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleShopPress = (receipt: Receipt) => {
    const groupParam = selectedGroup ? `&groupId=${encodeURIComponent(selectedGroup.id)}` : '';
    router.push(`/page/receipt-details?receiptId=${receipt.id}${groupParam}`);
  };

  const handleAddReceipt = async () => {
    try {
      setIsUploading(true);
      const photoUri = await takePhoto();
      
      if (photoUri) {
        await ApiService.uploadReceiptPhoto(photoUri);
        await fetchData();
        Alert.alert('Success', 'Receipt added successfully!');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to add receipt. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };


  const renderShopCard = ({ item }: { item: Receipt }) => (
    <TouchableOpacity
      style={styles.shopCard}
      onPress={() => handleShopPress(item)}
      activeOpacity={0.7}
    >
      <Text style={styles.shopName}>{item.shop_name}</Text>
      <Text style={styles.shopDate}>
        {new Date(item.created_at).toLocaleDateString()}
      </Text>
      <Text style={styles.itemCount}>
        {item.receipt_items.length} items
      </Text>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateTitle}>No receipts yet</Text>
      <Text style={styles.emptyStateSubtitle}>
        Pull down to refresh and check for new receipts
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>SettleDown</Text>
      </View>

      {/* Group Dropdown */}
      <View style={styles.dropdownContainer}>
        <TouchableOpacity
          style={styles.dropdown}
          onPress={() => {
            setShowDropdown(!showDropdown);
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.dropdownText}>
            {selectedGroup ? selectedGroup.name : 'Select Group'}
          </Text>
          <Text style={styles.dropdownArrow}>{showDropdown ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        
        {showDropdown && (
          <View style={styles.dropdownOptions}>
            {groups.map((group) => (
              <TouchableOpacity
                key={group.id}
                style={[
                  styles.dropdownOption,
                  selectedGroup?.id === group.id && styles.selectedOption
                ]}
                onPress={() => handleGroupSelect(group)}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.dropdownOptionText,
                  selectedGroup?.id === group.id && styles.selectedOptionText
                ]}>
                  {group.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Content */}
      {isLoading && receipts.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007aff" />
          <Text style={styles.loadingText}>Loading receipts...</Text>
        </View>
      ) : (
        <FlatList
          data={receipts}
          renderItem={renderShopCard}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmptyState}
          refreshing={refreshing}
          onRefresh={onRefresh}
          showsVerticalScrollIndicator={false}
        />
      )}


      {/* Floating Add Button */}
      <TouchableOpacity
        style={[styles.addButton, isUploading && styles.addButtonDisabled]}
        onPress={handleAddReceipt}
        disabled={isUploading}
        activeOpacity={0.8}
      >
        {isUploading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.addButtonText}>+</Text>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    backgroundColor: '#fff',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1c1c1e',
    fontFamily: 'System',
    textAlign: 'center',
  },
  dropdownContainer: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    elevation: 3,
    zIndex: 1000,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  dropdownText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1c1c1e',
    flex: 1,
  },
  dropdownArrow: {
    fontSize: 12,
    color: '#8e8e93',
    fontWeight: '600',
  },
  dropdownOptions: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    borderTopWidth: 1,
    borderTopColor: '#f2f2f7',
    maxHeight: 200,
  },
  dropdownOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f7',
  },
  dropdownOptionText: {
    fontSize: 15,
    color: '#1c1c1e',
  },
  selectedOption: {
    backgroundColor: '#f2f7ff',
  },
  selectedOptionText: {
    color: '#007aff',
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#8e8e93',
  },
  listContent: {
    padding: 16,
  },
  shopCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    elevation: 3,
  },
  shopName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1c1c1e',
    marginBottom: 4,
  },
  shopDate: {
    fontSize: 14,
    color: '#8e8e93',
    marginBottom: 4,
  },
  itemCount: {
    fontSize: 14,
    color: '#007aff',
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#8e8e93',
    marginBottom: 8,
    fontFamily: 'System',
  },
  emptyStateSubtitle: {
    fontSize: 16,
    color: '#aeaeb2',
    textAlign: 'center',
    lineHeight: 22,
    fontFamily: 'System',
  },
  addButton: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#007aff',
    justifyContent: 'center',
    alignItems: 'center',
    boxShadow: '0 4px 8px rgba(0, 122, 255, 0.3)',
    elevation: 8,
  },
  addButtonDisabled: {
    backgroundColor: '#8e8e93',
  },
  addButtonText: {
    fontSize: 32,
    color: '#fff',
    fontWeight: '300',
    lineHeight: 32,
  },
});