// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const tseslint = require('typescript-eslint');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = defineConfig([
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'test-results/**',
      '.expo/**',
      'ios/**',
      'android/**',
      '**/node_modules/**',
    ],
  },
  expoConfig,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: __dirname } },
    rules: { '@typescript-eslint/switch-exhaustiveness-check': 'error' },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: globals.node },
    settings: {
      'import/resolver': { typescript: { conditionNames: ['import', 'node', 'default'] } },
    },
  },
  prettier,
]);
