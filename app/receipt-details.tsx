import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Modal, FlatList, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useState, useEffect } from 'react';

interface ReceiptItem {
  english_name: string;
  japanese_name: string;
  item_order: number;
  cost: number;
  quantity: number;Ca
  discount: number;
}

interface ReceiptData {
  receipt_items: ReceiptItem[];
  en_shop_name: string;
  jp_shop_name: string;
  tax_amount: number;
  total_amount: number;
}

interface SettleUpGroup {
  name: string;
  id: string;
}

interface SettleUpGroupsResponse {
  items: SettleUpGroup[];
  count: number;
}

interface GroupUser {
  name: string;
  id: string;
}

interface GroupUsersResponse {
  items: GroupUser[];
  count: number;
}

export default function ReceiptDetailsScreen() {
  const params = useLocalSearchParams();
  const [editableItems, setEditableItems] = useState<ReceiptItem[]>([]);
  const [originalTaxAmount, setOriginalTaxAmount] = useState(0);
  const [editableTaxAmount, setEditableTaxAmount] = useState(0);
  const [shopInfo, setShopInfo] = useState({ en_shop_name: '', jp_shop_name: '' });
  const [groups, setGroups] = useState<SettleUpGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [groupUsers, setGroupUsers] = useState<GroupUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [userSelections, setUserSelections] = useState<{[itemIndex: number]: string}>({});
  const [paidByUserId, setPaidByUserId] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);

  const mockReceiptData: ReceiptData = {
    receipt_items: [
      {
        english_name: "CRANBERRY",
        japanese_name: "クランベリー",
        item_order: 1,
        cost: 605,
        quantity: 1,
        discount: 0
      },
      {
        english_name: "(M)ST SHAKE",
        japanese_name: "MSTシェイク",
        item_order: 2,
        cost: 847,
        quantity: 1,
        discount: 0
      },
      {
        english_name: "CHEESE RISOTTO",
        japanese_name: "チーズリゾット",
        item_order: 3,
        cost: 1408,
        quantity: 1,
        discount: 0
      },
      {
        english_name: "CAESAR SALAD",
        japanese_name: "シーザーサラダ",
        item_order: 4,
        cost: 1045,
        quantity: 1,
        discount: 0
      },
      {
        english_name: "T. BACON",
        japanese_name: "T.ベーコン",
        item_order: 5,
        cost: 385,
        quantity: 1,
        discount: 0
      },
      {
        english_name: "T. AVOCADO",
        japanese_name: "T.アボカド",
        item_order: 6,
        cost: 385,
        quantity: 1,
        discount: 0
      }
    ],
    en_shop_name: "LADOME",
    jp_shop_name: "ラドーム",
    tax_amount: 0,
    total_amount: 4675
  };

  let receiptData: ReceiptData | null = null;
  try {
    receiptData = params.data ? JSON.parse(params.data as string) : mockReceiptData;
  } catch (error) {
    // Failed to parse receipt data, using mock data
    receiptData = mockReceiptData;
  }

  const fetchSettleUpGroups = async () => {
    const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.242:8000';
    setIsLoadingGroups(true);
    setGroupsError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/settle-up/groups/`);
      if (response.ok) {
        const data: SettleUpGroupsResponse = await response.json();
        setGroups(data.items || []);
        if (data.items && data.items.length > 0) {
          // Set default selection to the last item
          const lastGroupId = data.items[data.items.length - 1].id;
          setSelectedGroupId(lastGroupId);
          // Fetch users for the default selected group
          fetchGroupUsers(lastGroupId);
        }
      } else {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      // Failed to fetch settle-up groups
      setGroupsError('Failed to load groups. Please try again.');
      setGroups([]);
    } finally {
      setIsLoadingGroups(false);
    }
  };

  const fetchGroupUsers = async (groupId: string) => {
    if (!groupId) return;

    const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.242:8000';
    setIsLoadingUsers(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/settle-up/users/?group_id=${groupId}`);
      if (response.ok) {
        const data: GroupUsersResponse = await response.json();
        setGroupUsers(data.items || []);
        // Clear previous user selections when switching groups
        setUserSelections({});
        setPaidByUserId('');
      } else {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      // Failed to fetch group users
      setGroupUsers([]);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (receiptData) {
      setEditableItems([...receiptData.receipt_items]);
      setOriginalTaxAmount(receiptData.tax_amount);
      setEditableTaxAmount(receiptData.tax_amount);
      setShopInfo({
        en_shop_name: receiptData.en_shop_name,
        jp_shop_name: receiptData.jp_shop_name
      });
    }
    fetchSettleUpGroups();
  }, []);


  if (!receiptData) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Failed to load receipt data</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const updateItemQuantity = (index: number, quantity: string) => {
    const newItems = [...editableItems];
    newItems[index].quantity = Math.max(0, parseInt(quantity) || 0);
    setEditableItems(newItems);
  };

  const updateItemCost = (index: number, cost: string) => {
    const newItems = [...editableItems];
    newItems[index].cost = Math.max(0, parseInt(cost) || 0);
    setEditableItems(newItems);
  };

  const calculateSubtotal = () => {
    return editableItems.reduce((total, item) => total + (item.cost * item.quantity) - item.discount, 0);
  };

  const calculateTotal = () => {
    return calculateSubtotal() + editableTaxAmount;
  };

  const updateTaxAmount = (tax: string) => {
    setEditableTaxAmount(Math.max(0, parseInt(tax) || 0));
  };

  const handleUserSelection = (itemIndex: number, userId: string) => {
    setUserSelections(prev => ({
      ...prev,
      [itemIndex]: userId
    }));
  };

  const getSelectedGroupName = () => {
    const selectedGroup = groups.find(group => group.id === selectedGroupId);
    return selectedGroup?.name || "Select a group...";
  };

  const handleGroupSelect = (groupId: string) => {
    setSelectedGroupId(groupId);
    setIsDropdownOpen(false);
  };

  const showGroupPicker = () => {
    if (groups.length === 0) {
      return;
    }
    setIsDropdownOpen(true);
  };

  const handleGroupSelection = (group: SettleUpGroup) => {
    setSelectedGroupId(group.id);
    setIsDropdownOpen(false);
    // Fetch users for the selected group
    fetchGroupUsers(group.id);
  };

  const closeDropdown = () => {
    setIsDropdownOpen(false);
  };

  const syncTransaction = async () => {
    // Validation
    if (!selectedGroupId) {
      Alert.alert('Error', 'Please select a settle-up group.');
      return;
    }

    if (!paidByUserId) {
      Alert.alert('Error', 'Please select who paid for this receipt.');
      return;
    }

    // Check if all items have been assigned to users
    const unassignedItems = editableItems.filter((_, index) => !userSelections[index]);
    if (unassignedItems.length > 0) {
      Alert.alert('Error', 'Please assign all receipt items to users.');
      return;
    }

    // Get unique user IDs (should be exactly 2 for this implementation)
    const assignedUserIds = Object.values(userSelections);
    const uniqueUserIds = [...new Set(assignedUserIds)];

    if (uniqueUserIds.length !== 2) {
      Alert.alert('Error', 'Items must be assigned to exactly 2 different users.');
      return;
    }

    setIsSyncing(true);

    try {
      // Calculate totals for each user
      const userTotals = uniqueUserIds.reduce((acc, userId) => {
        acc[userId] = 0;
        return acc;
      }, {} as {[userId: string]: number});

      // Sum up item costs for each user
      editableItems.forEach((item, index) => {
        const assignedUserId = userSelections[index];
        if (assignedUserId) {
          userTotals[assignedUserId] += (item.cost * item.quantity) - item.discount;
        }
      });

      const payingMemberTotal = userTotals[paidByUserId] || 0;
      const otherUserId = uniqueUserIds.find(id => id !== paidByUserId);
      const otherMemberTotal = userTotals[otherUserId!] || 0;

      const payload = {
        purpose: shopInfo.en_shop_name || shopInfo.jp_shop_name || 'Receipt',
        total_amount: calculateTotal(),
        tax_amount: editableTaxAmount,
        paying_member_id: paidByUserId,
        paying_member_total: payingMemberTotal,
        other_member_id: otherUserId!,
        other_member_total: otherMemberTotal,
        group_id: selectedGroupId
      };

      const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.242:8000';
      const response = await fetch(`${apiBaseUrl}/api/v1/settle-up/transactions/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        Alert.alert(
          'Success',
          'Transaction synced successfully!',
          [
            {
              text: 'OK',
              onPress: () => router.back()
            }
          ]
        );
      } else {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      // Sync failed
      Alert.alert('Error', 'Failed to sync transaction. Please try again.');
    } finally {
      setIsSyncing(false);
    }
  };

  const subtotal = calculateSubtotal();
  const total = calculateTotal();

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>← Back to Camera</Text>
        </TouchableOpacity>

        <View style={styles.shopInfo}>
          <Text style={styles.shopName}>
            {shopInfo.en_shop_name || shopInfo.jp_shop_name}
          </Text>
          {shopInfo.en_shop_name && shopInfo.jp_shop_name && (
            <Text style={styles.shopNameSecondary}>{shopInfo.jp_shop_name}</Text>
          )}
        </View>
      </View>

      <View style={styles.groupSection}>
        <Text style={styles.sectionTitle}>Select Settle-Up Group</Text>

        {groupsError ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{groupsError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={fetchSettleUpGroups}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.pickerContainer}>
            {isLoadingGroups ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#007AFF" />
                <Text style={styles.loadingText}>Loading groups...</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.groupPickerButton}
                onPress={showGroupPicker}
                disabled={isLoadingGroups || groups.length === 0}
              >
                <Text style={[
                  styles.groupPickerText,
                  selectedGroupId ? styles.groupPickerTextSelected : styles.groupPickerTextPlaceholder
                ]}>
                  {groups.length === 0 ? "No groups available" : getSelectedGroupName()}
                </Text>
                <Text style={styles.groupPickerArrow}>▼</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Paid By Section */}
      {groupUsers.length > 0 && (
        <View style={styles.paidBySection}>
          <Text style={styles.sectionTitle}>Paid By</Text>
          {isLoadingUsers ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.loadingText}>Loading users...</Text>
            </View>
          ) : (
            <View style={styles.radioButtonContainer}>
              {groupUsers.map((user) => (
                <TouchableOpacity
                  key={user.id}
                  style={styles.radioButton}
                  onPress={() => setPaidByUserId(user.id)}
                >
                  <View style={[
                    styles.radioCircle,
                    paidByUserId === user.id && styles.radioCircleSelected
                  ]}>
                    {paidByUserId === user.id && (
                      <View style={styles.radioInner} />
                    )}
                  </View>
                  <Text style={styles.radioButtonText}>{user.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      <View style={styles.itemsSection}>
        <Text style={styles.sectionTitle}>Receipt Items</Text>

        {editableItems
          .sort((a, b) => a.item_order - b.item_order)
          .map((item, index) => (
            <View key={index} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>
                  {item.english_name || item.japanese_name}
                </Text>
                {item.english_name && item.japanese_name && (
                  <Text style={styles.itemNameSecondary}>{item.japanese_name}</Text>
                )}

                <View style={styles.editableRow}>
                  <Text style={styles.label}>Qty:</Text>
                  <TextInput
                    style={styles.editableInput}
                    value={item.quantity.toString()}
                    onChangeText={(text) => updateItemQuantity(index, text)}
                    keyboardType="numeric"
                    selectTextOnFocus={true}
                  />
                </View>

                {item.discount > 0 && (
                  <Text style={styles.discount}>Discount: ¥{item.discount}</Text>
                )}

                {/* User Selection */}
                {groupUsers.length > 0 && (
                  <View style={styles.userSelectionContainer}>
                    <Text style={styles.userSelectionLabel}>Assign to:</Text>
                    {isLoadingUsers ? (
                      <ActivityIndicator size="small" color="#007AFF" />
                    ) : (
                      <View style={styles.radioButtonContainer}>
                        {groupUsers.map((user) => (
                          <TouchableOpacity
                            key={user.id}
                            style={styles.radioButton}
                            onPress={() => handleUserSelection(index, user.id)}
                          >
                            <View style={[
                              styles.radioCircle,
                              userSelections[index] === user.id && styles.radioCircleSelected
                            ]}>
                              {userSelections[index] === user.id && (
                                <View style={styles.radioInner} />
                              )}
                            </View>
                            <Text style={styles.radioButtonText}>{user.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </View>

              <View style={styles.priceContainer}>
                <Text style={styles.priceLabel}>¥</Text>
                <TextInput
                  style={styles.editablePriceInput}
                  value={item.cost.toString()}
                  onChangeText={(text) => updateItemCost(index, text)}
                  keyboardType="numeric"
                  selectTextOnFocus={true}
                />
              </View>
            </View>
          ))}
      </View>

      <View style={styles.summarySection}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal:</Text>
          <Text style={styles.summaryValue}>¥{subtotal}</Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Tax:</Text>
          <View style={styles.priceContainer}>
            <Text style={styles.priceLabel}>¥</Text>
            <TextInput
              style={styles.editablePriceInput}
              value={editableTaxAmount.toString()}
              onChangeText={updateTaxAmount}
              keyboardType="numeric"
              selectTextOnFocus={true}
            />
          </View>
        </View>

        <View style={[styles.summaryRow, styles.totalRow]}>
          <Text style={styles.totalLabel}>Total:</Text>
          <Text style={styles.totalValue}>¥{total}</Text>
        </View>
      </View>

      {/* Sync Button */}
      <View style={styles.syncButtonContainer}>
        <TouchableOpacity
          style={[styles.syncButton, isSyncing && styles.syncButtonDisabled]}
          onPress={syncTransaction}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <View style={styles.syncButtonContent}>
              <ActivityIndicator size="small" color="#ffffff" />
              <Text style={[styles.syncButtonText, { marginLeft: 12 }]}>Syncing...</Text>
            </View>
          ) : (
            <Text style={styles.syncButtonText}>Sync Transaction</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Groups Selection Modal */}
      <Modal
        visible={isDropdownOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={closeDropdown}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closeDropdown}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Settle-Up Group</Text>
              <TouchableOpacity onPress={closeDropdown} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={groups}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.groupOption,
                    selectedGroupId === item.id && styles.groupOptionSelected
                  ]}
                  onPress={() => handleGroupSelection(item)}
                >
                  <Text style={[
                    styles.groupOptionText,
                    selectedGroupId === item.id && styles.groupOptionTextSelected
                  ]}>
                    {item.name}
                  </Text>
                  {selectedGroupId === item.id && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </TouchableOpacity>
              )}
              style={styles.groupsList}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7', // iOS system background
  },
  header: {
    backgroundColor: '#ffffff',
    paddingTop: 60, // More space for iOS status bar
    paddingHorizontal: 20,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 0,
    elevation: 1,
  },
  backButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    alignSelf: 'flex-start',
    marginBottom: 20,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  shopInfo: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  shopName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1c1c1e', // iOS label color
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  shopNameSecondary: {
    fontSize: 17,
    fontWeight: '400',
    color: '#8e8e93', // iOS secondary label
    marginTop: 4,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  groupSection: {
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  pickerContainer: {
    borderWidth: 0,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    overflow: 'hidden',
  },
  picker: {
    height: 50,
    width: '100%',
  },
  paidBySection: {
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  itemsSection: {
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1c1c1e',
    marginBottom: 16,
    letterSpacing: -0.6,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#d1d1d6', // iOS separator
  },
  itemInfo: {
    flex: 1,
    marginRight: 16,
  },
  itemName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1c1c1e',
    marginBottom: 4,
    letterSpacing: -0.4,
    lineHeight: 22,
  },
  itemNameSecondary: {
    fontSize: 15,
    fontWeight: '400',
    color: '#8e8e93',
    marginBottom: 8,
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  editableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: '#8e8e93',
    marginRight: 12,
    letterSpacing: -0.2,
  },
  editableInput: {
    borderWidth: 0,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    fontWeight: '500',
    backgroundColor: '#f2f2f7',
    minWidth: 64,
    textAlign: 'center',
    color: '#1c1c1e',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1c1c1e',
    marginRight: 4,
    letterSpacing: -0.4,
  },
  editablePriceInput: {
    borderWidth: 0,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 17,
    fontWeight: '700',
    backgroundColor: '#f2f2f7',
    minWidth: 84,
    textAlign: 'center',
    color: '#1c1c1e',
    letterSpacing: -0.4,
  },
  discount: {
    fontSize: 14,
    color: '#ff6b6b',
    fontWeight: '500',
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  summarySection: {
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 24,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  summaryLabel: {
    fontSize: 17,
    fontWeight: '500',
    color: '#8e8e93',
    letterSpacing: -0.4,
  },
  summaryValue: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1c1c1e',
    letterSpacing: -0.4,
  },
  totalRow: {
    borderTopWidth: 0.5,
    borderTopColor: '#d1d1d6',
    marginTop: 12,
    paddingTop: 16,
  },
  totalLabel: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1c1c1e',
    letterSpacing: -0.6,
  },
  totalValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#007AFF',
    letterSpacing: -0.6,
  },
  errorText: {
    fontSize: 18,
    color: '#ff6b6b',
    textAlign: 'center',
    marginTop: 50,
  },
  errorContainer: {
    alignItems: 'center',
    padding: 20,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 10,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
  },
  loadingText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#666',
  },
  debugContainer: {
    backgroundColor: '#f0f0f0',
    padding: 10,
    marginBottom: 10,
    borderRadius: 5,
  },
  debugText: {
    fontSize: 12,
    color: '#333',
    marginBottom: 2,
  },
  groupPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 0,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    paddingHorizontal: 16,
    paddingVertical: 16,
    minHeight: 56,
  },
  groupPickerText: {
    fontSize: 17,
    fontWeight: '400',
    flex: 1,
    letterSpacing: -0.4,
  },
  groupPickerTextSelected: {
    color: '#1c1c1e',
  },
  groupPickerTextPlaceholder: {
    color: '#8e8e93',
  },
  groupPickerArrow: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8e8e93',
    marginLeft: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 18,
    color: '#666',
    fontWeight: 'bold',
  },
  groupsList: {
    maxHeight: 300,
  },
  groupOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  groupOptionSelected: {
    backgroundColor: '#e6f3ff',
  },
  groupOptionText: {
    fontSize: 16,
    color: '#333',
    flex: 1,
  },
  groupOptionTextSelected: {
    color: '#007AFF',
    fontWeight: '600',
  },
  checkmark: {
    fontSize: 18,
    color: '#007AFF',
    fontWeight: 'bold',
  },
  userSelectionContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: '#f2f2f7',
  },
  userSelectionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#8e8e93',
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  radioButtonContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  radioButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 20,
    marginBottom: 12,
    paddingVertical: 4,
    paddingHorizontal: 4,
    minHeight: 44, // iOS minimum touch target
  },
  radioCircle: {
    height: 24,
    width: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#d1d1d6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioCircleSelected: {
    borderColor: '#007AFF',
    borderWidth: 2,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#007AFF',
  },
  radioButtonText: {
    fontSize: 17,
    fontWeight: '400',
    color: '#1c1c1e',
    letterSpacing: -0.4,
  },
  syncButtonContainer: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 8,
  },
  syncButton: {
    backgroundColor: '#007AFF',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    minHeight: 56,
  },
  syncButtonDisabled: {
    backgroundColor: '#8e8e93',
    shadowOpacity: 0.1,
  },
  syncButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
});