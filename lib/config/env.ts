// Environment configuration
export const ENV = {
  API_BASE_URL: 'http://192.168.0.242:8000',
  API_VERSION: 'v1',
} as const;

// Derived configurations
export const API_ENDPOINTS = {
  BASE_URL: `${ENV.API_BASE_URL}/api/${ENV.API_VERSION}`,
  RECEIPTS: `${ENV.API_BASE_URL}/api/${ENV.API_VERSION}/receipts/`,
  USERS: `${ENV.API_BASE_URL}/api/${ENV.API_VERSION}/receipts/users/`,
  GROUPS: `${ENV.API_BASE_URL}/api/${ENV.API_VERSION}/settle-up/groups/`,
  RECEIPT_ITEMS: `${ENV.API_BASE_URL}/api/${ENV.API_VERSION}/receipts/receipt-items/`,
  MEDIA_BASE_URL: ENV.API_BASE_URL,
} as const;