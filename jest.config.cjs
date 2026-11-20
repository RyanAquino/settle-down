// Expo substitutes public environment variables when Jest compiles the app.
process.env.EXPO_PUBLIC_API_BASE_URL = 'https://test.invalid';

module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/**/*.test.[jt]s?(x)'],
  clearMocks: true,
  collectCoverageFrom: ['utils/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    './utils/receipt.ts': { branches: 90, functions: 100, lines: 95, statements: 95 },
  },
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: 'test-results', outputName: 'jest.xml' }],
  ],
};
