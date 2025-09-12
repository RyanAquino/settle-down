import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Receipt, ReceiptItem, User } from '../types/Item';
import { ApiService } from '../../lib/services/api';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { API_ENDPOINTS } from '../../lib/config/env';

export default function ReceiptDetails() {
  const router = useRouter();
  const { receiptId, groupId } = useLocalSearchParams();
  
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<{[itemId: number]: number | null}>({});
  const [editedPrices, setEditedPrices] = useState<{[itemId: number]: string}>({});
  const [editedQuantities, setEditedQuantities] = useState<{[itemId: number]: string}>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchReceiptDetails();
  }, [receiptId]);

  const fetchReceiptDetails = async () => {
    try {
      setIsLoading(true);
      const [receiptsResponse, usersResponse] = await Promise.all([
        ApiService.getReceipts(),
        ApiService.getUsers(typeof groupId === 'string' ? groupId : undefined)
      ]);

      const foundReceipt = receiptsResponse.items.find(r => r.id.toString() === receiptId);
      if (foundReceipt) {
        // Fetch each receipt item individually
        const receiptItemsPromises = foundReceipt.receipt_items.map(item =>
          ApiService.getReceiptItem(item.id)
        );

        const detailedReceiptItems = await Promise.all(receiptItemsPromises);

        // Update the receipt with the detailed items
        const updatedReceipt = {
          ...foundReceipt,
          receipt_items: detailedReceiptItems
        };

        setReceipt(updatedReceipt);
        
        // Pre-select users based on member_id
        const initialSelectedUsers: {[itemId: number]: number | null} = {};
        updatedReceipt.receipt_items.forEach(item => {
          if (item.member_id) {
            // Find user with matching member_id
            const matchingUser = usersResponse.items.find(user => user.username === item.member_id);
            if (matchingUser) {
              initialSelectedUsers[item.id] = matchingUser.id;
            }
          }
        });
        setSelectedUsers(initialSelectedUsers);
      }

      setUsers(usersResponse.items);
    } catch (error) {
      Alert.alert('Error', 'Failed to fetch receipt details. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePriceChange = (itemId: number, newPrice: string) => {
    setEditedPrices(prev => ({
      ...prev,
      [itemId]: newPrice
    }));
  };

  const handleQuantityChange = (itemId: number, newQuantity: string) => {
    setEditedQuantities(prev => ({
      ...prev,
      [itemId]: newQuantity
    }));
  };

  const getDisplayPrice = (item: ReceiptItem) => {
    return editedPrices[item.id] !== undefined ? editedPrices[item.id] : item.cost.toString();
  };

  const getDisplayQuantity = (item: ReceiptItem) => {
    return editedQuantities[item.id] !== undefined ? editedQuantities[item.id] : item.quantity.toString();
  };

  const handleUserSelection = (itemId: number, userId: number | null) => {
    setSelectedUsers(prev => ({
      ...prev,
      [itemId]: userId
    }));
  };

  const getUserDisplayName = (user: User) => {
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`;
    } else if (user.first_name) {
      return user.first_name;
    } else if (user.last_name) {
      return user.last_name;
    } else {
      return user.username;
    }
  };

  const handleSave = async () => {
    if (!receipt || (Object.keys(editedPrices).length === 0 && Object.keys(selectedUsers).length === 0 && Object.keys(editedQuantities).length === 0)) {
      router.back();
      return;
    }

    try {
      setIsSaving(true);
      
      const updatePromises: Promise<void>[] = [];
      
      // Update prices
      Object.entries(editedPrices).forEach(([itemIdStr, priceStr]) => {
        const itemId = parseInt(itemIdStr);
        const price = parseFloat(priceStr);
        
        const originalItem = receipt.receipt_items.find(item => item.id === itemId);
        if (!isNaN(price) && originalItem && originalItem.cost !== price) {
          updatePromises.push(ApiService.updateReceiptItemCost(itemId, price));
        }
      });

      // Update quantities
      Object.entries(editedQuantities).forEach(([itemIdStr, quantityStr]) => {
        const itemId = parseInt(itemIdStr);
        const quantity = parseInt(quantityStr);
        
        const originalItem = receipt.receipt_items.find(item => item.id === itemId);
        if (!isNaN(quantity) && originalItem && originalItem.quantity !== quantity) {
          updatePromises.push(ApiService.updateReceiptItemQuantity(itemId, quantity));
        }
      });

      // Update owners
      Object.entries(selectedUsers).forEach(([itemIdStr, userId]) => {
        const itemId = parseInt(itemIdStr);
        const originalItem = receipt.receipt_items.find(item => item.id === itemId);
        
        if (originalItem && originalItem.owner !== userId) {
          updatePromises.push(ApiService.updateReceiptItemOwner(itemId, userId));
        }
      });

      await Promise.all(updatePromises);
      
      // Refresh receipt data to show updated values
      await fetchReceiptDetails();
      
      // Clear only the edited states, selectedUsers will be reset by fetchReceiptDetails
      setEditedPrices({});
      setEditedQuantities({});
      
      // Show success message without navigating back
      Alert.alert('Success', 'Changes saved successfully!');
      
    } catch (error) {
      Alert.alert('Error', 'Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const openImageModal = () => {
    setImageModalVisible(true);
  };

  const closeImageModal = () => {
    setImageModalVisible(false);
  };


  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007aff" />
          <Text style={styles.loadingText}>Loading receipt details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!receipt) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Receipt not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{receipt.shop_name}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView 
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 20}
      >
        <ScrollView 
          style={styles.content}
          contentContainerStyle={styles.scrollContentContainer}
          keyboardShouldPersistTaps="handled"
        >
          {/* Receipt Image */}
          {receipt.receipt_file && (
            <View style={styles.imageContainer}>
              <Text style={styles.imageLabel}>Receipt Image</Text>
              <TouchableOpacity onPress={openImageModal} activeOpacity={0.8} style={styles.imageWrapper}>
                <Image
                  source={{ 
                    uri: `${API_ENDPOINTS.MEDIA_BASE_URL}${receipt.receipt_file}`,
                    cache: 'reload'
                  }}
                  style={styles.receiptImage}
                  resizeMode="cover"
                />
                <View style={styles.imageOverlay}>
                  <Text style={styles.imageHint}>Tap to view full size</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}
          
          {/* Receipt Items */}
          <View style={styles.itemsContainer}>
            {receipt.receipt_items.map((item) => (
              <View key={item.id} style={styles.receiptItemContainer}>
                <View style={styles.receiptItem}>
                  <View style={styles.receiptItemInfo}>
                    <Text style={styles.receiptItemName}>{item.en_name}</Text>
                    <Text style={styles.receiptItemNameJp}>{item.jp_name}</Text>
                    <View style={styles.quantityContainer}>
                      <Text style={styles.quantityLabel}>Qty:</Text>
                      <TextInput
                        style={styles.quantityInput}
                        value={getDisplayQuantity(item)}
                        onChangeText={(text) => handleQuantityChange(item.id, text)}
                        keyboardType="number-pad"
                        placeholder={item.quantity.toString()}
                      />
                    </View>
                  </View>
                  <View style={styles.priceContainer}>
                    <Text style={styles.currencySymbol}>¥</Text>
                    <TextInput
                      style={styles.priceInput}
                      value={getDisplayPrice(item)}
                      onChangeText={(text) => handlePriceChange(item.id, text)}
                      keyboardType="decimal-pad"
                      placeholder={item.cost.toString()}
                    />
                  </View>
                </View>
                
                {/* User Radio Buttons */}
                {users.length > 0 && (
                  <View style={styles.radioContainer}>
                    {users.map((user) => (
                      <TouchableOpacity
                        key={user.id}
                        style={styles.radioOption}
                        onPress={() => handleUserSelection(item.id, user.id)}
                      >
                        <View style={styles.radioCircle}>
                          {selectedUsers[item.id] === user.id && <View style={styles.radioSelected} />}
                        </View>
                        <Text style={styles.radioLabel}>{getUserDisplayName(user)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        </ScrollView>
        
        {/* Save Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isSaving}
            activeOpacity={0.8}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Full Size Image Modal */}
      {receipt?.receipt_file && (
        <Modal
          animationType="fade"
          transparent={true}
          visible={imageModalVisible}
          onRequestClose={closeImageModal}
        >
          <View style={styles.fullImageOverlay}>
            <TouchableOpacity
              style={styles.fullImageCloseArea}
              onPress={closeImageModal}
              activeOpacity={1}
            >
              <Image
                source={{ uri: `${API_ENDPOINTS.MEDIA_BASE_URL}${receipt.receipt_file}` }}
                style={styles.fullImage}
                resizeMode="contain"
              />
            </TouchableOpacity>
            
            <TouchableOpacity onPress={closeImageModal} style={styles.fullImageCloseButton}>
              <Text style={styles.fullImageCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
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
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1c1c1e',
    flex: 1,
    textAlign: 'center',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#f2f2f7',
  },
  backButtonText: {
    fontSize: 16,
    color: '#007aff',
    fontWeight: '500',
  },
  headerSpacer: {
    width: 80,
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    color: '#8e8e93',
    marginBottom: 20,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingBottom: 20,
  },
  imageContainer: {
    padding: 16,
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 12,
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    elevation: 3,
  },
  imageLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1c1c1e',
    marginBottom: 12,
    textAlign: 'center',
  },
  imageWrapper: {
    width: '100%',
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f8f9fa',
  },
  receiptImage: {
    width: '100%',
    height: 250,
    backgroundColor: '#f0f0f0',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  imageHint: {
    fontSize: 12,
    color: '#fff',
    textAlign: 'center',
    fontWeight: '500',
  },
  itemsContainer: {
    padding: 16,
  },
  receiptItemContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    elevation: 3,
  },
  receiptItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f7',
    marginBottom: 12,
  },
  receiptItemInfo: {
    flex: 1,
  },
  receiptItemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1c1c1e',
    marginBottom: 2,
  },
  receiptItemNameJp: {
    fontSize: 14,
    color: '#8e8e93',
    marginBottom: 2,
  },
  receiptItemQuantity: {
    fontSize: 12,
    color: '#aeaeb2',
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  quantityLabel: {
    fontSize: 12,
    color: '#aeaeb2',
    marginRight: 4,
  },
  quantityInput: {
    fontSize: 12,
    fontWeight: '500',
    color: '#007aff',
    backgroundColor: '#f8f9fa',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 30,
    textAlign: 'center',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
    paddingHorizontal: 8,
    minWidth: 80,
  },
  currencySymbol: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007aff',
    marginRight: 4,
  },
  priceInput: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007aff',
    textAlign: 'right',
    flex: 1,
    paddingVertical: 4,
  },
  radioContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
    marginBottom: 8,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#007aff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  radioSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#007aff',
  },
  radioLabel: {
    fontSize: 14,
    color: '#1c1c1e',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e1e5e9',
    backgroundColor: '#fff',
  },
  saveButton: {
    backgroundColor: '#007aff',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    boxShadow: '0 4px 8px rgba(0, 122, 255, 0.3)',
    elevation: 8,
  },
  saveButtonDisabled: {
    backgroundColor: '#8e8e93',
    boxShadow: '0 4px 8px rgba(142, 142, 147, 0.3)',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  fullImageOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImageCloseArea: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  fullImageCloseButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImageCloseText: {
    fontSize: 20,
    color: '#fff',
    fontWeight: '500',
  },
});