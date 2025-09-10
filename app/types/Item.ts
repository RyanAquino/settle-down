export interface ReceiptItem {
  id: number;
  en_name: string;
  jp_name: string;
  cost: number;
  quantity: number;
  discount: number;
  receipt: number;
  owner: number | null;
}

export interface Receipt {
  id: number;
  shop_name: string;
  receipt_file: string;
  created_at: string;
  updated_at: string;
  receipt_items: ReceiptItem[];
}

export interface User {
  id: number;
  last_login: string;
  is_superuser: boolean;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  is_staff: boolean;
  is_active: boolean;
  date_joined: string;
  groups: number[];
  user_permissions: number[];
}

export interface ApiResponse {
  items: Receipt[];
  count: number;
}

export interface UsersApiResponse {
  items: User[];
  count: number;
}

export interface Group {
  id: string;
  name: string;
}

export interface GroupsApiResponse {
  items: Group[];
  count: number;
}