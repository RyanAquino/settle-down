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
    Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { theme, buildUserColorMap, initialFor } from '../utils/theme';

// -------- types --------
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
interface SettleUpGroup { name: string; id: string; }
interface SettleUpGroupsResponse { items: SettleUpGroup[]; count: number; }
interface GroupUser { name: string; id: string; }
interface GroupUsersResponse { items: GroupUser[]; count: number; }

// -------- util --------
async function retryApiCall<T>(apiCall: () => Promise<T>, maxAttempts = 3, baseDelay = 1000): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try { return await apiCall(); } catch (error) {
            if (attempt === maxAttempts) throw error;
            const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 5000);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw new Error('Retry failed');
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString('en-US')}`;

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
        receipt_image_url: '',
    });
    const [groups, setGroups] = useState<SettleUpGroup[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<string>('');
    const [isLoadingGroups, setIsLoadingGroups] = useState(false);
    const [groupsError, setGroupsError] = useState<string | null>(null);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [groupUsers, setGroupUsers] = useState<GroupUser[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);
    const [groupsFetchAttempts, setGroupsFetchAttempts] = useState(0);
    const [userSelections, setUserSelections] = useState<{ [itemIndex: number]: string }>({});
    const [paidByUserId, setPaidByUserId] = useState<string>('');
    const [isSyncing, setIsSyncing] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [costInputs, setCostInputs] = useState<{ [itemIndex: number]: string }>({});
    const [taxPercentageInput, setTaxPercentageInput] = useState<string | null>(null);

    const mockReceiptData: ReceiptData = {
        receipt_items: [
            { english_name: 'Cranberry juice', japanese_name: 'クランベリー', item_order: 1, cost: 169, quantity: 1, discount: 0 },
            { english_name: 'MST shake', japanese_name: 'MSTシェイク', item_order: 2, cost: 159, quantity: 1, discount: 0 },
            { english_name: 'Cheese risotto', japanese_name: 'チーズリゾット', item_order: 3, cost: 129, quantity: 1, discount: 0 },
        ],
        en_shop_name: 'My Basket',
        jp_shop_name: 'ラドーム',
        tax_percentage: 8,
        total_amount: 493,
        receipt_date: new Date(),
        receipt_image_url: 'https://example.com/mock-receipt-image.jpg',
    };

    const receiptData = useMemo((): ReceiptData | null => {
        if (params.useMockData === 'true') return mockReceiptData;
        try { return params.data ? JSON.parse(params.data as string) : null; } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.useMockData, params.data]);

    // -------- data fetching --------
    const fetchGroupUsers = useCallback(async (groupId: string) => {
        if (!groupId) return;
        const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.242:8000';
        setIsLoadingUsers(true);
        try {
            const authToken = process.env.EXPO_PUBLIC_AUTH_TOKEN;
            const headers: { [key: string]: string } = { 'ngrok-skip-browser-warning': 'true' };
            if (authToken) headers.Authorization = `Bearer ${authToken}`;
            const response = await retryApiCall(async () =>
                fetch(`${apiBaseUrl}/api/v1/settle-up/users/?group_id=${groupId}`, { headers }),
            );
            if (response.ok) {
                const data: GroupUsersResponse = await response.json();
                setGroupUsers(data.items || []);
                setUserSelections({});
                setPaidByUserId('');
            } else throw new Error(`HTTP error! status: ${response.status}`);
        } catch {
            setGroupUsers([]);
        } finally {
            setIsLoadingUsers(false);
        }
    }, []);

    const fetchSettleUpGroups = useCallback(async (isAutoRetry = false) => {
        const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.242:8000';
        setIsLoadingGroups(true);
        setGroupsError(null);
        if (isAutoRetry) setGroupsFetchAttempts((p) => p + 1);
        else setGroupsFetchAttempts(1);
        try {
            const authToken = process.env.EXPO_PUBLIC_AUTH_TOKEN;
            const headers: { [key: string]: string } = { 'ngrok-skip-browser-warning': 'true' };
            if (authToken) headers.Authorization = `Bearer ${authToken}`;
            const response = await retryApiCall(async () =>
                fetch(`${apiBaseUrl}/api/v1/settle-up/groups/`, { headers }),
            );
            if (response.ok) {
                const data: SettleUpGroupsResponse = await response.json();
                setGroups(data.items || []);
                setGroupsFetchAttempts(0);
                if (data.items && data.items.length > 0) {
                    const firstGroupId = data.items[0].id;
                    setSelectedGroupId(firstGroupId);
                    fetchGroupUsers(firstGroupId);
                }
            } else throw new Error(`HTTP error! status: ${response.status}`);
        } catch {
            setGroupsError('Couldn\u2019t load groups.');
            setGroups([]);
        } finally {
            setIsLoadingGroups(false);
        }
    }, [fetchGroupUsers]);

    // -------- init --------
    useEffect(() => {
        if (!receiptData) { router.back(); return; }
        setEditableItems([...receiptData.receipt_items]);
        setEditableTaxPercentage(receiptData.tax_percentage);
        setTaxPercentageInput(receiptData.tax_percentage.toString());
        const initialCostInputs: { [i: number]: string } = {};
        receiptData.receipt_items.forEach((item, index) => { initialCostInputs[index] = item.cost.toString(); });
        setCostInputs(initialCostInputs);
        setShopInfo({
            en_shop_name: receiptData.en_shop_name,
            jp_shop_name: receiptData.jp_shop_name,
            total_amount: receiptData.total_amount,
            receipt_date: new Date(receiptData.receipt_date),
            receipt_image_url: receiptData?.receipt_image_url || '',
        });
    }, [receiptData]);

    useEffect(() => { fetchSettleUpGroups(); /* eslint-disable-next-line */ }, []);

    useEffect(() => {
        const MAX_AUTO_RETRIES = 2;
        if (groupsError && groupsFetchAttempts > 0 && groupsFetchAttempts <= MAX_AUTO_RETRIES) {
            const retryDelay = Math.min(1000 * Math.pow(2, groupsFetchAttempts - 1), 5000);
            const t = setTimeout(() => fetchSettleUpGroups(true), retryDelay);
            return () => clearTimeout(t);
        }
    }, [groupsError, groupsFetchAttempts, fetchSettleUpGroups]);

    if (!receiptData) {
        return (
            <View style={styles.errorContainer}>
                <Text style={styles.errorText}>Couldn\u2019t load receipt data.</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
                    <Text style={styles.primaryBtnText}>Go back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // -------- handlers --------
    const updateItemQuantity = (index: number, quantity: string) => {
        const newItems = [...editableItems];
        newItems[index].quantity = Math.max(0, parseInt(quantity) || 0);
        setEditableItems(newItems);
    };
    const updateItemCost = (index: number, cost: string) => {
        setCostInputs((p) => ({ ...p, [index]: cost }));
        const newItems = [...editableItems];
        const parsed = cost === '' ? 0 : parseFloat(cost);
        newItems[index].cost = Math.max(0, isNaN(parsed) ? 0 : parsed);
        setEditableItems(newItems);
    };
    const calculateSubtotal = () => editableItems.reduce((t, i) => t + i.cost * i.quantity, 0);
    const calculateTaxAmount = () => (calculateSubtotal() * editableTaxPercentage) / 100;
    const getTotal = () => shopInfo.total_amount;
    const updateTaxPercentage = (t: string) => {
        setTaxPercentageInput(t);
        const parsed = t === '' ? 0 : parseFloat(t);
        setEditableTaxPercentage(Math.max(0, isNaN(parsed) ? 0 : parsed));
    };
    const handleDateChange = (_: any, d?: Date) => {
        if (d) setShopInfo((p) => ({ ...p, receipt_date: d }));
    };
    const formatDate = (d: Date) =>
        d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const formatTime = (d: Date) =>
        d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    const handleUserSelection = (itemIndex: number, userId: string) => {
        setUserSelections((p) => ({ ...p, [itemIndex]: userId }));
    };
    const getSelectedGroupName = () =>
        groups.find((g) => g.id === selectedGroupId)?.name || 'Select group';

    const showGroupPicker = () => { if (groups.length > 0) setIsDropdownOpen(true); };
    const handleGroupSelection = (g: SettleUpGroup) => {
        setSelectedGroupId(g.id);
        setIsDropdownOpen(false);
        fetchGroupUsers(g.id);
    };

    const syncTransaction = async () => {
        if (!selectedGroupId) return Alert.alert('Pick a group', 'Please select a settle-up group.');
        if (!paidByUserId) return Alert.alert('Who paid?', 'Please select who paid for this receipt.');
        const unassigned = editableItems.filter((_, i) => !userSelections[i]);
        if (unassigned.length > 0)
            return Alert.alert('Assign every item', 'Tap a person on each item, or mark it shared.');

        const assignedUserIds = Object.values(userSelections).filter((id) => id !== 'shared');
        const uniqueUserIds = [...new Set(assignedUserIds)];
        const hasUserAssignments = uniqueUserIds.length > 0;
        const hasSharedItems = Object.values(userSelections).some((id) => id === 'shared');
        if (!hasUserAssignments && !hasSharedItems)
            return Alert.alert('Nothing to split', 'Assign items to people or mark them shared.');

        setIsSyncing(true);
        try {
            const userReceiptItems: { member_id: string; cost: number }[] = [];
            const splitReceiptItems: number[] = [];
            const userTotals = uniqueUserIds.reduce((acc, id) => { acc[id] = 0; return acc; }, {} as { [id: string]: number });

            editableItems.forEach((item, index) => {
                const assigned = userSelections[index];
                const total = item.cost * item.quantity;
                if (assigned === 'shared') splitReceiptItems.push(total);
                else if (assigned) userTotals[assigned] += total;
            });
            uniqueUserIds.forEach((id) => {
                if (userTotals[id] > 0) userReceiptItems.push({ member_id: id, cost: userTotals[id] });
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
                'ngrok-skip-browser-warning': 'true',
                'Content-Type': 'application/json',
            };
            if (authToken) headers.Authorization = `Bearer ${authToken}`;

            const response = await retryApiCall(async () =>
                fetch(`${apiBaseUrl}/api/v1/settle-up/transactions/`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                }),
            );
            if (response.ok) {
                Alert.alert('Synced', 'Transaction sent to Settle Up.', [
                    { text: 'OK', onPress: () => router.back() },
                ]);
            } else throw new Error(`HTTP error! status: ${response.status}`);
        } catch {
            Alert.alert('Sync failed', 'Couldn\u2019t sync this transaction. Please try again.');
        } finally {
            setIsSyncing(false);
        }
    };

    // -------- derived --------
    // Index-based color map — guarantees each user in the current group
    // gets a different fill color (up to palette size).
    const userColorMap = useMemo(() => buildUserColorMap(groupUsers), [groupUsers]);
    const subtotal = calculateSubtotal();
    const taxAmount = calculateTaxAmount();
    const total = getTotal();
    const assignedCount = Object.keys(userSelections).length;
    const allAssigned = editableItems.length > 0 && assignedCount === editableItems.length;
    const readyToSync = allAssigned && !!selectedGroupId && !!paidByUserId;

    // -------- render --------
    return (
        <KeyboardAvoidingView
            style={styles.root}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
        >
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: 180 + insets.bottom }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* Header */}
                <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                    <View style={styles.headerTopRow}>
                        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()} accessibilityLabel="Back">
                            <Text style={styles.iconBtnText}>←</Text>
                        </TouchableOpacity>
                        <Text style={styles.headerKicker}>RECEIPT</Text>
                        <View style={styles.iconBtnSpacer} />
                    </View>

                    <Text style={styles.shopName} numberOfLines={2}>
                        {shopInfo.en_shop_name || shopInfo.jp_shop_name || 'Untitled shop'}
                    </Text>
                    {shopInfo.en_shop_name && shopInfo.jp_shop_name ? (
                        <Text style={styles.shopNameJP}>{shopInfo.jp_shop_name}</Text>
                    ) : null}

                    <TouchableOpacity style={styles.dateRow} onPress={() => setShowDatePicker(true)}>
                        <Text style={styles.dateText}>
                            {formatDate(shopInfo.receipt_date)} · {formatTime(shopInfo.receipt_date)}
                        </Text>
                        <Text style={styles.dateEdit}>Edit</Text>
                    </TouchableOpacity>
                </View>

                {/* Group — compact single-line pill card */}
                <View style={styles.groupCard}>
                    <Text style={styles.eyebrow}>GROUP</Text>
                    {groupsError ? (
                        <TouchableOpacity style={styles.retryBtn} onPress={() => fetchSettleUpGroups(false)}>
                            <Text style={styles.retryBtnText}>Retry</Text>
                        </TouchableOpacity>
                    ) : isLoadingGroups ? (
                        <ActivityIndicator size="small" color={theme.ink} />
                    ) : (
                        <TouchableOpacity
                            style={styles.groupValue}
                            onPress={showGroupPicker}
                            disabled={groups.length === 0}
                        >
                            <Text style={[styles.groupValueText, groups.length === 0 && styles.fieldValueTextDim]}>
                                {groups.length === 0 ? 'No groups' : getSelectedGroupName()}
                            </Text>
                            {groups.length > 0 && <Text style={styles.chev}>↓</Text>}
                        </TouchableOpacity>
                    )}
                </View>

                {/* Paid by — inline one-tap chips */}
                <View style={styles.paidByCard}>
                    <Text style={[styles.eyebrow, { marginBottom: 8 }]}>PAID BY</Text>
                    {isLoadingUsers ? (
                        <ActivityIndicator size="small" color={theme.ink} style={{ alignSelf: 'flex-start' }} />
                    ) : groupUsers.length === 0 ? (
                        <Text style={styles.mutedHint}>Select a group to see members.</Text>
                    ) : (
                        <View style={styles.paidByRow}>
                            {groupUsers.map((u) => {
                                const selected = paidByUserId === u.id;
                                const c = userColorMap[u.id];
                                return (
                                    <TouchableOpacity
                                        key={u.id}
                                        style={[
                                            styles.paidByChip,
                                            selected && { backgroundColor: c, borderColor: c },
                                        ]}
                                        onPress={() => setPaidByUserId(u.id)}
                                        accessibilityLabel={`Paid by ${u.name}`}
                                    >
                                        <View
                                            style={[
                                                styles.paidByAvatar,
                                                { backgroundColor: selected ? '#fff' : c },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.paidByAvatarText,
                                                    { color: selected ? c : '#fff' },
                                                ]}
                                            >
                                                {initialFor(u.name)}
                                            </Text>
                                        </View>
                                        <Text
                                            style={[
                                                styles.paidByChipText,
                                                selected && styles.paidByChipTextSelected,
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {u.name.split(' ')[0]}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    )}
                </View>

                {/* Items */}
                <View style={styles.itemsHeader}>
                    <Text style={styles.itemsHeaderTitle}>Items</Text>
                    <Text style={styles.itemsHeaderMeta}>
                        {assignedCount}/{editableItems.length} assigned
                    </Text>
                </View>

                <View style={styles.itemsCard}>
                    {editableItems
                        .slice()
                        .sort((a, b) => a.item_order - b.item_order)
                        .map((item, index) => {
                            const assigned = userSelections[index];
                            return (
                                <View key={index} style={[styles.itemRow, index > 0 && styles.itemRowDivider]}>
                                    {/* Name + JP secondary */}
                                    <View style={styles.itemNameWrap}>
                                        <Text style={styles.itemName} numberOfLines={1}>
                                            {item.english_name || item.japanese_name}
                                        </Text>
                                        {item.english_name && item.japanese_name ? (
                                            <Text style={styles.itemNameJP} numberOfLines={1}>
                                                {item.japanese_name}
                                            </Text>
                                        ) : null}
                                    </View>

                                    {/* Qty + price */}
                                    <View style={styles.itemMetaRow}>
                                        <View style={styles.qtyGroup}>
                                            <TouchableOpacity
                                                style={styles.qtyBtn}
                                                onPress={() =>
                                                    updateItemQuantity(index, Math.max(0, item.quantity - 1).toString())
                                                }
                                            >
                                                <Text style={styles.qtyBtnText}>−</Text>
                                            </TouchableOpacity>
                                            <Text style={styles.qtyValue}>{item.quantity}</Text>
                                            <TouchableOpacity
                                                style={styles.qtyBtn}
                                                onPress={() => updateItemQuantity(index, (item.quantity + 1).toString())}
                                            >
                                                <Text style={styles.qtyBtnText}>+</Text>
                                            </TouchableOpacity>
                                        </View>

                                        <View style={styles.priceWrap}>
                                            <Text style={styles.priceSymbol}>¥</Text>
                                            <TextInput
                                                style={styles.priceInput}
                                                value={costInputs.hasOwnProperty(index) ? costInputs[index] : item.cost.toString()}
                                                onChangeText={(t) => updateItemCost(index, t)}
                                                keyboardType="decimal-pad"
                                                placeholder="0"
                                                placeholderTextColor={theme.inkFaint}
                                            />
                                        </View>
                                    </View>

                                    {/* Assignment chips */}
                                    {groupUsers.length > 0 && (
                                        <View style={styles.assignRow}>
                                            {groupUsers.map((u) => {
                                                const selected = assigned === u.id;
                                                const c = userColorMap[u.id];
                                                return (
                                                    <TouchableOpacity
                                                        key={u.id}
                                                        style={[
                                                            styles.assignChip,
                                                            selected && { backgroundColor: c, borderColor: c },
                                                        ]}
                                                        onPress={() => handleUserSelection(index, u.id)}
                                                    >
                                                        <View
                                                            style={[
                                                                styles.assignDot,
                                                                { backgroundColor: c },
                                                                selected && { backgroundColor: '#fff' },
                                                            ]}
                                                        />
                                                        <Text
                                                            style={[
                                                                styles.assignChipText,
                                                                selected && styles.assignChipTextSelected,
                                                            ]}
                                                        >
                                                            {u.name.split(' ')[0]}
                                                        </Text>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                            <TouchableOpacity
                                                style={[
                                                    styles.assignChip,
                                                    styles.sharedChip,
                                                    assigned === 'shared' && styles.sharedChipSelected,
                                                ]}
                                                onPress={() => handleUserSelection(index, 'shared')}
                                            >
                                                <View style={styles.sharedGlyph}>
                                                    <View style={[styles.sharedDot, assigned === 'shared' && styles.sharedDotOn]} />
                                                    <View style={[styles.sharedDot, assigned === 'shared' && styles.sharedDotOn]} />
                                                    <View style={[styles.sharedDot, assigned === 'shared' && styles.sharedDotOn]} />
                                                </View>
                                                <Text
                                                    style={[
                                                        styles.assignChipText,
                                                        assigned === 'shared' && styles.sharedChipTextSelected,
                                                    ]}
                                                >
                                                    Shared
                                                </Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                </View>
                            );
                        })}
                </View>

                {/* Summary */}
                <View style={styles.summaryCard}>
                    <View style={styles.summaryLine}>
                        <Text style={styles.summaryLabel}>Subtotal</Text>
                        <Text style={styles.summaryValue}>{yen(subtotal)}</Text>
                    </View>
                    <View style={styles.summaryLine}>
                        <Text style={styles.summaryLabel}>Tax</Text>
                        <View style={styles.taxRight}>
                            <View style={styles.taxInputWrap}>
                                <TextInput
                                    style={styles.taxInput}
                                    value={taxPercentageInput !== null ? taxPercentageInput : editableTaxPercentage.toString()}
                                    onChangeText={updateTaxPercentage}
                                    keyboardType="decimal-pad"
                                    placeholder="0"
                                    placeholderTextColor={theme.inkFaint}
                                />
                                <Text style={styles.taxInputSuffix}>%</Text>
                            </View>
                            <Text style={styles.taxAmount}>{yen(taxAmount)}</Text>
                        </View>
                    </View>
                    <View style={[styles.summaryLine, styles.summaryTotalLine]}>
                        <Text style={styles.summaryTotalLabel}>Total</Text>
                        <Text style={styles.summaryTotal}>{yen(total)}</Text>
                    </View>
                </View>
            </ScrollView>

            {/* Sticky sync footer */}
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
                <Text style={styles.footerHint}>
                    {readyToSync
                        ? 'Ready to sync.'
                        : !selectedGroupId
                          ? 'Pick a group to continue.'
                          : !paidByUserId
                            ? 'Select who paid.'
                            : `${editableItems.length - assignedCount} item${editableItems.length - assignedCount === 1 ? '' : 's'} left to assign.`}
                </Text>
                <TouchableOpacity
                    style={[styles.syncBtn, (!readyToSync || isSyncing) && styles.syncBtnDisabled]}
                    onPress={syncTransaction}
                    disabled={!readyToSync || isSyncing}
                >
                    {isSyncing ? (
                        <View style={styles.syncingInner}>
                            <ActivityIndicator size="small" color="#fff" />
                            <Text style={styles.syncBtnText}>Syncing…</Text>
                        </View>
                    ) : (
                        <Text style={styles.syncBtnText}>Sync to Settle Up · {yen(total)}</Text>
                    )}
                </TouchableOpacity>
            </View>

            {/* Group picker modal */}
            <Modal visible={isDropdownOpen} transparent animationType="fade" onRequestClose={() => setIsDropdownOpen(false)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setIsDropdownOpen(false)}>
                    <View style={styles.modalCard}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Select group</Text>
                            <TouchableOpacity onPress={() => setIsDropdownOpen(false)} style={styles.modalClose}>
                                <Text style={styles.modalCloseText}>✕</Text>
                            </TouchableOpacity>
                        </View>
                        <FlatList
                            data={groups}
                            keyExtractor={(i) => i.id}
                            ItemSeparatorComponent={() => <View style={styles.hairline} />}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={[styles.groupOption, selectedGroupId === item.id && styles.groupOptionSelected]}
                                    onPress={() => handleGroupSelection(item)}
                                >
                                    <Text style={[styles.groupOptionText, selectedGroupId === item.id && styles.groupOptionTextSelected]}>
                                        {item.name}
                                    </Text>
                                    {selectedGroupId === item.id && <Text style={styles.checkmark}>✓</Text>}
                                </TouchableOpacity>
                            )}
                        />
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* Date picker modal */}
            {showDatePicker && (
                <Modal transparent animationType="slide" visible={showDatePicker} onRequestClose={() => setShowDatePicker(false)}>
                    <View style={styles.modalOverlay}>
                        <View style={styles.datePickerModal}>
                            <View style={styles.datePickerHeader}>
                                <TouchableOpacity onPress={() => setShowDatePicker(false)} style={styles.datePickerHeaderBtn}>
                                    <Text style={styles.datePickerHeaderText}>Cancel</Text>
                                </TouchableOpacity>
                                <Text style={styles.datePickerTitle}>Receipt date</Text>
                                <TouchableOpacity onPress={() => setShowDatePicker(false)} style={styles.datePickerHeaderBtn}>
                                    <Text style={[styles.datePickerHeaderText, styles.datePickerDone]}>Done</Text>
                                </TouchableOpacity>
                            </View>
                            <View style={styles.datePickerBody}>
                                <DateTimePicker
                                    value={shopInfo.receipt_date}
                                    mode="datetime"
                                    display="spinner"
                                    onChange={handleDateChange}
                                    maximumDate={new Date()}
                                    textColor={theme.ink}
                                    accentColor={theme.accent}
                                    themeVariant="light"
                                    style={{ backgroundColor: theme.surface }}
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
    root: { flex: 1, backgroundColor: theme.bg },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1 },

    errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg, padding: 24 },
    errorText: { fontSize: 16, color: theme.inkMuted, marginBottom: 16 },
    primaryBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999, backgroundColor: theme.ink },
    primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

    // Header
    header: {
        backgroundColor: theme.surface,
        paddingHorizontal: 20,
        paddingBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
    },
    headerTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    iconBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.surfaceAlt,
        borderWidth: 1,
        borderColor: theme.border,
    },
    iconBtnText: { fontSize: 18, fontWeight: '500', color: theme.ink, marginTop: -2 },
    iconBtnSpacer: { width: 36, height: 36 },
    headerKicker: {
        fontSize: 11,
        letterSpacing: 2,
        fontWeight: '600',
        color: theme.inkFaint,
    },
    shopName: { fontSize: 28, fontWeight: '600', color: theme.ink, letterSpacing: -0.6, lineHeight: 34 },
    shopNameJP: { fontSize: 14, color: theme.inkMuted, marginTop: 2 },
    dateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 14,
        paddingTop: 14,
        borderTopWidth: 1,
        borderTopColor: theme.border,
    },
    dateText: { fontSize: 14, color: theme.ink, fontWeight: '500' },
    dateEdit: { fontSize: 13, color: theme.accent, fontWeight: '600' },

    // Group + Paid-by cards
    eyebrow: {
        fontSize: 10,
        fontWeight: '600',
        color: theme.inkFaint,
        letterSpacing: 0.6,
    },
    groupCard: {
        backgroundColor: theme.surface,
        marginTop: 16,
        marginHorizontal: 16,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: theme.border,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 48,
    },
    groupValue: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    groupValueText: { fontSize: 14, color: theme.ink, fontWeight: '600', letterSpacing: -0.2 },
    fieldValueTextDim: { color: theme.inkFaint, fontWeight: '400' },
    chev: { fontSize: 12, color: theme.inkFaint, marginLeft: 2 },
    mutedHint: { fontSize: 13, color: theme.inkFaint, marginTop: 4 },
    retryBtn: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.danger,
    },
    retryBtnText: { fontSize: 12, color: theme.danger, fontWeight: '600' },

    paidByCard: {
        backgroundColor: theme.surface,
        marginTop: 8,
        marginHorizontal: 16,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: theme.border,
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 12,
    },
    paidByRow: { flexDirection: 'row', gap: 6 },
    paidByChip: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 40,
        borderRadius: 10,
        backgroundColor: theme.surfaceAlt,
        borderWidth: 1,
        borderColor: theme.border,
        paddingHorizontal: 8,
    },
    paidByAvatar: {
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    paidByAvatarText: { fontSize: 10, fontWeight: '700' },
    paidByChipText: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.ink,
        letterSpacing: -0.1,
        flexShrink: 1,
    },
    paidByChipTextSelected: { color: '#fff' },

    hairline: { height: 1, backgroundColor: theme.border },

    // Items
    itemsHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 28,
        marginBottom: 10,
        paddingHorizontal: 20,
    },
    itemsHeaderTitle: { fontSize: 13, color: theme.inkMuted, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
    itemsHeaderMeta: { fontSize: 12, color: theme.inkFaint, fontWeight: '500' },

    itemsCard: {
        backgroundColor: theme.surface,
        marginHorizontal: 16,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: theme.border,
        overflow: 'hidden',
    },
    itemRow: { paddingVertical: 14, paddingHorizontal: 16 },
    itemRowDivider: { borderTopWidth: 1, borderTopColor: theme.border },
    itemNameWrap: { marginBottom: 10 },
    itemName: { fontSize: 16, color: theme.ink, fontWeight: '600', letterSpacing: -0.2 },
    itemNameJP: { fontSize: 12, color: theme.inkMuted, marginTop: 2 },

    itemMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    qtyGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.surfaceAlt,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.border,
        paddingHorizontal: 2,
    },
    qtyBtn: {
        width: 28, height: 28,
        alignItems: 'center', justifyContent: 'center',
    },
    qtyBtnText: { fontSize: 16, color: theme.ink, fontWeight: '500', marginTop: -1 },
    qtyValue: { minWidth: 20, textAlign: 'center', fontSize: 14, color: theme.ink, fontWeight: '600' },

    priceWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: theme.surfaceAlt,
        borderRadius: theme.radiusSm,
        borderWidth: 1,
        borderColor: theme.border,
        minWidth: 88,
    },
    priceSymbol: { fontSize: 14, color: theme.inkMuted, fontWeight: '500', marginRight: 2 },
    priceInput: {
        flex: 1,
        fontSize: 15,
        color: theme.ink,
        fontWeight: '600',
        textAlign: 'right',
        padding: 0,
    },

    assignRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    assignChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        gap: 6,
    },
    assignDot: { width: 8, height: 8, borderRadius: 4 },
    assignChipText: { fontSize: 12, color: theme.ink, fontWeight: '500' },
    assignChipTextSelected: { color: '#fff', fontWeight: '600' },

    sharedChip: { backgroundColor: theme.surfaceAlt, borderStyle: 'dashed' },
    sharedChipSelected: { backgroundColor: theme.ink, borderColor: theme.ink, borderStyle: 'solid' },
    sharedChipTextSelected: { color: '#fff', fontWeight: '600' },
    sharedGlyph: { flexDirection: 'row', gap: 2 },
    sharedDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: theme.inkFaint },
    sharedDotOn: { backgroundColor: '#fff' },

    // Summary
    summaryCard: {
        backgroundColor: theme.surface,
        marginHorizontal: 16,
        marginTop: 16,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: theme.border,
        paddingHorizontal: 18,
        paddingVertical: 14,
    },
    summaryLine: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 8,
    },
    summaryLabel: { fontSize: 14, color: theme.inkMuted, fontWeight: '500' },
    summaryValue: { fontSize: 15, color: theme.ink, fontWeight: '600', fontVariant: ['tabular-nums'] },
    taxRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    taxInputWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.surfaceAlt,
        borderRadius: theme.radiusSm,
        borderWidth: 1,
        borderColor: theme.border,
        paddingHorizontal: 8,
        paddingVertical: 4,
        minWidth: 56,
    },
    taxInput: {
        flex: 1,
        fontSize: 14,
        color: theme.ink,
        fontWeight: '600',
        textAlign: 'right',
        padding: 0,
    },
    taxInputSuffix: { fontSize: 13, color: theme.inkMuted, marginLeft: 2 },
    taxAmount: { fontSize: 15, color: theme.ink, fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 56, textAlign: 'right' },
    summaryTotalLine: {
        borderTopWidth: 1,
        borderTopColor: theme.border,
        marginTop: 6,
        paddingTop: 14,
    },
    summaryTotalLabel: { fontSize: 15, color: theme.ink, fontWeight: '600' },
    summaryTotal: { fontSize: 22, color: theme.ink, fontWeight: '700', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },

    // Footer
    footer: {
        position: 'absolute',
        left: 0, right: 0, bottom: 0,
        backgroundColor: theme.surface,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        paddingHorizontal: 16,
        paddingTop: 12,
    },
    footerHint: {
        textAlign: 'center',
        fontSize: 12,
        color: theme.inkMuted,
        marginBottom: 10,
        fontWeight: '500',
    },
    syncBtn: {
        backgroundColor: theme.ink,
        borderRadius: 999,
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    syncBtnDisabled: { backgroundColor: theme.inkFaint },
    syncBtnText: { color: '#fff', fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
    syncingInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },

    // Modal
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(11,11,15,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    modalCard: {
        backgroundColor: theme.surface,
        borderRadius: theme.radiusLg,
        width: '100%',
        maxWidth: 420,
        maxHeight: '70%',
        overflow: 'hidden',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
    },
    modalTitle: { fontSize: 17, fontWeight: '600', color: theme.ink, letterSpacing: -0.3 },
    modalClose: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceAlt },
    modalCloseText: { fontSize: 13, color: theme.ink, fontWeight: '500' },
    groupOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
    groupOptionSelected: { backgroundColor: theme.accentBg },
    groupOptionText: { fontSize: 15, color: theme.ink, fontWeight: '500' },
    groupOptionTextSelected: { color: theme.accent, fontWeight: '600' },
    checkmark: { fontSize: 15, color: theme.accent, fontWeight: '700' },

    // date picker modal
    datePickerModal: {
        backgroundColor: theme.surface,
        borderRadius: theme.radiusLg,
        width: '100%',
        maxWidth: 420,
        overflow: 'hidden',
    },
    datePickerHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
    },
    datePickerHeaderBtn: { paddingHorizontal: 4, paddingVertical: 4 },
    datePickerHeaderText: { fontSize: 15, color: theme.inkMuted, fontWeight: '500' },
    datePickerDone: { color: theme.accent, fontWeight: '600' },
    datePickerTitle: { fontSize: 15, fontWeight: '600', color: theme.ink },
    datePickerBody: { padding: 8 },
});
