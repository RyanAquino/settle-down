import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    TextInput,
    ActivityIndicator,
    Modal,
    FlatList,
    Alert,
    KeyboardAvoidingView,
    Platform
} from 'react-native';
import {useLocalSearchParams, router} from 'expo-router';
import {useState, useEffect, useCallback, useMemo} from 'react';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';

// Generic retry utility for API calls
async function retryApiCall<T>(
    apiCall: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 1000
): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await apiCall();
        } catch (error) {
            if (attempt === maxAttempts) {
                throw error; // Re-throw on final attempt
            }

            // Exponential backoff with jitter
            const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 5000);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error('Retry failed'); // This should never be reached
}

interface ReceiptItem {
    english_name: string;
    japanese_name: string;
    item_order: number;
    cost: number;
    quantity: number;
    discount: number;
}

interface ReceiptData {
    receipt_items: ReceiptItem[];
    en_shop_name: string;
    jp_shop_name: string;
    tax_percentage: number;
    total_amount: number;
    receipt_date: Date;
    receipt_image_url?: string;
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
    const insets = useSafeAreaInsets();
    const [editableItems, setEditableItems] = useState<ReceiptItem[]>([]);
    const [editableTaxPercentage, setEditableTaxPercentage] = useState(0);
    const [shopInfo, setShopInfo] = useState({
        en_shop_name: '',
        jp_shop_name: '',
        total_amount: 0,
        receipt_date: new Date(),
        receipt_image_url: ''
    });
    const [groups, setGroups] = useState<SettleUpGroup[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<string>('');
    const [isLoadingGroups, setIsLoadingGroups] = useState(false);
    const [groupsError, setGroupsError] = useState<string | null>(null);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [groupUsers, setGroupUsers] = useState<GroupUser[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);
    const [userSelections, setUserSelections] = useState<{ [itemIndex: number]: string }>({});
    const [paidByUserId, setPaidByUserId] = useState<string>('');
    const [isSyncing, setIsSyncing] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [costInputs, setCostInputs] = useState<{ [itemIndex: number]: string }>({});
    const [taxPercentageInput, setTaxPercentageInput] = useState<string | null>(null);

    const mockReceiptData: ReceiptData = {
        receipt_items: [
            {
                english_name: "drinks",
                japanese_name: "クランベリー",
                item_order: 1,
                cost: 169,
                quantity: 1,
                discount: 0
            },
            {
                english_name: "food",
                japanese_name: "MSTシェイク",
                item_order: 2,
                cost: 159,
                quantity: 1,
                discount: 0
            },
            {
                english_name: "banana",
                japanese_name: "チーズリゾット",
                item_order: 3,
                cost: 129,
                quantity: 1,
                discount: 0
            },
        ],
        en_shop_name: "my basket debug",
        jp_shop_name: "ラドーム",
        tax_percentage: 8,
        total_amount: 493,
        receipt_date: new Date(),
        receipt_image_url: "https://example.com/mock-receipt-image.jpg"
    };

    // Parse receipt data or use mock data - memoized to prevent infinite loops
    const receiptData = useMemo((): ReceiptData | null => {
        if (params.useMockData === 'true') {
            return mockReceiptData;
        }

        try {
            return params.data ? JSON.parse(params.data as string) : null;
        } catch {
            return null;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.useMockData, params.data]);

    const fetchGroupUsers = useCallback(async (groupId: string) => {
        if (!groupId) return;

        const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.242:8000';
        setIsLoadingUsers(true);
        try {
            const authToken = process.env.EXPO_PUBLIC_AUTH_TOKEN;
            const headers: { [key: string]: string } = {};

            if (authToken) {
                headers.Authorization = `Bearer ${authToken}`;
            }

            const response = await retryApiCall(async () => {
                return await fetch(`${apiBaseUrl}/api/v1/settle-up/users/?group_id=${groupId}`, {
                    headers,
                });
            });

            if (response.ok) {
                const data: GroupUsersResponse = await response.json();
                setGroupUsers(data.items || []);
                // Clear previous user selections when switching groups
                setUserSelections({});
                setPaidByUserId('');
            } else {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        } catch {
            // Failed to fetch group users
            setGroupUsers([]);
        } finally {
            setIsLoadingUsers(false);
        }
    }, []);

    const fetchSettleUpGroups = useCallback(async () => {
        const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.242:8000';
        setIsLoadingGroups(true);
        setGroupsError(null);
        try {
            const authToken = process.env.EXPO_PUBLIC_AUTH_TOKEN;
            const headers: { [key: string]: string } = {};

            if (authToken) {
                headers.Authorization = `Bearer ${authToken}`;
            }

            const response = await retryApiCall(async () => {
                return await fetch(`${apiBaseUrl}/api/v1/settle-up/groups/`, {
                    headers,
                });
            });
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
        } catch {
            // Failed to fetch settle-up groups
            setGroupsError('Failed to load groups. Please try again.');
            setGroups([]);
        } finally {
            setIsLoadingGroups(false);
        }
    }, [fetchGroupUsers]);

    // Initialize data when component mounts
    useEffect(() => {
        if (!receiptData) {
            router.back();
            return;
        }

        setEditableItems([...receiptData.receipt_items]);
        setEditableTaxPercentage(receiptData.tax_percentage);
        setTaxPercentageInput(receiptData.tax_percentage.toString());

        // Initialize cost inputs with current values
        const initialCostInputs: { [itemIndex: number]: string } = {};
        receiptData.receipt_items.forEach((item, index) => {
            initialCostInputs[index] = item.cost.toString();
        });
        setCostInputs(initialCostInputs);
        setShopInfo({
            en_shop_name: receiptData.en_shop_name,
            jp_shop_name: receiptData.jp_shop_name,
            total_amount: receiptData.total_amount,
            receipt_date: new Date(receiptData.receipt_date),
            receipt_image_url: receiptData?.receipt_image_url || ''
        });
    }, [receiptData]);

    // Fetch groups only once on mount
    useEffect(() => {
        fetchSettleUpGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // Update the raw input string
        setCostInputs(prev => ({...prev, [index]: cost}));

        // Update the actual cost value - handle empty string properly
        const newItems = [...editableItems];
        const parsedCost = cost === '' ? 0 : parseFloat(cost);
        newItems[index].cost = Math.max(0, isNaN(parsedCost) ? 0 : parsedCost);
        setEditableItems(newItems);
    };

    const calculateSubtotal = () => {
        return editableItems.reduce((total, item) => total + (item.cost * item.quantity), 0);
    };

    const calculateTaxAmount = () => {
        const subtotal = calculateSubtotal();
        return (subtotal * editableTaxPercentage) / 100;
    };

    // Total should come from the API response, not calculated
    const getTotal = () => {
        return shopInfo.total_amount;
    };

    const updateTaxPercentage = (taxPercent: string) => {
        // Update the raw input string
        setTaxPercentageInput(taxPercent);

        // Update the actual tax percentage value - handle empty string properly
        const parsedTaxPercent = taxPercent === '' ? 0 : parseFloat(taxPercent);
        setEditableTaxPercentage(Math.max(0, isNaN(parsedTaxPercent) ? 0 : parsedTaxPercent));
    };

    const handleDateChange = (event: any, selectedDate?: Date) => {
        if (selectedDate) {
            setShopInfo(prev => ({
                ...prev,
                receipt_date: selectedDate
            }));
        }
    };

    const formatDateTime = (date: Date) => {
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    };

    const showDateTimePicker = () => {
        setShowDatePicker(true);
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

        // Check if all items have been assigned to users or marked as shared
        const unassignedItems = editableItems.filter((_, index) => !userSelections[index]);
        if (unassignedItems.length > 0) {
            Alert.alert('Error', 'Please assign all receipt items to users or mark as shared.');
            return;
        }

        // Get unique user IDs (excluding 'shared' assignments)
        const assignedUserIds = Object.values(userSelections).filter(id => id !== 'shared');
        const uniqueUserIds = [...new Set(assignedUserIds)];

        // Check if there are any user assignments or shared items
        const hasUserAssignments = uniqueUserIds.length > 0;
        const hasSharedItems = Object.values(userSelections).some(id => id === 'shared');

        if (!hasUserAssignments && !hasSharedItems) {
            Alert.alert('Error', 'Please assign items to at least one user or mark items as shared.');
            return;
        }

        setIsSyncing(true);

        try {
            // Create user receipt items array and split items array
            const userReceiptItems: { member_id: string; cost: number }[] = [];
            const splitReceiptItems: number[] = [];

            // Calculate totals for each user
            const userTotals = uniqueUserIds.reduce((acc, userId) => {
                acc[userId] = 0;
                return acc;
            }, {} as { [userId: string]: number });

            // Sum up item costs for each user and collect shared items
            editableItems.forEach((item, index) => {
                const assignedUserId = userSelections[index];
                const itemTotal = item.cost * item.quantity;

                if (assignedUserId === 'shared') {
                    // Add to split receipt items for shared ownership
                    splitReceiptItems.push(itemTotal);
                } else if (assignedUserId && assignedUserId !== 'shared') {
                    // Add to specific user's total
                    userTotals[assignedUserId] += itemTotal;
                }
            });

            // Convert user totals to user_receipt_items format
            uniqueUserIds.forEach(userId => {
                if (userTotals[userId] > 0) {
                    userReceiptItems.push({
                        member_id: userId,
                        cost: userTotals[userId]
                    });
                }
            });

            const payload = {
                purpose: shopInfo.en_shop_name || shopInfo.jp_shop_name || 'Receipt',
                paying_member_id: paidByUserId,
                tax_percentage: editableTaxPercentage,
                total_amount: getTotal(),
                user_receipt_items: userReceiptItems,
                split_receipt_items: splitReceiptItems,
                group_id: selectedGroupId,
                receipt_date: shopInfo.receipt_date,
                receipt_image_url: shopInfo.receipt_image_url,
            };

            const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.242:8000';
            const authToken = process.env.EXPO_PUBLIC_AUTH_TOKEN;
            const headers: { [key: string]: string } = {
                'Content-Type': 'application/json',
            };

            if (authToken) {
                headers.Authorization = `Bearer ${authToken}`;
            }

            const response = await retryApiCall(async () => {
                return await fetch(`${apiBaseUrl}/api/v1/settle-up/transactions/`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                });
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
        } catch {
            // Sync failed
            Alert.alert('Error', 'Failed to sync transaction. Please try again.');
        } finally {
            setIsSyncing(false);
        }
    };

    const subtotal = calculateSubtotal();
    const taxAmount = calculateTaxAmount();

    return (
        <KeyboardAvoidingView
            style={styles.keyboardContainer}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
        >
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.header}>
                    <View style={styles.headerTop}>
                        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                            <Text style={styles.backButtonText}>←</Text>
                        </TouchableOpacity>
                        <View style={styles.shopInfo}>
                            <Text style={styles.shopName}>
                                {shopInfo.en_shop_name || shopInfo.jp_shop_name}
                            </Text>
                            <TouchableOpacity
                                style={styles.dateButton}
                                onPress={showDateTimePicker}
                            >
                                <Text style={styles.dateText}>
                                    📅 {formatDateTime(shopInfo.receipt_date)}
                                </Text>
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.totalPreview}>¥{getTotal()}</Text>
                    </View>
                </View>

                <View style={styles.mainSection}>
                    {/* Ultra Compact Group and Paid By */}
                    <View style={styles.ultraCompactRow}>
                        {/* Group Selection - Inline */}
                        <View style={styles.inlineSection}>
                            <Text style={styles.inlineLabel}>Group:</Text>
                            {groupsError ? (
                                <TouchableOpacity style={styles.miniRetryButton} onPress={fetchSettleUpGroups}>
                                    <Text style={styles.miniRetryText}>Retry</Text>
                                </TouchableOpacity>
                            ) : isLoadingGroups ? (
                                <ActivityIndicator size="small" color="#007AFF"/>
                            ) : (
                                <TouchableOpacity
                                    style={styles.inlinePickerButton}
                                    onPress={showGroupPicker}
                                    disabled={groups.length === 0}
                                >
                                    <Text style={styles.inlinePickerText}>
                                        {groups.length === 0 ? "None" : (getSelectedGroupName().length > 12 ? getSelectedGroupName().substring(0, 12) + '...' : getSelectedGroupName())}
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Paid By - Inline */}
                        <View style={styles.inlineSection}>
                            <Text style={styles.inlineLabel}>Paid:</Text>
                            {isLoadingUsers ? (
                                <ActivityIndicator size="small" color="#007AFF"/>
                            ) : (
                                <View style={styles.inlineUserButtons}>
                                    {groupUsers.map((user) => (
                                        <TouchableOpacity
                                            key={user.id}
                                            style={[
                                                styles.miniUserButton,
                                                paidByUserId === user.id && styles.miniUserButtonSelected
                                            ]}
                                            onPress={() => setPaidByUserId(user.id)}
                                        >
                                            <Text style={[
                                                styles.miniUserButtonText,
                                                paidByUserId === user.id && styles.miniUserButtonTextSelected
                                            ]}>
                                                {user.name.split(' ')[0].substring(0, 6)}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            )}
                        </View>
                    </View>

                    {/* Items List */}
                    <View style={styles.itemsList}>
                        <View style={styles.itemsHeader}>
                            <Text style={styles.itemsHeaderText}>Items</Text>
                        </View>

                        {editableItems
                            .sort((a, b) => a.item_order - b.item_order)
                            .map((item, index) => (
                                <View key={index} style={styles.compactItemRow}>
                                    <View style={styles.itemMainInfo}>
                                        <View style={styles.itemTopRow}>
                                            <View style={styles.itemNameSection}>
                                                <Text style={styles.compactItemName}>
                                                    {item.english_name || item.japanese_name}
                                                </Text>
                                                {item.english_name && item.japanese_name && (
                                                    <Text style={styles.itemNameSecondary}>
                                                        {item.japanese_name}
                                                    </Text>
                                                )}
                                            </View>

                                            <View style={styles.itemControls}>
                                                <View style={styles.quantityControl}>
                                                    <TouchableOpacity
                                                        style={styles.quantityButton}
                                                        onPress={() => updateItemQuantity(index, Math.max(0, item.quantity - 1).toString())}
                                                    >
                                                        <Text style={styles.quantityButtonText}>−</Text>
                                                    </TouchableOpacity>
                                                    <Text style={styles.quantityText}>{item.quantity}</Text>
                                                    <TouchableOpacity
                                                        style={styles.quantityButton}
                                                        onPress={() => updateItemQuantity(index, (item.quantity + 1).toString())}
                                                    >
                                                        <Text style={styles.quantityButtonText}>+</Text>
                                                    </TouchableOpacity>
                                                </View>

                                                <View style={styles.priceInputContainer}>
                                                    <Text style={styles.pricePrefix}>¥</Text>
                                                    <TextInput
                                                        style={styles.priceInput}
                                                        value={costInputs.hasOwnProperty(index) ? costInputs[index] : item.cost.toString()}
                                                        onChangeText={(text) => updateItemCost(index, text)}
                                                        keyboardType="decimal-pad"
                                                        placeholder="0"
                                                    />
                                                </View>
                                            </View>
                                        </View>

                                        {/* Right-aligned User Assignment Row */}
                                        {groupUsers.length > 0 && (
                                            <View style={styles.userAssignmentRowRight}>
                                                {groupUsers.map((user) => (
                                                    <TouchableOpacity
                                                        key={user.id}
                                                        style={[
                                                            styles.userAssignButton,
                                                            userSelections[index] === user.id && styles.userAssignButtonSelected
                                                        ]}
                                                        onPress={() => handleUserSelection(index, user.id)}
                                                    >
                                                        <Text style={[
                                                            styles.userAssignButtonText,
                                                            userSelections[index] === user.id && styles.userAssignButtonTextSelected
                                                        ]}>
                                                            {user.name.split(' ')[0]}
                                                        </Text>
                                                    </TouchableOpacity>
                                                ))}
                                                {/* Shared button */}
                                                <TouchableOpacity
                                                    style={[
                                                        styles.userAssignButton,
                                                        styles.sharedButton,
                                                        userSelections[index] === 'shared' && styles.sharedButtonSelected
                                                    ]}
                                                    onPress={() => handleUserSelection(index, 'shared')}
                                                >
                                                    <Text style={[
                                                        styles.userAssignButtonText,
                                                        styles.sharedButtonText,
                                                        userSelections[index] === 'shared' && styles.sharedButtonTextSelected
                                                    ]}>
                                                        Shared
                                                    </Text>
                                                </TouchableOpacity>
                                            </View>
                                        )}
                                    </View>
                                </View>
                            ))}
                    </View>
                </View>

                {/* Clean Summary and Sync */}
                <View style={[styles.bottomSection, {paddingBottom: Math.max(insets.bottom, 16)}]}>
                    {/* Ultra Compact Summary */}
                    <View style={styles.summaryCard}>
                        <View style={styles.compactSummaryRow}>
                            <View style={styles.summaryColumn}>
                                <Text style={styles.summaryLabel}>Subtotal</Text>
                                <Text style={styles.summaryValue}>¥{subtotal}</Text>
                            </View>

                            <View style={styles.summaryColumnCompact}>
                                <Text style={styles.summaryLabel}>Tax</Text>
                                <View style={styles.miniTaxInput}>
                                    <TextInput
                                        style={styles.miniTaxField}
                                        value={taxPercentageInput !== null ? taxPercentageInput : editableTaxPercentage.toString()}
                                        onChangeText={(text) => updateTaxPercentage(text)}
                                        keyboardType="decimal-pad"
                                        placeholder="0"
                                    />
                                    <Text style={styles.miniTaxPrefix}>%</Text>
                                </View>
                                <Text style={styles.taxAmount}>¥{Math.round(taxAmount)}</Text>
                            </View>

                            <View style={styles.summaryColumn}>
                                <Text style={styles.summaryLabel}>Total</Text>
                                <Text style={styles.summaryTotalAmount}>¥{getTotal()}</Text>
                            </View>
                        </View>
                    </View>

                    {/* Clean Sync Button */}
                    <TouchableOpacity
                        style={[styles.cleanSyncButton, isSyncing && styles.cleanSyncButtonDisabled]}
                        onPress={syncTransaction}
                        disabled={isSyncing}
                    >
                        {isSyncing ? (
                            <View style={styles.syncingContent}>
                                <ActivityIndicator size="small" color="#ffffff"/>
                                <Text style={styles.cleanSyncText}>Syncing Transaction...</Text>
                            </View>
                        ) : (
                            <Text style={styles.cleanSyncText}>Sync Transaction</Text>
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
                                renderItem={({item}) => (
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

            {showDatePicker && (
                <Modal
                    transparent={true}
                    animationType="slide"
                    visible={showDatePicker}
                    onRequestClose={() => setShowDatePicker(false)}
                >
                    <View style={styles.modalOverlay}>
                        <View style={styles.datePickerModal}>
                            <View style={styles.datePickerHeader}>
                                <TouchableOpacity
                                    onPress={() => setShowDatePicker(false)}
                                    style={styles.headerButton}
                                >
                                    <Text style={styles.headerButtonText}>Cancel</Text>
                                </TouchableOpacity>
                                <Text style={styles.headerTitle}>Select Date & Time</Text>
                                <TouchableOpacity
                                    onPress={() => setShowDatePicker(false)}
                                    style={styles.headerButton}
                                >
                                    <Text style={[styles.headerButtonText, styles.doneButton]}>Done</Text>
                                </TouchableOpacity>
                            </View>
                            <View style={styles.datePickerContainer}>
                                <DateTimePicker
                                    value={shopInfo.receipt_date}
                                    mode="datetime"
                                    display="spinner"
                                    onChange={handleDateChange}
                                    maximumDate={new Date()}
                                    textColor="#000000"
                                    accentColor="#007AFF"
                                    themeVariant="light"
                                    style={styles.datePicker}
                                />
                            </View>
                        </View>
                    </View>
                </Modal>
            )}
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    keyboardContainer: {
        flex: 1,
        backgroundColor: '#f2f2f7',
    },
    container: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
    },
    header: {
        backgroundColor: '#ffffff',
        paddingTop: 50,
        paddingBottom: 12,
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.08,
        shadowRadius: 2,
        elevation: 2,
    },
    headerTop: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    backButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f2f2f7',
        alignItems: 'center',
        justifyContent: 'center',
    },
    backButtonText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#007AFF',
    },
    shopInfo: {
        flex: 1,
        alignItems: 'center',
    },
    dateButton: {
        marginTop: 4,
        paddingHorizontal: 12,
        paddingVertical: 4,
        backgroundColor: 'rgba(0, 122, 255, 0.1)',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(0, 122, 255, 0.3)',
    },
    dateText: {
        fontSize: 13,
        color: '#007AFF',
        fontWeight: '500',
    },
    shopName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1c1c1e',
        letterSpacing: -0.4,
    },
    totalPreview: {
        fontSize: 16,
        fontWeight: '700',
        color: '#007AFF',
        letterSpacing: -0.4,
    },
    mainSection: {
        backgroundColor: 'transparent',
        margin: 8,
        borderRadius: 16,
        padding: 8,
    },
    ultraCompactRow: {
        backgroundColor: '#ffffff',
        marginBottom: 8,
        padding: 8,
        borderRadius: 8,
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.03,
        shadowRadius: 1,
        elevation: 1,
    },
    inlineSection: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
        flexWrap: 'wrap',
    },
    inlineLabel: {
        fontSize: 11,
        fontWeight: '500',
        color: '#8e8e93',
        marginRight: 6,
        minWidth: 40,
    },
    inlinePickerButton: {
        backgroundColor: '#f2f2f7',
        borderRadius: 6,
        paddingVertical: 4,
        paddingHorizontal: 8,
        marginRight: 12,
        minHeight: 24,
    },
    inlinePickerText: {
        fontSize: 11,
        fontWeight: '500',
        color: '#1c1c1e',
    },
    inlineUserButtons: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    miniUserButton: {
        backgroundColor: '#f2f2f7',
        borderRadius: 6,
        paddingVertical: 3,
        paddingHorizontal: 6,
        marginRight: 4,
        marginBottom: 2,
        minHeight: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    miniUserButtonSelected: {
        backgroundColor: '#007AFF',
    },
    miniUserButtonText: {
        fontSize: 10,
        fontWeight: '500',
        color: '#1c1c1e',
    },
    miniUserButtonTextSelected: {
        color: '#ffffff',
    },
    miniRetryButton: {
        backgroundColor: '#ff6b6b',
        borderRadius: 6,
        paddingVertical: 4,
        paddingHorizontal: 8,
        minHeight: 24,
    },
    miniRetryText: {
        fontSize: 10,
        fontWeight: '500',
        color: '#ffffff',
    },
    itemsList: {
        marginTop: 12,
    },
    itemsHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        paddingHorizontal: 2,
    },
    itemsHeaderText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1c1c1e',
        letterSpacing: -0.4,
    },
    itemsHeaderSubtext: {
        fontSize: 11,
        color: '#8e8e93',
        letterSpacing: -0.1,
    },
    compactItemRow: {
        backgroundColor: '#ffffff',
        marginBottom: 8,
        padding: 12,
        borderRadius: 10,
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
        overflow: 'hidden',
    },
    itemMainInfo: {
        flexDirection: 'column',
    },
    itemTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    itemNameSection: {
        flex: 1,
        marginRight: 8,
    },
    compactItemName: {
        fontSize: 15,
        fontWeight: '600',
        color: '#1c1c1e',
        letterSpacing: -0.3,
        marginBottom: 1,
    },
    itemNameSecondary: {
        fontSize: 12,
        fontWeight: '400',
        color: '#8e8e93',
        letterSpacing: -0.1,
    },
    itemControls: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        maxWidth: 180,
    },
    quantityControl: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f2f2f7',
        borderRadius: 14,
        marginRight: 6,
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.03,
        shadowRadius: 1,
        elevation: 1,
        height: 28,
    },
    quantityButton: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
    },
    quantityButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#007AFF',
    },
    quantityText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1c1c1e',
        minWidth: 20,
        textAlign: 'center',
    },
    priceButton: {
        backgroundColor: '#f2f2f7',
        borderRadius: 16,
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    priceButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1c1c1e',
        letterSpacing: -0.2,
    },
    priceInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f2f2f7',
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: 'transparent',
        height: 28,
        minWidth: 75,
        maxWidth: 95,
    },
    pricePrefix: {
        fontSize: 12,
        fontWeight: '600',
        color: '#8e8e93',
        marginRight: 1,
    },
    priceInput: {
        fontSize: 12,
        fontWeight: '600',
        color: '#1c1c1e',
        letterSpacing: -0.2,
        textAlign: 'right',
        flex: 1,
        padding: 0,
        minWidth: 50,
    },
    userAssignmentRow: {
        flexDirection: 'row',
        marginTop: 6,
        paddingTop: 6,
        borderTopWidth: 0.5,
        borderTopColor: '#f2f2f7',
    },
    userAssignmentRowRight: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 6,
        paddingTop: 6,
        borderTopWidth: 0.5,
        borderTopColor: '#f2f2f7',
    },
    userAssignButton: {
        backgroundColor: '#f2f2f7',
        borderRadius: 8,
        paddingVertical: 6,
        paddingHorizontal: 10,
        marginRight: 4,
        marginBottom: 2,
        borderWidth: 1,
        borderColor: 'transparent',
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 0.5},
        shadowOpacity: 0.03,
        shadowRadius: 1,
        elevation: 1,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 28,
    },
    userAssignButtonSelected: {
        backgroundColor: '#007AFF',
        borderColor: '#007AFF',
        shadowColor: '#007AFF',
        shadowOpacity: 0.2,
    },
    userAssignButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#1c1c1e',
        letterSpacing: -0.1,
    },
    userAssignButtonTextSelected: {
        color: '#ffffff',
    },
    sharedButton: {
        backgroundColor: '#f8f9fa',
        borderColor: '#e9ecef',
        borderWidth: 1,
    },
    sharedButtonSelected: {
        backgroundColor: '#28a745',
        borderColor: '#28a745',
        shadowColor: '#28a745',
        shadowOpacity: 0.2,
    },
    sharedButtonText: {
        color: '#6c757d',
        fontWeight: '500',
    },
    sharedButtonTextSelected: {
        color: '#ffffff',
        fontWeight: '600',
    },
    userAssignmentRight: {
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        paddingLeft: 4,
    },
    userAssignButtonRight: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f2f2f7',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4,
        borderWidth: 2,
        borderColor: 'transparent',
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.05,
        shadowRadius: 1,
        elevation: 1,
    },
    userAssignButtonRightSelected: {
        backgroundColor: '#007AFF',
        borderColor: '#007AFF',
        shadowColor: '#007AFF',
        shadowOpacity: 0.3,
    },
    userAssignButtonRightText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1c1c1e',
        letterSpacing: -0.2,
    },
    userAssignButtonRightTextSelected: {
        color: '#ffffff',
    },
    bottomSection: {
        marginHorizontal: 12,
        marginTop: 0,
        marginBottom: 0,
    },
    compactSummary: {
        backgroundColor: '#ffffff',
        borderRadius: 8,
        padding: 8,
        marginBottom: 6,
        flexDirection: 'row',
        justifyContent: 'space-around',
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.04,
        shadowRadius: 2,
        elevation: 1,
    },
    summaryItemLabel: {
        fontSize: 10,
        fontWeight: '500',
        color: '#8e8e93',
        marginBottom: 2,
        letterSpacing: -0.1,
    },
    summaryItemValue: {
        fontSize: 12,
        fontWeight: '600',
        color: '#1c1c1e',
        letterSpacing: -0.2,
    },
    taxEditButton: {
        backgroundColor: '#f2f2f7',
        borderRadius: 8,
        paddingVertical: 2,
        paddingHorizontal: 8,
    },
    taxEditValue: {
        fontSize: 12,
        fontWeight: '600',
        color: '#007AFF',
        letterSpacing: -0.2,
    },
    taxPrefix: {
        fontSize: 10,
        fontWeight: '600',
        color: '#8e8e93',
        marginRight: 1,
    },
    taxEditInput: {
        fontSize: 10,
        fontWeight: '600',
        color: '#007AFF',
        letterSpacing: -0.1,
        textAlign: 'right',
        minWidth: 35,
        padding: 0,
        flex: 1,
    },
    summaryCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    compactSummaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    summaryColumn: {
        flex: 1,
        alignItems: 'center',
    },
    summaryColumnCompact: {
        alignItems: 'center',
        minWidth: 80,
    },
    summaryLabel: {
        fontSize: 13,
        fontWeight: '500',
        color: '#8e8e93',
        marginBottom: 4,
    },
    summaryValue: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1c1c1e',
    },
    summaryTotalAmount: {
        fontSize: 18,
        fontWeight: '700',
        color: '#007AFF',
    },
    miniTaxInput: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f2f2f7',
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 3,
        width: 65,
        borderWidth: 1,
        borderColor: '#e9ecef',
    },
    miniTaxPrefix: {
        fontSize: 12,
        fontWeight: '600',
        color: '#8e8e93',
        marginRight: 1,
    },
    miniTaxField: {
        fontSize: 12,
        fontWeight: '600',
        color: '#007AFF',
        flex: 1,
        padding: 0,
        textAlign: 'center',
        minWidth: 35,
    },
    taxAmount: {
        fontSize: 10,
        fontWeight: '500',
        color: '#8e8e93',
        textAlign: 'center',
        marginTop: 2,
    },
    cleanSyncButton: {
        backgroundColor: '#007AFF',
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 20,
        alignItems: 'center',
        shadowColor: '#007AFF',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 2,
    },
    cleanSyncButtonDisabled: {
        backgroundColor: '#8e8e93',
        shadowOpacity: 0.1,
    },
    syncingContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    cleanSyncText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: -0.3,
        marginLeft: 8,
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
        shadowOffset: {width: 0, height: 1},
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
        shadowOffset: {width: 0, height: 1},
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
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.04,
        shadowRadius: 8,
        elevation: 2,
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
        shadowOffset: {width: 0, height: 4},
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
    datePickerModal: {
        backgroundColor: 'white',
        marginTop: 'auto',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingBottom: 34, // Safe area bottom
    },
    datePickerHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderBottomWidth: 0.5,
        borderBottomColor: '#e5e5e7',
    },
    headerButton: {
        padding: 4,
        minWidth: 60,
    },
    headerButtonText: {
        fontSize: 17,
        color: '#007AFF',
    },
    doneButton: {
        fontWeight: '600',
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: '#1c1c1e',
    },
    datePickerContainer: {
        backgroundColor: '#ffffff',
        paddingVertical: 20,
        marginHorizontal: 16,
    },
    datePicker: {
        height: 200,
        backgroundColor: '#ffffff',
    },
});