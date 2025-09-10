import { ApiResponse, UsersApiResponse, ReceiptItem, GroupsApiResponse } from '../types/Item';

const API_BASE_URL = 'http://192.168.0.242:8000/api/v1';

export class ApiService {
  static async getReceipts(): Promise<ApiResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/receipts/`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: ApiResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching receipts:', error);
      throw error;
    }
  }

  static async getUsers(groupId?: string): Promise<UsersApiResponse> {
    try {
      let url = `${API_BASE_URL}/receipts/users/`;
      if (groupId) {
        url += `?group_id=${encodeURIComponent(groupId)}`;
      }
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: UsersApiResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching users:', error);
      throw error;
    }
  }

  static async getGroups(): Promise<GroupsApiResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/settle-up/groups/`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: GroupsApiResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching groups:', error);
      throw error;
    }
  }

  static async getReceiptItem(receiptItemId: number): Promise<ReceiptItem> {
    try {
      const response = await fetch(`${API_BASE_URL}/receipts/receipt-items/${receiptItemId}/`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: ReceiptItem = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching receipt item:', error);
      throw error;
    }
  }

  static async updateReceiptItemCost(receiptItemId: number, cost: number): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/receipts/receipt-items/${receiptItemId}/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cost }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error('Error updating receipt item cost:', error);
      throw error;
    }
  }

  static async updateReceiptItemOwner(receiptItemId: number, ownerId: number | null): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/receipts/receipt-items/${receiptItemId}/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ owner_id: ownerId }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error('Error updating receipt item owner:', error);
      throw error;
    }
  }

  static async updateReceiptItemQuantity(receiptItemId: number, quantity: number): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/receipts/receipt-items/${receiptItemId}/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ quantity }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error('Error updating receipt item quantity:', error);
      throw error;
    }
  }

  static async uploadReceiptPhoto(photoUri: string): Promise<void> {
    try {
      const formData = new FormData();
      
      // Create file object from URI
      const fileExtension = photoUri.split('.').pop() || 'jpg';
      const fileName = `receipt_${Date.now()}.${fileExtension}`;
      
      formData.append('file', {
        uri: photoUri,
        type: `image/${fileExtension}`,
        name: fileName,
      } as any);

      const response = await fetch(`${API_BASE_URL}/receipts/receipt-items/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error('Error uploading receipt photo:', error);
      throw error;
    }
  }
}