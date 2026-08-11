import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'playwright-report', 'test-results', '.cache', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'react/prop-types': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Ingestion scripts run in Node and legitimately log progress.
    files: ['scripts/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      // Playwright fixtures take a callback named `use`, which the React Hooks
      // rule mistakes for the `use()` hook.
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  {
    // Dev tooling: runs in Node but drives a browser, so it needs both sets.
    files: ['scripts/dev/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      sourceType: 'module',
    },
    rules: { 'no-console': 'off' },
  },
);
