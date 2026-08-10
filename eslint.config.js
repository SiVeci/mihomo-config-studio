// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'apps/android/android/**',
      'packages/test-fixtures/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // ADR-001 / NFR-MAINT: domain packages must not reach into apps or platform APIs.
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/**', '@mcs/web', '@mcs/android'],
              message: 'Domain packages must not depend on application shells (ADR-001).',
            },
            {
              group: ['@capacitor/*', 'node:fs', 'node:fs/promises', 'fs', 'fs/promises'],
              message:
                'Domain packages must not touch the filesystem or native APIs directly; go through @mcs/storage.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'packages/test-fixtures/**/*.ts', 'tools/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-console': 'off',
    },
  },
);
