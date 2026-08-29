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
      'apps/android/build/**',
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
  {
    // The one sanctioned low-level `console` wrapper (NFR-SEC-03, v0.9.0
    // #5): every debug/info/warn/error call elsewhere in this repo is meant
    // to route through `createLogger()`'s redaction, not call `console.*`
    // directly, so this file alone needs all four methods rather than just
    // the repo-wide `warn`/`error` allowance.
    files: ['packages/logging/src/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Plain Node CLI scripts run only by schema-release.yml (v0.5.0 #14) —
    // not TypeScript, so tseslint's own `no-undef` override never applies;
    // `no-undef` otherwise flags every reference to a Node global.
    files: ['.github/scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', crypto: 'readonly' },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
