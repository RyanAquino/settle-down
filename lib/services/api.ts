import { ApiResponse, UsersApiResponse, ReceiptItem, GroupsApiResponse } from '../../app/types/Item';
import { API_ENDPOINTS } from '../config/env';

export class ApiService {
  static async getReceipts(groupId?: string): Promise<ApiResponse> {
    try {
      let url = API_ENDPOINTS.RECEIPTS;
      if (groupId) {
        url += `?group_id=${encodeURIComponent(groupId)}`;
      }
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: ApiResponse = await response.json();
      return data;
    } catch (error) {
      throw error;
    }
  }

  static async getUsers(groupId?: string): Promise<UsersApiResponse> {
    try {
      let url = API_ENDPOINTS.USERS;
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
      throw error;
    }
  }

  static async getGroups(): Promise<GroupsApiResponse> {
    try {
      const response = await fetch(API_ENDPOINTS.GROUPS);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: GroupsApiResponse = await response.json();
      return data;
    } catch (error) {
      throw error;
    }
  }


  static async updateReceiptItemCost(receiptItemId: number, cost: number): Promise<void> {
    try {
      const response = await fetch(`${API_ENDPOINTS.RECEIPT_ITEMS}${receiptItemId}/`, {
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
      throw error;
    }
  }

  static async updateReceiptItemOwner(receiptItemId: number, ownerId: number | null): Promise<void> {
    try {
      const response = await fetch(`${API_ENDPOINTS.RECEIPT_ITEMS}${receiptItemId}/`, {
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
      throw error;
    }
  }

  static async updateReceiptItemQuantity(receiptItemId: number, quantity: number): Promise<void> {
    try {
      const response = await fetch(`${API_ENDPOINTS.RECEIPT_ITEMS}${receiptItemId}/`, {
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

      const response = await fetch(API_ENDPOINTS.RECEIPT_ITEMS, {
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
      throw error;
    }
  }
}